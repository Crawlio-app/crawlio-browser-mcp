import { randomBytes } from "crypto";
import type { IncomingMessage, ServerResponse } from "http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ZodError } from "zod";
import rateLimit from "express-rate-limit";
import { PKG_VERSION } from "../shared/constants.js";
import { WebSocketBridge } from "./websocket-bridge.js";
import { CrawlioClient } from "./crawlio-client.js";
import { createTools, createCodeModeTools, TOOL_TIMEOUTS, toolError, ensurePermission, PERMISSION_EXEMPT_TOOLS } from "./tools.js";

process.title = "Crawlio Agent";

const initMode = process.argv.includes("init") || process.argv.includes("--setup") || process.argv.includes("setup");
if (initMode) {
  const { runInit } = await import("./init.js");
  await runInit(process.argv.slice(2));
  process.exit(0);
}

const codeMode = !process.argv.includes("--full");
if (process.argv.includes("--code-mode")) {
  console.error("[MCP] Note: --code-mode is now the default and can be removed");
}
const portalMode = process.argv.includes("--portal");
const portalPort = (() => {
  const idx = process.argv.indexOf("--port");
  return idx !== -1 ? parseInt(process.argv[idx + 1], 10) : 3001;
})();

const bridge = new WebSocketBridge();
const crawlio = new CrawlioClient();
const tools = codeMode ? createCodeModeTools(bridge, crawlio) : createTools(bridge, crawlio);

if (!codeMode) {
  console.error("[MCP] Full mode — exposing all 92 tools");
} else {
  console.error("[MCP] Code mode (default) — 3 tools (search, execute, connect_tab)");
}

function createMcpServer(): Server {
  const s = new Server(
    { name: "crawlio-browser", version: PKG_VERSION },
    { capabilities: { tools: {} } }
  );

  s.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  s.setRequestHandler(CallToolRequestSchema, async (request) => {
    const requestId = randomBytes(4).toString("hex");
    const toolName = request.params.name;
    const tool = tools.find((t) => t.name === toolName);
    if (!tool) {
      return toolError(`[${requestId}] Unknown tool: ${toolName}`);
    }

    if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
      const check = await ensurePermission(bridge, toolName);
      if (!check.allowed) {
        return toolError(check.error!);
      }
    }

    const timeout = TOOL_TIMEOUTS[toolName] ?? 30000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    try {
      const result = await Promise.race([
        tool.handler(request.params.arguments ?? {}),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () =>
            reject(new Error(`Tool '${toolName}' timed out after ${timeout}ms`))
          );
        }),
      ]);
      return result as {
        content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
      };
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ");
        return toolError(`[${requestId}] Invalid input: ${issues}`);
      }
      const msg = error instanceof Error ? error.message : String(error);
      return toolError(`[${requestId}] ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  });

  return s;
}

async function main() {
  await bridge.start();

  bridge.onClientConnected = async () => {
    try {
      const port = await crawlio.getPort();
      bridge.push({ type: "set_crawlio_port", port });
      console.error(`[MCP] Pushed Crawlio port ${port} to extension`);
    } catch (e) {
      console.error("[MCP] Could not push Crawlio port:", e);
    }
  };

  bridge.onPortRefreshRequested = async () => {
    try {
      const port = await crawlio.getPort();
      bridge.push({ type: "set_crawlio_port", port });
      console.error(`[MCP] Port refresh: pushed Crawlio port ${port}`);
    } catch (e) { console.error("[MCP] Port refresh failed:", e); }
  };

  if (portalMode) {
    await startPortalServer(portalPort);
  } else {
    const transport = new StdioServerTransport();
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
    console.error("[MCP] Crawlio Browser MCP server running (stdio)");

    // Graceful stdin close: when Claude Code disconnects, stdin emits 'end'.
    // Without this handler, pending reads silently stop and the server lingers.
    process.stdin.on("end", async () => {
      console.error("[MCP] stdin closed — client disconnected, shutting down");
      await bridge.stop();
      process.exit(0);
    });
  }
}

const ALLOWED_ORIGINS: RegExp[] = [
  /^https:\/\/.*\.cloudflare\.com$/,
  /^https:\/\/.*\.workers\.dev$/,
  /^https:\/\/.*\.crawlio\.app$/,
  /^https:\/\/crawlio\.app$/,
  /^chrome-extension:\/\//,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^http:\/\/localhost(:\d+)?$/,
];

async function startPortalServer(port: number): Promise<void> {
  const app = createMcpExpressApp({ host: "127.0.0.1" });

  // CORS — explicit origin allowlist (cloudflared does NOT handle CORS for proxied traffic)
  app.use((req: IncomingMessage & { method?: string }, res: ServerResponse & { status: (code: number) => ServerResponse & { end: () => void } }, next: () => void) => {
    const origin = req.headers.origin;
    if (origin) {
      const allowed = ALLOWED_ORIGINS.some(o => o.test(origin));
      if (allowed) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Credentials", "true");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Mcp-Session-Id");
      }
      res.setHeader("Vary", "Origin");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  // Rate limiting — 120 requests per minute per IP
  app.use(rateLimit({
    windowMs: 60_000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
  }));

  // --- SSE transport (deprecated, included for backward compatibility) ---
  const sseTransports = new Map<string, SSEServerTransport>();

  app.get("/sse", async (_req: IncomingMessage, res: ServerResponse) => {
    // CRITICAL: Disable Cloudflare proxy buffering for SSE
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Cache-Control", "no-cache");
    const transport = new SSEServerTransport("/message", res);
    sseTransports.set(transport.sessionId, transport);

    // SSE keepalive — prevent Cloudflare proxy timeout (100s idle limit)
    const keepalive = setInterval(() => {
      if (!res.writableEnded) res.write(": keepalive\n\n");
    }, 25_000);

    res.on("close", () => {
      clearInterval(keepalive);
      sseTransports.delete(transport.sessionId);
    });
    const sseServer = createMcpServer();
    await sseServer.connect(transport);
  });

  app.post("/message", async (req: IncomingMessage & { query?: Record<string, string> }, res: ServerResponse & { status: (code: number) => { json: (body: unknown) => void } }) => {
    const sessionId = req.query?.sessionId as string;
    const transport = sseTransports.get(sessionId);
    if (!transport) {
      res.status(400).json({ error: "Unknown session" });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  // --- Streamable HTTP transport (current MCP standard) ---
  app.post("/mcp", async (req: IncomingMessage & { body?: unknown }, res: ServerResponse) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    const mcpServer = createMcpServer();
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // --- Health endpoint ---
  app.get("/health", (_req: IncomingMessage, res: ServerResponse & { json: (body: unknown) => void }) => {
    res.json({
      status: "ok",
      version: PKG_VERSION,
      mode: codeMode ? "code" : "full",
      transport: "portal",
      bridgeConnected: bridge.isConnected,
      toolCount: tools.length,
      uptime: process.uptime(),
    });
  });

  app.listen(port, "127.0.0.1", () => {
    console.error(`[MCP] Portal server listening on http://127.0.0.1:${port}`);
    console.error(`[MCP]   SSE:        GET  /sse + POST /message`);
    console.error(`[MCP]   Streamable: POST /mcp`);
    console.error(`[MCP]   Health:     GET  /health`);
  });
}

main().catch((e) => {
  console.error("[MCP] Fatal:", e);
  process.exit(1);
});

// Prevent broken-pipe crashes: when Claude Code disconnects, writes to stdout/stderr
// throw EPIPE. Without these handlers, EPIPE becomes an uncaughtException → process.exit.
process.stdout.on("error", (err) => {
  if ((err as NodeJS.ErrnoException).code === "EPIPE") return; // expected on disconnect
  console.error("[MCP] stdout error:", err.message);
});
process.stderr.on("error", () => {}); // stderr errors are unrecoverable — swallow silently

// Crash diagnostics — log then crash for true exceptions (corrupted state).
process.on("uncaughtException", (err) => {
  // EPIPE on stdout/stderr is normal during MCP disconnect — don't crash
  if ((err as NodeJS.ErrnoException).code === "EPIPE") return;
  console.error("[MCP] CRASH — uncaughtException:", err.stack ?? err.message);
  process.exit(1);
});

// Unhandled rejections: log but do NOT crash — these are typically race conditions
// (WebSocket close during pending command, timeout after disconnect) that are transient.
process.on("unhandledRejection", (reason) => {
  console.error("[MCP] unhandledRejection (non-fatal):", reason instanceof Error ? reason.message : reason);
});

// Graceful shutdown — release port on exit
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.on(sig, async () => {
    console.error(`[MCP] ${sig} received, shutting down`);
    await bridge.stop();
    process.exit(0);
  });
}
