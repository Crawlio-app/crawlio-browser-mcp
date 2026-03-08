import { describe, it, expect, vi, beforeEach } from "vitest";
import { createCodeModeTools } from "@/mcp-server/tools";
import { CrawlioClient } from "@/mcp-server/crawlio-client";
import type { PageEvidence, ScrollEvidence, IdleStatus, ComparisonEvidence, Finding, CoverageGap, ComparisonScaffold, AccessibilitySummary, MobileReadiness } from "@/shared/evidence-types";

// --- Bridge mock with configurable scroll state ---

function createSmartBridge(opts?: {
  scrollHeight?: number;
  viewportHeight?: number;
  stuckAtScroll?: number;
}) {
  const scrollHeight = opts?.scrollHeight ?? 3000;
  const viewportHeight = opts?.viewportHeight ?? 800;
  const stuckAt = opts?.stuckAtScroll ?? -1;
  let currentScrollY = 0;

  const sendSpy = vi.fn(async (msg: Record<string, unknown>) => {
    switch (msg.type) {
      case "get_connection_status":
        return { connectedTab: { url: "" } };
      case "detect_framework":
        return { detections: [] };
      case "browser_evaluate": {
        const expr = String(msg.expression || "");
        // scrollCapture position query
        if (expr.includes("scrollY") && expr.includes("scrollHeight") && expr.includes("viewportHeight")) {
          return { result: { scrollY: currentScrollY, scrollHeight, viewportHeight }, type: "object" };
        }
        // scrollCapture post-scroll position check
        if (expr.trim() === "window.scrollY") {
          return { result: currentScrollY, type: "number" };
        }
        // scrollCapture scroll-to-top
        if (expr.includes("window.scrollTo(0, 0)")) {
          currentScrollY = 0;
          return { result: undefined, type: "undefined" };
        }
        // waitForIdle — return 'idle'
        if (expr.includes("MutationObserver")) {
          return { result: "idle", type: "string" };
        }
        // extractPage meta extraction
        if (expr.includes("querySelectorAll('meta')")) {
          return { result: { _title: "Test Page", _canonical: null, _structuredData: [], _headings: [], _nav: [] }, type: "object" };
        }
        // mobile readiness extraction
        if (expr.includes("meta[name=\"viewport\"]") && expr.includes("mediaQueryCount")) {
          return { result: { hasViewportMeta: true, viewportContent: "width=device-width, initial-scale=1", mediaQueryCount: 3, bodyScrollWidth: 1024, windowInnerWidth: 1024, isOverflowing: false }, type: "object" };
        }
        return { result: "evaluated", type: "string" };
      }
      case "take_screenshot":
        return { screenshot: "base64data" };
      case "browser_scroll": {
        const px = Number(msg.pixels) || 800;
        if (stuckAt >= 0 && currentScrollY >= stuckAt) {
          // Simulate stuck — don't move
        } else {
          currentScrollY = Math.min(currentScrollY + px, scrollHeight - viewportHeight);
        }
        return { ok: true };
      }
      case "capture_page":
        return { url: "https://test.com", title: "Test", framework: null, network: { total: 5 }, console: { total: 2 }, cookies: { total: 1 }, dom: { nodeCount: 100 } };
      case "get_performance_metrics":
        return { metrics: { LCP: 1200, FCP: 800 } };
      case "get_security_state":
        return { securityState: "secure", protocol: "TLS 1.3" };
      case "detect_fonts":
        return { fonts: ["Arial", "Roboto"] };
      case "get_accessibility_tree":
        return { tree: [
          { role: "banner", name: "header", children: [] },
          { role: "main", name: "content", children: [
            { role: "heading", name: "Test Heading", level: 1, children: [] },
            { role: "img", name: "", children: [] },
            { role: "img", name: "Logo", children: [] },
          ] },
          { role: "navigation", name: "nav", children: [] },
        ], nodeCount: 6 };
      case "browser_navigate":
        currentScrollY = 0;
        return { ok: true };
      case "browser_hover":
        return { ok: true };
      default:
        return { ok: true };
    }
  });

  return {
    send: sendSpy,
    isConnected: true,
    push: vi.fn(),
    resetScroll: () => { currentScrollY = 0; },
  };
}

function getExecuteTool(bridge: ReturnType<typeof createSmartBridge>) {
  const crawlio = new CrawlioClient("http://localhost:0");
  const tools = createCodeModeTools(bridge as never, crawlio);
  const execute = tools.find((t) => t.name === "execute");
  if (!execute) throw new Error("execute tool not found");
  return execute;
}

function parseResult(result: { isError?: boolean; content: Array<{ text: string }> }) {
  expect(result.isError).toBe(false);
  return JSON.parse(result.content[0].text);
}

// ============================================================
// scrollCapture
// ============================================================

describe("smart.scrollCapture", () => {
  let bridge: ReturnType<typeof createSmartBridge>;
  let execute: ReturnType<typeof getExecuteTool>;

  beforeEach(() => {
    bridge = createSmartBridge({ scrollHeight: 3000, viewportHeight: 800 });
    execute = getExecuteTool(bridge);
  });

  it("stops at page bottom", async () => {
    const result = await execute.handler({ code: "return await smart.scrollCapture()" });
    const data = parseResult(result);
    expect(data.sectionCount).toBeGreaterThanOrEqual(1);
    // Should not exceed what's needed to reach the bottom
    const maxNeeded = Math.ceil(3000 / 800) + 1;
    expect(data.sectionCount).toBeLessThanOrEqual(maxNeeded);
  });

  it("respects maxSections cap", async () => {
    const result = await execute.handler({
      code: "return await smart.scrollCapture({ maxSections: 2 })",
    });
    const data = parseResult(result);
    expect(data.sectionCount).toBeLessThanOrEqual(2);
  });

  it("returns sections with scroll positions and screenshots", async () => {
    const result = await execute.handler({
      code: "return await smart.scrollCapture({ maxSections: 2 })",
    });
    const data = parseResult(result);
    expect(data.sections.length).toBe(data.sectionCount);
    for (const section of data.sections) {
      expect(section).toHaveProperty("index");
      expect(section).toHaveProperty("scrollY");
      expect(section).toHaveProperty("screenshot");
      expect(typeof section.scrollY).toBe("number");
    }
  });

  it("detects stuck scroll (page shorter than expected)", async () => {
    bridge = createSmartBridge({ scrollHeight: 3000, viewportHeight: 800, stuckAtScroll: 0 });
    execute = getExecuteTool(bridge);
    const result = await execute.handler({
      code: "return await smart.scrollCapture({ maxSections: 5 })",
    });
    const data = parseResult(result);
    // Should stop after detecting stuck (first section at 0, scroll doesn't move)
    expect(data.sectionCount).toBeLessThanOrEqual(2);
  });

  it("returns 1 section for short page", async () => {
    bridge = createSmartBridge({ scrollHeight: 600, viewportHeight: 800 });
    execute = getExecuteTool(bridge);
    const result = await execute.handler({
      code: "return await smart.scrollCapture()",
    });
    const data = parseResult(result);
    expect(data.sectionCount).toBe(1);
  });
});

// ============================================================
// waitForIdle
// ============================================================

describe("smart.waitForIdle", () => {
  let execute: ReturnType<typeof getExecuteTool>;

  beforeEach(() => {
    const bridge = createSmartBridge();
    execute = getExecuteTool(bridge);
  });

  it("returns idle status", async () => {
    const result = await execute.handler({
      code: "return await smart.waitForIdle()",
    });
    const data = parseResult(result);
    expect(data.status).toBe("idle");
  });

  it("accepts custom timeout", async () => {
    const result = await execute.handler({
      code: "return await smart.waitForIdle(3000)",
    });
    const data = parseResult(result);
    expect(data.status).toBe("idle");
  });

  it("caps timeout at 15000ms", async () => {
    // The method caps at 15000 internally — should not throw
    const result = await execute.handler({
      code: "return await smart.waitForIdle(99999)",
    });
    const data = parseResult(result);
    expect(data).toHaveProperty("status");
  });
});

// ============================================================
// extractPage
// ============================================================

describe("smart.extractPage", () => {
  let bridge: ReturnType<typeof createSmartBridge>;
  let execute: ReturnType<typeof getExecuteTool>;

  beforeEach(() => {
    bridge = createSmartBridge();
    execute = getExecuteTool(bridge);
  });

  it("returns capture, performance, security, fonts, meta, accessibility, and mobileReadiness", async () => {
    const result = await execute.handler({
      code: "return await smart.extractPage()",
    });
    const data = parseResult(result);
    expect(data).toHaveProperty("capture");
    expect(data).toHaveProperty("performance");
    expect(data).toHaveProperty("security");
    expect(data).toHaveProperty("fonts");
    expect(data).toHaveProperty("meta");
    expect(data).toHaveProperty("accessibility");
    expect(data).toHaveProperty("mobileReadiness");
  });

  it("capture contains shaped capture_page output", async () => {
    const result = await execute.handler({
      code: "return await smart.extractPage()",
    });
    const data = parseResult(result);
    expect(data.capture).toHaveProperty("url");
    expect(data.capture).toHaveProperty("title");
    expect(data.capture).toHaveProperty("network");
    expect(data.capture).toHaveProperty("console");
    expect(data.capture).toHaveProperty("dom");
  });

  it("calls capture_page, get_performance_metrics, get_security_state, detect_fonts, get_accessibility_tree in parallel", async () => {
    await execute.handler({ code: "return await smart.extractPage()" });
    const types = bridge.send.mock.calls.map((c: unknown[]) => (c[0] as { type: string }).type);
    expect(types).toContain("capture_page");
    expect(types).toContain("get_performance_metrics");
    expect(types).toContain("get_security_state");
    expect(types).toContain("detect_fonts");
    expect(types).toContain("get_accessibility_tree");
  });

  it("handles supplementary failures gracefully (catch → null)", async () => {
    // Override bridge to fail on perf/security/fonts/accessibility
    const failBridge = createSmartBridge();
    failBridge.send.mockImplementation(async (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case "get_connection_status": return { connectedTab: { url: "" } };
        case "detect_framework": return { detections: [] };
        case "capture_page": return { url: "https://test.com", title: "Test", network: {}, console: {}, cookies: {}, dom: {} };
        case "get_performance_metrics": throw new Error("perf unavailable");
        case "get_security_state": throw new Error("security unavailable");
        case "detect_fonts": throw new Error("fonts unavailable");
        case "get_accessibility_tree": throw new Error("a11y unavailable");
        case "browser_evaluate": {
          const expr = String(msg.expression || "");
          if (expr.includes("meta[name=\"viewport\"]") && expr.includes("mediaQueryCount")) {
            return { result: { hasViewportMeta: false, viewportContent: null, mediaQueryCount: 0, isOverflowing: false }, type: "object" };
          }
          return { result: { _title: "T", _headings: [], _nav: [], _structuredData: [], _canonical: null }, type: "object" };
        }
        default: return { ok: true };
      }
    });
    const exec = getExecuteTool(failBridge);
    const result = await exec.handler({ code: "return await smart.extractPage()" });
    const data = parseResult(result);
    expect(data.capture).toBeTruthy();
    expect(data.performance).toBeNull();
    expect(data.security).toBeNull();
    expect(data.fonts).toBeNull();
    expect(data.accessibility).toBeNull();
    expect(data.meta).toBeTruthy(); // meta comes from evaluate, which succeeded
    expect(data.mobileReadiness).toBeTruthy(); // mobile comes from evaluate, which succeeded
  });

  it("meta includes headings and structured data", async () => {
    const result = await execute.handler({ code: "return await smart.extractPage()" });
    const data = parseResult(result);
    expect(data.meta).toHaveProperty("_title");
    expect(data.meta).toHaveProperty("_headings");
    expect(data.meta).toHaveProperty("_structuredData");
    expect(data.meta).toHaveProperty("_nav");
  });
});

// ============================================================
// comparePages
// ============================================================

describe("smart.comparePages", () => {
  let bridge: ReturnType<typeof createSmartBridge>;
  let execute: ReturnType<typeof getExecuteTool>;

  beforeEach(() => {
    bridge = createSmartBridge();
    execute = getExecuteTool(bridge);
  });

  it("returns siteA and siteB with urls", async () => {
    const result = await execute.handler({
      code: `return await smart.comparePages("https://a.com", "https://b.com")`,
    });
    const data = parseResult(result);
    expect(data.siteA.url).toBe("https://a.com");
    expect(data.siteB.url).toBe("https://b.com");
  });

  it("both sites have extractPage data", async () => {
    const result = await execute.handler({
      code: `return await smart.comparePages("https://a.com", "https://b.com")`,
    });
    const data = parseResult(result);
    expect(data.siteA).toHaveProperty("capture");
    expect(data.siteA).toHaveProperty("performance");
    expect(data.siteB).toHaveProperty("capture");
    expect(data.siteB).toHaveProperty("meta");
  });

  it("navigates to both URLs", async () => {
    await execute.handler({
      code: `return await smart.comparePages("https://a.com", "https://b.com")`,
    });
    const navCalls = bridge.send.mock.calls.filter(
      (c: unknown[]) => (c[0] as { type: string }).type === "browser_navigate"
    );
    const urls = navCalls.map((c: unknown[]) => (c[0] as { url: string }).url);
    expect(urls).toContain("https://a.com");
    expect(urls).toContain("https://b.com");
  });
});

// ============================================================
// smart object key count (updated)
// ============================================================

describe("smart object includes new methods", () => {
  it("has scrollCapture, waitForIdle, extractPage, comparePages, finding, findings, clearFindings", async () => {
    const bridge = createSmartBridge();
    const execute = getExecuteTool(bridge);
    const result = await execute.handler({ code: "return Object.keys(smart).sort()" });
    const keys = parseResult(result);
    expect(keys).toContain("scrollCapture");
    expect(keys).toContain("waitForIdle");
    expect(keys).toContain("extractPage");
    expect(keys).toContain("comparePages");
    expect(keys).toContain("finding");
    expect(keys).toContain("findings");
    expect(keys).toContain("clearFindings");
    // 7 core + 7 higher-order = 14 minimum
    expect(keys.length).toBeGreaterThanOrEqual(14);
  });
});

// ============================================================
// Phase 2: Typed Evidence Records
// ============================================================

describe("typed evidence records", () => {
  let bridge: ReturnType<typeof createSmartBridge>;
  let execute: ReturnType<typeof getExecuteTool>;

  beforeEach(() => {
    bridge = createSmartBridge();
    execute = getExecuteTool(bridge);
  });

  it("scrollCapture returns ScrollEvidence shape", async () => {
    const result = await execute.handler({ code: "return await smart.scrollCapture({ maxSections: 2 })" });
    const data = parseResult(result) as ScrollEvidence;
    expect(data).toHaveProperty("sectionCount");
    expect(data).toHaveProperty("sections");
    expect(typeof data.sectionCount).toBe("number");
    expect(Array.isArray(data.sections)).toBe(true);
    for (const s of data.sections) {
      expect(typeof s.index).toBe("number");
      expect(typeof s.scrollY).toBe("number");
      expect(typeof s.screenshot).toBe("string");
    }
  });

  it("waitForIdle returns IdleStatus shape", async () => {
    const result = await execute.handler({ code: "return await smart.waitForIdle()" });
    const data = parseResult(result) as IdleStatus;
    expect(["idle", "timeout"]).toContain(data.status);
  });

  it("extractPage returns PageEvidence shape with gaps", async () => {
    const result = await execute.handler({ code: "return await smart.extractPage()" });
    const data = parseResult(result) as PageEvidence & { gaps: CoverageGap[] };
    expect(data).toHaveProperty("capture");
    expect(data).toHaveProperty("performance");
    expect(data).toHaveProperty("security");
    expect(data).toHaveProperty("fonts");
    expect(data).toHaveProperty("meta");
    expect(data).toHaveProperty("accessibility");
    expect(data).toHaveProperty("mobileReadiness");
    expect(data).toHaveProperty("gaps");
    expect(Array.isArray(data.gaps)).toBe(true);
  });

  it("comparePages returns ComparisonEvidence shape with scaffold", async () => {
    const result = await execute.handler({
      code: `return await smart.comparePages("https://a.com", "https://b.com")`,
    });
    const data = parseResult(result) as ComparisonEvidence;
    expect(data).toHaveProperty("siteA");
    expect(data).toHaveProperty("siteB");
    expect(data).toHaveProperty("scaffold");
    expect(data.siteA).toHaveProperty("url");
    expect(data.siteB).toHaveProperty("url");
    expect(data.scaffold).toHaveProperty("dimensions");
    expect(data.scaffold).toHaveProperty("sharedFields");
    expect(data.scaffold).toHaveProperty("missingFields");
    expect(data.scaffold).toHaveProperty("metrics");
  });
});

// ============================================================
// Phase 3: Tool-Enforced Findings
// ============================================================

describe("smart.finding()", () => {
  let execute: ReturnType<typeof getExecuteTool>;

  beforeEach(() => {
    const bridge = createSmartBridge();
    execute = getExecuteTool(bridge);
  });

  it("creates a valid Finding", async () => {
    const result = await execute.handler({
      code: `return smart.finding({
        claim: "Site A loads 2x faster than Site B",
        evidence: ["LCP: 800ms vs 1600ms"],
        sourceUrl: "https://example.com",
        confidence: "high",
        method: "extractPage + compare",
      })`,
    });
    const finding = parseResult(result) as Finding;
    expect(finding.claim).toBe("Site A loads 2x faster than Site B");
    expect(finding.evidence).toEqual(["LCP: 800ms vs 1600ms"]);
    expect(finding.sourceUrl).toBe("https://example.com");
    expect(finding.confidence).toBe("high");
    expect(finding.method).toBe("extractPage + compare");
  });

  it("accepts optional dimension", async () => {
    const result = await execute.handler({
      code: `return smart.finding({
        claim: "Missing CSP header",
        evidence: ["security.csp is null"],
        sourceUrl: "https://example.com",
        confidence: "medium",
        method: "extractPage",
        dimension: "security",
      })`,
    });
    const finding = parseResult(result) as Finding;
    expect(finding.dimension).toBe("security");
  });

  it("rejects missing claim", async () => {
    const result = await execute.handler({
      code: `try {
        smart.finding({ evidence: ["x"], sourceUrl: "https://a.com", confidence: "high", method: "m" });
        return { error: false };
      } catch (e) { return { error: true, message: e.message }; }`,
    });
    const data = parseResult(result);
    expect(data.error).toBe(true);
    expect(data.message).toContain("claim");
  });

  it("rejects empty evidence array", async () => {
    const result = await execute.handler({
      code: `try {
        smart.finding({ claim: "x", evidence: [], sourceUrl: "https://a.com", confidence: "high", method: "m" });
        return { error: false };
      } catch (e) { return { error: true, message: e.message }; }`,
    });
    const data = parseResult(result);
    expect(data.error).toBe(true);
    expect(data.message).toContain("evidence");
  });

  it("rejects invalid confidence", async () => {
    const result = await execute.handler({
      code: `try {
        smart.finding({ claim: "x", evidence: ["y"], sourceUrl: "https://a.com", confidence: "maybe", method: "m" });
        return { error: false };
      } catch (e) { return { error: true, message: e.message }; }`,
    });
    const data = parseResult(result);
    expect(data.error).toBe(true);
    expect(data.message).toContain("confidence");
  });

  it("rejects non-string evidence entries", async () => {
    const result = await execute.handler({
      code: `try {
        smart.finding({ claim: "x", evidence: [42], sourceUrl: "https://a.com", confidence: "high", method: "m" });
        return { error: false };
      } catch (e) { return { error: true, message: e.message }; }`,
    });
    const data = parseResult(result);
    expect(data.error).toBe(true);
    expect(data.message).toContain("evidence");
  });
});

// ============================================================
// Phase 4: Coverage-Gap Modeling
// ============================================================

describe("extractPage coverage gaps", () => {
  it("emits gaps when supplementary calls fail", async () => {
    const failBridge = createSmartBridge();
    failBridge.send.mockImplementation(async (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case "get_connection_status": return { connectedTab: { url: "" } };
        case "detect_framework": return { detections: [] };
        case "capture_page": return { url: "https://test.com", title: "Test", network: { total: 5 }, console: { total: 2 }, cookies: { total: 1 }, dom: { nodeCount: 100 } };
        case "get_performance_metrics": throw new Error("perf timeout");
        case "get_security_state": throw new Error("security unavailable");
        case "detect_fonts": throw new Error("fonts fail");
        case "get_accessibility_tree": throw new Error("a11y fail");
        case "browser_evaluate": {
          const expr = String(msg.expression || "");
          if (expr.includes("meta[name=\"viewport\"]") && expr.includes("mediaQueryCount")) {
            return { result: { hasViewportMeta: true, viewportContent: "width=device-width", mediaQueryCount: 0, isOverflowing: false }, type: "object" };
          }
          return { result: { _title: "T", _headings: [], _nav: [], _structuredData: [], _canonical: null }, type: "object" };
        }
        default: return { ok: true };
      }
    });
    const exec = getExecuteTool(failBridge);
    const result = await exec.handler({ code: "return await smart.extractPage()" });
    const data = parseResult(result) as PageEvidence & { gaps: CoverageGap[] };

    expect(data.gaps.length).toBe(4);
    const dimensions = data.gaps.map(g => g.dimension).sort();
    expect(dimensions).toEqual(["accessibility", "fonts", "performance", "security"]);
    for (const gap of data.gaps) {
      expect(gap.impact).toBe("method-failed");
      expect(typeof gap.reason).toBe("string");
      expect(gap.reason.length).toBeGreaterThan(0);
    }
  });

  it("emits zero gaps when all calls succeed", async () => {
    const bridge = createSmartBridge();
    const execute = getExecuteTool(bridge);
    const result = await execute.handler({ code: "return await smart.extractPage()" });
    const data = parseResult(result) as PageEvidence & { gaps: CoverageGap[] };
    expect(data.gaps).toEqual([]);
  });

  it("gaps preserve original error messages", async () => {
    const failBridge = createSmartBridge();
    failBridge.send.mockImplementation(async (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case "get_connection_status": return { connectedTab: { url: "" } };
        case "detect_framework": return { detections: [] };
        case "capture_page": return { url: "https://test.com", title: "Test", network: {}, console: {}, cookies: {}, dom: {} };
        case "get_performance_metrics": throw new Error("CDP domain disabled");
        case "get_security_state": return { ok: true };
        case "detect_fonts": return { fonts: [] };
        case "get_accessibility_tree": return { tree: [], nodeCount: 0 };
        case "browser_evaluate": {
          const expr = String(msg.expression || "");
          if (expr.includes("meta[name=\"viewport\"]") && expr.includes("mediaQueryCount")) {
            return { result: { hasViewportMeta: false, viewportContent: null, mediaQueryCount: 0, isOverflowing: false }, type: "object" };
          }
          return { result: { _title: "T", _headings: [], _nav: [], _structuredData: [], _canonical: null }, type: "object" };
        }
        default: return { ok: true };
      }
    });
    const exec = getExecuteTool(failBridge);
    const result = await exec.handler({ code: "return await smart.extractPage()" });
    const data = parseResult(result) as PageEvidence & { gaps: CoverageGap[] };
    expect(data.gaps.length).toBe(1);
    expect(data.gaps[0].reason).toBe("CDP domain disabled");
  });
});

// ============================================================
// Phase 5: Comparison Scaffold
// ============================================================

describe("comparePages scaffold", () => {
  let bridge: ReturnType<typeof createSmartBridge>;
  let execute: ReturnType<typeof getExecuteTool>;

  beforeEach(() => {
    bridge = createSmartBridge();
    execute = getExecuteTool(bridge);
  });

  it("scaffold has 10 dimensions", async () => {
    const result = await execute.handler({
      code: `return await smart.comparePages("https://a.com", "https://b.com")`,
    });
    const data = parseResult(result) as ComparisonEvidence;
    expect(data.scaffold.dimensions.length).toBe(10);
  });

  it("each dimension has siteA, siteB, comparable flag", async () => {
    const result = await execute.handler({
      code: `return await smart.comparePages("https://a.com", "https://b.com")`,
    });
    const data = parseResult(result) as ComparisonEvidence;
    for (const dim of data.scaffold.dimensions) {
      expect(dim).toHaveProperty("name");
      expect(dim).toHaveProperty("siteA");
      expect(dim).toHaveProperty("siteB");
      expect(typeof dim.comparable).toBe("boolean");
      expect(["present", "absent", "degraded"]).toContain(dim.siteA.type);
      expect(["present", "absent", "degraded"]).toContain(dim.siteB.type);
    }
  });

  it("scaffold includes sharedFields and missingFields", async () => {
    const result = await execute.handler({
      code: `return await smart.comparePages("https://a.com", "https://b.com")`,
    });
    const data = parseResult(result) as ComparisonEvidence;
    expect(Array.isArray(data.scaffold.sharedFields)).toBe(true);
    expect(data.scaffold.missingFields).toHaveProperty("siteA");
    expect(data.scaffold.missingFields).toHaveProperty("siteB");
  });

  it("scaffold extracts comparable metrics", async () => {
    const result = await execute.handler({
      code: `return await smart.comparePages("https://a.com", "https://b.com")`,
    });
    const data = parseResult(result) as ComparisonEvidence;
    expect(Array.isArray(data.scaffold.metrics)).toBe(true);
    // Bridge mock returns LCP/FCP in performance.metrics
    const lcpMetric = data.scaffold.metrics.find(m => m.name === "LCP");
    expect(lcpMetric).toBeTruthy();
    expect(typeof lcpMetric!.siteA).toBe("number");
    expect(typeof lcpMetric!.siteB).toBe("number");
  });

  it("scaffold extracts metrics from real extension shape (webVitals + timing)", async () => {
    // Override bridge to return real extension perf shape
    const realPerfBridge = createSmartBridge();
    realPerfBridge.send.mockImplementation(async (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case "get_connection_status": return { connectedTab: { url: "" } };
        case "detect_framework": return { detections: [] };
        case "capture_page": return { url: "https://test.com", title: "Test", network: { total: 5 }, console: { total: 2 }, cookies: { total: 1 }, dom: { nodeCount: 100 } };
        case "get_performance_metrics": return {
          chrome: { documents: 1, frames: 1, jsEventListeners: 50, nodes: 200, taskDuration: 0.45, scriptDuration: 0.12, jsHeapUsedSize: 5000000 },
          webVitals: { lcp: 1100, cls: 0.05, fid: null },
          timing: { domContentLoaded: 450, load: 900, firstByte: 120, domInteractive: 350 },
        };
        case "get_security_state": return { securityState: "secure" };
        case "detect_fonts": return { fonts: ["Arial"] };
        case "get_accessibility_tree": return { tree: [], nodeCount: 0 };
        case "browser_navigate": return { ok: true };
        case "browser_evaluate": {
          const expr = String(msg.expression || "");
          if (expr.includes("meta[name=\"viewport\"]") && expr.includes("mediaQueryCount")) {
            return { result: { hasViewportMeta: true, viewportContent: "width=device-width", mediaQueryCount: 2, isOverflowing: false }, type: "object" };
          }
          return { result: { _title: "T", _headings: [], _nav: [], _structuredData: [], _canonical: null }, type: "object" };
        }
        default: return { ok: true };
      }
    });
    const exec = getExecuteTool(realPerfBridge);
    const result = await exec.handler({
      code: `return await smart.comparePages("https://a.com", "https://b.com")`,
    });
    const data = parseResult(result) as ComparisonEvidence;
    const metricNames = data.scaffold.metrics.map(m => m.name);
    expect(metricNames).toContain("LCP");
    expect(metricNames).toContain("CLS");
    expect(metricNames).toContain("TTFB");
    expect(metricNames).toContain("taskDuration");
    expect(metricNames).toContain("networkRequests");
    expect(metricNames).toContain("domNodeCount");
    const lcpMetric = data.scaffold.metrics.find(m => m.name === "LCP")!;
    expect(lcpMetric.siteA).toBe(1100);
    expect(lcpMetric.siteB).toBe(1100);
  });

  it("dimensions include expected names", async () => {
    const result = await execute.handler({
      code: `return await smart.comparePages("https://a.com", "https://b.com")`,
    });
    const data = parseResult(result) as ComparisonEvidence;
    const names = data.scaffold.dimensions.map(d => d.name);
    expect(names).toContain("framework");
    expect(names).toContain("performance");
    expect(names).toContain("security");
    expect(names).toContain("seo");
    expect(names).toContain("mobile-readiness");
  });
});

// ============================================================
// Phase 6: Method Telemetry
// ============================================================

describe("extractPage trace", () => {
  it("returns _trace when trace: true", async () => {
    const bridge = createSmartBridge();
    const execute = getExecuteTool(bridge);
    const result = await execute.handler({
      code: "return await smart.extractPage({ trace: true })",
    });
    const data = parseResult(result);
    expect(data._trace).toBeTruthy();
    expect(data._trace.method).toBe("extractPage");
    expect(typeof data._trace.elapsed).toBe("number");
    expect(typeof data._trace.startedAt).toBe("number");
    expect(Array.isArray(data._trace.steps)).toBe(true);
    expect(data._trace.steps.length).toBeGreaterThan(0);
    expect(["success", "partial", "timeout", "error"]).toContain(data._trace.outcome);
  });

  it("does not return _trace when trace not requested", async () => {
    const bridge = createSmartBridge();
    const execute = getExecuteTool(bridge);
    const result = await execute.handler({
      code: "return await smart.extractPage()",
    });
    const data = parseResult(result);
    expect(data._trace).toBeUndefined();
  });

  it("trace steps include all parallel calls", async () => {
    const bridge = createSmartBridge();
    const execute = getExecuteTool(bridge);
    const result = await execute.handler({
      code: "return await smart.extractPage({ trace: true })",
    });
    const data = parseResult(result);
    const stepNames = data._trace.steps.map((s: { name: string }) => s.name);
    expect(stepNames).toContain("capture_page");
    expect(stepNames).toContain("get_performance_metrics");
    expect(stepNames).toContain("get_security_state");
    expect(stepNames).toContain("detect_fonts");
    expect(stepNames).toContain("meta_extraction");
    expect(stepNames).toContain("accessibility_tree");
    expect(stepNames).toContain("mobile_readiness");
  });

  it("trace shows partial outcome on failures", async () => {
    const failBridge = createSmartBridge();
    failBridge.send.mockImplementation(async (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case "get_connection_status": return { connectedTab: { url: "" } };
        case "detect_framework": return { detections: [] };
        case "capture_page": return { url: "https://test.com", title: "Test", network: {}, console: {}, cookies: {}, dom: {} };
        case "get_performance_metrics": throw new Error("fail");
        case "get_security_state": return { ok: true };
        case "detect_fonts": return { fonts: [] };
        case "get_accessibility_tree": return { tree: [], nodeCount: 0 };
        case "browser_evaluate": {
          const expr = String(msg.expression || "");
          if (expr.includes("meta[name=\"viewport\"]") && expr.includes("mediaQueryCount")) {
            return { result: { hasViewportMeta: false, viewportContent: null, mediaQueryCount: 0, isOverflowing: false }, type: "object" };
          }
          return { result: { _title: "T", _headings: [], _nav: [], _structuredData: [], _canonical: null }, type: "object" };
        }
        default: return { ok: true };
      }
    });
    const exec = getExecuteTool(failBridge);
    const result = await exec.handler({ code: "return await smart.extractPage({ trace: true })" });
    const data = parseResult(result);
    expect(data._trace.outcome).toBe("partial");
  });
});

// ============================================================
// Phase 7: Accessibility & Mobile Readiness Dimensions
// ============================================================

describe("extractPage accessibility", () => {
  it("returns AccessibilitySummary from tree data", async () => {
    const bridge = createSmartBridge();
    const execute = getExecuteTool(bridge);
    const result = await execute.handler({ code: "return await smart.extractPage()" });
    const data = parseResult(result) as PageEvidence & { gaps: CoverageGap[] };
    expect(data.accessibility).toBeTruthy();
    expect(data.accessibility!.nodeCount).toBeGreaterThan(0);
    expect(data.accessibility!.landmarkCount).toBe(3); // banner, main, navigation
    expect(data.accessibility!.imagesWithoutAlt).toBe(1); // one img with empty name
    expect(data.accessibility!.headingStructure.length).toBe(1);
    expect(data.accessibility!.headingStructure[0].level).toBe(1);
  });

  it("returns null when accessibility tree fails", async () => {
    const failBridge = createSmartBridge();
    failBridge.send.mockImplementation(async (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case "get_connection_status": return { connectedTab: { url: "" } };
        case "detect_framework": return { detections: [] };
        case "capture_page": return { url: "https://test.com", title: "Test", network: {}, console: {}, cookies: {}, dom: {} };
        case "get_performance_metrics": return { metrics: { LCP: 1000 } };
        case "get_security_state": return { securityState: "secure" };
        case "detect_fonts": return { fonts: [] };
        case "get_accessibility_tree": throw new Error("a11y not supported");
        case "browser_evaluate": {
          const expr = String(msg.expression || "");
          if (expr.includes("meta[name=\"viewport\"]")) return { result: { hasViewportMeta: true, viewportContent: "width=device-width", mediaQueryCount: 0, isOverflowing: false }, type: "object" };
          return { result: { _title: "T", _headings: [], _nav: [], _structuredData: [], _canonical: null }, type: "object" };
        }
        default: return { ok: true };
      }
    });
    const exec = getExecuteTool(failBridge);
    const result = await exec.handler({ code: "return await smart.extractPage()" });
    const data = parseResult(result) as PageEvidence & { gaps: CoverageGap[] };
    expect(data.accessibility).toBeNull();
    expect(data.gaps.some(g => g.dimension === "accessibility")).toBe(true);
  });
});

describe("extractPage mobileReadiness", () => {
  it("returns MobileReadiness from evaluate", async () => {
    const bridge = createSmartBridge();
    const execute = getExecuteTool(bridge);
    const result = await execute.handler({ code: "return await smart.extractPage()" });
    const data = parseResult(result) as PageEvidence & { gaps: CoverageGap[] };
    expect(data.mobileReadiness).toBeTruthy();
    expect(data.mobileReadiness!.hasViewportMeta).toBe(true);
    expect(data.mobileReadiness!.viewportContent).toBe("width=device-width, initial-scale=1");
    expect(data.mobileReadiness!.mediaQueryCount).toBe(3);
    expect(data.mobileReadiness!.isOverflowing).toBe(false);
  });
});

// ============================================================
// Phase 8: Confidence Propagation
// ============================================================

describe("confidence propagation", () => {
  it("caps confidence when dimension has active gap with reducesConfidence", async () => {
    // Use a bridge where performance fails (creates gap with reducesConfidence: true)
    const failBridge = createSmartBridge();
    failBridge.send.mockImplementation(async (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case "get_connection_status": return { connectedTab: { url: "" } };
        case "detect_framework": return { detections: [] };
        case "capture_page": return { url: "https://test.com", title: "Test", network: {}, console: {}, cookies: {}, dom: {} };
        case "get_performance_metrics": throw new Error("perf fail");
        case "get_security_state": return { securityState: "secure" };
        case "detect_fonts": return { fonts: [] };
        case "get_accessibility_tree": return { tree: [], nodeCount: 0 };
        case "browser_evaluate": {
          const expr = String(msg.expression || "");
          if (expr.includes("meta[name=\"viewport\"]")) return { result: { hasViewportMeta: true, viewportContent: "width=device-width", mediaQueryCount: 0, isOverflowing: false }, type: "object" };
          return { result: { _title: "T", _headings: [], _nav: [], _structuredData: [], _canonical: null }, type: "object" };
        }
        default: return { ok: true };
      }
    });
    const exec = getExecuteTool(failBridge);
    // First call extractPage to populate sessionGaps
    await exec.handler({ code: "smart.clearFindings(); return await smart.extractPage()" });
    // Now create a finding with dimension="performance" — should be capped
    const result = await exec.handler({
      code: `return smart.finding({
        claim: "Page is slow",
        evidence: ["LCP > 2000ms"],
        sourceUrl: "https://test.com",
        confidence: "high",
        method: "extractPage",
        dimension: "performance",
      })`,
    });
    const finding = parseResult(result) as Finding;
    expect(finding.confidence).toBe("medium"); // high → medium
    expect(finding.confidenceCapped).toBe(true);
    expect(finding.cappedBy).toBe("performance");
  });

  it("does not cap confidence when dimension has no gap", async () => {
    const bridge = createSmartBridge();
    const execute = getExecuteTool(bridge);
    // extractPage with all calls succeeding — no gaps
    await execute.handler({ code: "smart.clearFindings(); return await smart.extractPage()" });
    const result = await execute.handler({
      code: `return smart.finding({
        claim: "Security is good",
        evidence: ["TLS 1.3"],
        sourceUrl: "https://test.com",
        confidence: "high",
        method: "extractPage",
        dimension: "security",
      })`,
    });
    const finding = parseResult(result) as Finding;
    expect(finding.confidence).toBe("high");
    expect(finding.confidenceCapped).toBeUndefined();
  });

  it("does not cap when dimension doesn't match any gap", async () => {
    const failBridge = createSmartBridge();
    failBridge.send.mockImplementation(async (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case "get_connection_status": return { connectedTab: { url: "" } };
        case "detect_framework": return { detections: [] };
        case "capture_page": return { url: "https://test.com", title: "Test", network: {}, console: {}, cookies: {}, dom: {} };
        case "get_performance_metrics": throw new Error("perf fail");
        case "get_security_state": return { securityState: "secure" };
        case "detect_fonts": return { fonts: [] };
        case "get_accessibility_tree": return { tree: [], nodeCount: 0 };
        case "browser_evaluate": {
          const expr = String(msg.expression || "");
          if (expr.includes("meta[name=\"viewport\"]")) return { result: { hasViewportMeta: true, viewportContent: "width=device-width", mediaQueryCount: 0, isOverflowing: false }, type: "object" };
          return { result: { _title: "T", _headings: [], _nav: [], _structuredData: [], _canonical: null }, type: "object" };
        }
        default: return { ok: true };
      }
    });
    const exec = getExecuteTool(failBridge);
    await exec.handler({ code: "smart.clearFindings(); return await smart.extractPage()" });
    // Finding with dimension="fonts" — fonts gap has reducesConfidence: false
    const result = await exec.handler({
      code: `return smart.finding({
        claim: "Font loading issue",
        evidence: ["fonts failed"],
        sourceUrl: "https://test.com",
        confidence: "high",
        method: "extractPage",
        dimension: "fonts",
      })`,
    });
    const finding = parseResult(result) as Finding;
    expect(finding.confidence).toBe("high"); // fonts gap has reducesConfidence: false
    expect(finding.confidenceCapped).toBeUndefined();
  });

  it("caps medium to low", async () => {
    const failBridge = createSmartBridge();
    failBridge.send.mockImplementation(async (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case "get_connection_status": return { connectedTab: { url: "" } };
        case "detect_framework": return { detections: [] };
        case "capture_page": return { url: "https://test.com", title: "Test", network: {}, console: {}, cookies: {}, dom: {} };
        case "get_performance_metrics": return { metrics: { LCP: 1000 } };
        case "get_security_state": throw new Error("sec fail");
        case "detect_fonts": return { fonts: [] };
        case "get_accessibility_tree": return { tree: [], nodeCount: 0 };
        case "browser_evaluate": {
          const expr = String(msg.expression || "");
          if (expr.includes("meta[name=\"viewport\"]")) return { result: { hasViewportMeta: true, viewportContent: "width=device-width", mediaQueryCount: 0, isOverflowing: false }, type: "object" };
          return { result: { _title: "T", _headings: [], _nav: [], _structuredData: [], _canonical: null }, type: "object" };
        }
        default: return { ok: true };
      }
    });
    const exec = getExecuteTool(failBridge);
    await exec.handler({ code: "smart.clearFindings(); return await smart.extractPage()" });
    const result = await exec.handler({
      code: `return smart.finding({
        claim: "Missing HTTPS",
        evidence: ["no TLS"],
        sourceUrl: "https://test.com",
        confidence: "medium",
        method: "extractPage",
        dimension: "security",
      })`,
    });
    const finding = parseResult(result) as Finding;
    expect(finding.confidence).toBe("low"); // medium → low
    expect(finding.confidenceCapped).toBe(true);
    expect(finding.cappedBy).toBe("security");
  });
});

// ============================================================
// Phase 9: Evidence Aggregation
// ============================================================

describe("evidence aggregation", () => {
  it("accumulates findings across multiple calls", async () => {
    const bridge = createSmartBridge();
    const execute = getExecuteTool(bridge);
    await execute.handler({ code: "smart.clearFindings()" });
    await execute.handler({
      code: `smart.finding({ claim: "A", evidence: ["e1"], sourceUrl: "https://a.com", confidence: "high", method: "m" })`,
    });
    await execute.handler({
      code: `smart.finding({ claim: "B", evidence: ["e2"], sourceUrl: "https://b.com", confidence: "low", method: "m" })`,
    });
    const result = await execute.handler({ code: "return smart.findings()" });
    const findings = parseResult(result) as Finding[];
    expect(findings.length).toBe(2);
    expect(findings[0].claim).toBe("A");
    expect(findings[1].claim).toBe("B");
  });

  it("clearFindings resets accumulator", async () => {
    const bridge = createSmartBridge();
    const execute = getExecuteTool(bridge);
    await execute.handler({
      code: `smart.finding({ claim: "X", evidence: ["e"], sourceUrl: "https://x.com", confidence: "high", method: "m" })`,
    });
    await execute.handler({ code: "smart.clearFindings()" });
    const result = await execute.handler({ code: "return smart.findings()" });
    const findings = parseResult(result) as Finding[];
    expect(findings.length).toBe(0);
  });

  it("findings returns a copy (not the internal array)", async () => {
    const bridge = createSmartBridge();
    const execute = getExecuteTool(bridge);
    await execute.handler({ code: "smart.clearFindings()" });
    await execute.handler({
      code: `smart.finding({ claim: "C", evidence: ["e"], sourceUrl: "https://c.com", confidence: "medium", method: "m" })`,
    });
    // Mutating the returned array should not affect internal state
    const result = await execute.handler({
      code: `const arr = smart.findings(); arr.length = 0; return smart.findings().length`,
    });
    const length = parseResult(result);
    expect(length).toBe(1);
  });
});
