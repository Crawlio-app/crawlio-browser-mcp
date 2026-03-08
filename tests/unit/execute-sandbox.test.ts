import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCodeModeTools, TOOL_TIMEOUTS } from "@/mcp-server/tools";
import { CrawlioClient } from "@/mcp-server/crawlio-client";

// --- Command-type-based bridge router ---

function createRoutingBridge() {
  const sendSpy = vi.fn(async (msg: { type: string }) => {
    switch (msg.type) {
      case "get_connection_status":
        return { connectedTab: { url: "" } }; // empty URL bypasses smartObjectCache
      case "detect_framework":
        return { detections: [] };
      case "list_tabs":
        return { tabs: [] };
      case "browser_evaluate":
        return { result: "evaluated" };
      case "browser_snapshot":
        return { snapshot: "ok" };
      default:
        return { ok: true };
    }
  });
  return {
    send: sendSpy,
    isConnected: true,
    push: vi.fn(),
  };
}

function getExecuteTool(bridge: ReturnType<typeof createRoutingBridge>) {
  const crawlio = new CrawlioClient("http://localhost:0");
  const tools = createCodeModeTools(bridge as never, crawlio);
  const execute = tools.find((t) => t.name === "execute");
  if (!execute) throw new Error("execute tool not found");
  return execute;
}

// ============================================================
// Group 1: Parameter Accessibility
// ============================================================

describe("Execute Sandbox — Parameter Accessibility", () => {
  let bridge: ReturnType<typeof createRoutingBridge>;
  let execute: ReturnType<typeof getExecuteTool>;

  beforeEach(() => {
    bridge = createRoutingBridge();
    execute = getExecuteTool(bridge);
  });

  it("T1: bridge is accessible and calls reach the mock", async () => {
    const result = await execute.handler({ code: 'return await bridge.send({ type: "list_tabs" })' });
    expect(result.isError).toBe(false);
    // bridge.send is called for get_connection_status + detect_framework before user code
    const userCall = bridge.send.mock.calls.find((c: unknown[]) => (c[0] as { type: string }).type === "list_tabs");
    expect(userCall).toBeTruthy();
  });

  it("T2: crawlio is accessible", async () => {
    const result = await execute.handler({ code: "return typeof crawlio.getStatus" });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toBe("function");
  });

  it("T3: sleep resolves without error", async () => {
    const result = await execute.handler({ code: 'await sleep(10); return "slept"' });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toBe("slept");
  });

  it("T4: TIMEOUTS.connect_tab is 15000", async () => {
    const result = await execute.handler({ code: "return TIMEOUTS.connect_tab" });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toBe(15000);
  });

  it("T5: smart has 7 core keys", async () => {
    const result = await execute.handler({ code: "return Object.keys(smart).sort()" });
    expect(result.isError).toBe(false);
    const keys = JSON.parse(result.content[0].text);
    expect(keys).toEqual(
      expect.arrayContaining(["click", "evaluate", "navigate", "rebuild", "snapshot", "type", "waitFor"]),
    );
    expect(keys.length).toBeGreaterThanOrEqual(7);
  });

  it("T6: compileRecording produces valid output", async () => {
    const code = `
      const session = {
        id: "test-1",
        startedAt: "2026-01-01T00:00:00Z",
        duration: 5000,
        pages: [{
          url: "https://example.com",
          title: "Example",
          enteredAt: "2026-01-01T00:00:00Z",
          console: [],
          network: [],
          interactions: [
            { timestamp: "2026-01-01T00:00:01Z", tool: "browser_click", args: { selector: "#btn" }, durationMs: 100, pageUrl: "https://example.com" }
          ]
        }],
        metadata: { tabId: 1, initialUrl: "https://example.com", stopReason: "manual" }
      };
      const result = compileRecording(session, { name: "test-flow" });
      return { name: result.name, pageCount: result.pageCount, interactionCount: result.interactionCount };
    `;
    const result = await execute.handler({ code });
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.name).toBe("test-flow");
    expect(parsed.pageCount).toBe(1);
    expect(parsed.interactionCount).toBe(1);
  });
});

// ============================================================
// Group 2: Error Paths
// ============================================================

describe("Execute Sandbox — Error Paths", () => {
  let bridge: ReturnType<typeof createRoutingBridge>;
  let execute: ReturnType<typeof getExecuteTool>;

  beforeEach(() => {
    bridge = createRoutingBridge();
    execute = getExecuteTool(bridge);
  });

  it("T7: syntax error surfaces clearly", async () => {
    const result = await execute.handler({ code: "if (" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Syntax error/i);
  });

  it("T8: thrown error surfaces as execution error", async () => {
    const result = await execute.handler({ code: 'throw new Error("boom")' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Execution error/);
    expect(result.content[0].text).toMatch(/boom/);
  });

  it("T9: empty code string rejected by Zod", async () => {
    await expect(execute.handler({ code: "" })).rejects.toThrow();
  });
});

// ============================================================
// Group 3: Integration
// ============================================================

describe("Execute Sandbox — Integration", () => {
  let bridge: ReturnType<typeof createRoutingBridge>;
  let execute: ReturnType<typeof getExecuteTool>;

  beforeEach(() => {
    bridge = createRoutingBridge();
    execute = getExecuteTool(bridge);
  });

  it("T10: bridge.send error in user code surfaces original message", async () => {
    bridge.send.mockImplementationOnce(async () => ({ connectedTab: { url: "" } }));
    bridge.send.mockImplementationOnce(async () => ({ detections: [] }));
    bridge.send.mockImplementation(async () => { throw new Error("extension dead"); });

    const result = await execute.handler({ code: 'return await bridge.send({ type: "capture_page" })' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/extension dead/);
  });

  it("T11: no return yields empty object", async () => {
    const result = await execute.handler({ code: "const x = 42;" });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toEqual({});
  });

  it("T12: smart.evaluate reaches bridge with browser_evaluate type", async () => {
    const result = await execute.handler({ code: 'return await smart.evaluate("1+1")' });
    expect(result.isError).toBe(false);
    expect(bridge.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "browser_evaluate", expression: "1+1" }),
      expect.any(Number),
    );
  });
});
