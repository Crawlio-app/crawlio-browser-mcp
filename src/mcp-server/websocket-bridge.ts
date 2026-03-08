import { WebSocketServer, WebSocket } from "ws";
import { createServer, type Server } from "http";
import { randomUUID } from "crypto";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, writeFileSync, unlinkSync, readdirSync, readFileSync } from "node:fs";
import { WS_PORT, WS_PORT_MAX, WS_HOST, BRIDGE_DIR, TIMEOUTS, WS_HEARTBEAT_INTERVAL, WS_STALE_THRESHOLD, WS_RECONNECT_GRACE } from "../shared/constants.js";
import type { ServerCommand, ExtensionResponse } from "../shared/protocol.js";

// Resolve the absolute path to index.js for the setup page
function resolveIndexPath(): string {
  // Primary: process.argv[1] is the script Node is running
  if (process.argv[1] && process.argv[1].includes("dist")) {
    return process.argv[1];
  }
  // Fallback: resolve from this module's location
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const thisDir = dirname(thisFile);
    return resolve(thisDir, "index.js");
  } catch {
    return "<path-to-crawlio-browser>/dist/mcp-server/index.js";
  }
}

const RESOLVED_INDEX_PATH = resolveIndexPath();

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildSetupHTML(indexPath: string): string {
  const cmd = escapeHtml(`claude mcp add crawlio-browser -- node ${indexPath} --portal`);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Crawlio Setup</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      line-height: 1.6;
      color: rgba(0,0,0,0.6);
      background: #fff;
      padding: 48px 24px;
    }
    .container { max-width: 640px; margin: 0 auto; }
    .breadcrumb { font-size: 14px; color: rgba(0,0,0,0.25); margin-bottom: 24px; }
    .breadcrumb a { color: rgba(0,0,0,0.25); text-decoration: none; }
    .breadcrumb a:hover { color: rgba(0,0,0,0.6); }
    .breadcrumb span { color: rgba(0,0,0,0.4); }
    h1 { font-size: 30px; font-weight: 500; color: rgba(0,0,0,0.87); margin-bottom: 8px; letter-spacing: -0.02em; }
    header p { color: rgba(0,0,0,0.4); font-size: 16px; margin-bottom: 40px; }
    .step { margin-bottom: 32px; }
    .step-label { font-size: 13px; font-weight: 500; color: #7c3aed; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; }
    .step h2 { font-size: 18px; font-weight: 500; color: rgba(0,0,0,0.87); margin-bottom: 8px; }
    .step p { color: rgba(0,0,0,0.6); font-size: 15px; margin-bottom: 16px; line-height: 1.7; }
    .code-wrap {
      background: #f0f0f4;
      border-radius: 12px;
      overflow: hidden;
    }
    .code-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px 0;
    }
    .dots { display: flex; gap: 6px; }
    .dots span { width: 10px; height: 10px; border-radius: 50%; }
    .dot-r { background: #ef4444; }
    .dot-y { background: #eab308; }
    .dot-g { background: #22c55e; }
    .code-actions { display: flex; align-items: center; gap: 8px; }
    .lang-tag { font-size: 12px; color: rgba(0,0,0,0.3); font-weight: 500; }
    #copy-btn {
      background: none;
      border: none;
      color: rgba(0,0,0,0.3);
      cursor: pointer;
      padding: 4px;
      display: flex;
      align-items: center;
      transition: color 0.15s;
    }
    #copy-btn:hover { color: rgba(0,0,0,0.6); }
    .code-body {
      padding: 16px 20px 20px;
      overflow-x: auto;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      line-height: 1.6;
      color: rgba(0,0,0,0.7);
    }
    .code-body code { white-space: pre; }
    .inline-code {
      background: rgba(124,58,237,0.1);
      color: #7c3aed;
      padding: 2px 6px;
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 14px;
    }
    .divider { height: 1px; background: rgba(0,0,0,0.06); margin: 32px 0; }
    .footer { margin-top: 48px; padding-top: 24px; border-top: 1px solid rgba(0,0,0,0.06); font-size: 13px; color: rgba(0,0,0,0.25); text-align: center; }
    .footer a { color: #7c3aed; text-decoration: none; }
    .footer a:hover { text-decoration: underline; }
    .success-badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(34,197,94,0.1); color: #16a34a; font-size: 13px; font-weight: 500; padding: 6px 12px; border-radius: 20px; margin-bottom: 24px; }
    .success-badge svg { flex-shrink: 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="breadcrumb"><a href="https://docs.crawlio.app/browser-agent">Browser Agent</a> <span>/</span> Setup</div>
    <header>
      <div class="success-badge"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Extension authorized</div>
      <h1>Set up MCP server</h1>
      <p>Connect your AI agent to the browser</p>
    </header>
    <main>
      <div class="step">
        <div class="step-label">Step 1</div>
        <h2>Add the MCP server</h2>
        <p>Run this command in your terminal:</p>
        <div class="code-wrap">
          <div class="code-header">
            <div class="dots"><span class="dot-r"></span><span class="dot-y"></span><span class="dot-g"></span></div>
            <div class="code-actions">
              <span class="lang-tag">BASH</span>
              <button onclick="copyCmd()" id="copy-btn" title="Copy"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
            </div>
          </div>
          <div class="code-body"><code id="cmd">${cmd}</code></div>
        </div>
      </div>
      <div class="divider"></div>
      <div class="step">
        <div class="step-label">Step 2</div>
        <h2>Start automating</h2>
        <p>Open your AI application and start using Crawlio tools. Try asking your AI to <span class="inline-code">connect_tab</span> or <span class="inline-code">capture_page</span>.</p>
      </div>
    </main>
    <div class="footer">Need help? Visit the <a href="https://docs.crawlio.app/browser-agent/welcome">full documentation</a></div>
  </div>
  <script>
    function copyCmd() {
      var text = document.getElementById('cmd').textContent;
      navigator.clipboard.writeText(text).then(function() {
        var btn = document.getElementById('copy-btn');
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
        setTimeout(function() { btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'; }, 2000);
      });
    }
  </script>
</body>
</html>`;
}

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface QueuedMessage {
  message: string;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  enqueueTime: number;
  timeoutMs: number;
}

const MAX_QUEUE_SIZE = 100;
const DEFAULT_MSG_TIMEOUT = 30_000;

export class MessageQueue {
  private queue: QueuedMessage[] = [];

  enqueue(message: string, timeoutMs = DEFAULT_MSG_TIMEOUT): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (this.queue.length >= MAX_QUEUE_SIZE) {
        const oldest = this.queue.shift();
        oldest?.reject(new Error("Queue overflow — message evicted"));
      }
      const item: QueuedMessage = { message, resolve, reject, enqueueTime: Date.now(), timeoutMs };
      this.queue.push(item);
      // Independent timeout — reject if not drained before expiry (prevents infinite hang when WS never connects)
      setTimeout(() => {
        const idx = this.queue.indexOf(item);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          reject(new Error(`Queued message expired after ${timeoutMs}ms — extension not connected`));
        }
      }, timeoutMs);
    });
  }

  async drain(sendFn: (msg: string, resolve: (v: unknown) => void, reject: (e: Error) => void) => Promise<void>): Promise<void> {
    while (this.queue.length > 0) {
      const item = this.queue.shift()!;
      if (Date.now() - item.enqueueTime > item.timeoutMs) {
        item.reject(new Error("Queued message expired"));
        continue;
      }
      try {
        // sendFn registers item.resolve/reject in the pending map, but the returned
        // promise resolves on transmission confirmation — not on response receipt.
        // This prevents head-of-line blocking: a slow response (e.g. 30s navigate)
        // no longer blocks subsequent queued items from being transmitted.
        await sendFn(item.message, item.resolve as (v: unknown) => void, item.reject as (e: Error) => void);
      } catch (error) {
        item.reject(error instanceof Error ? error : new Error(String(error)));
        break; // Stop draining — connection likely lost, preserve remaining items
      }
      await new Promise(r => setTimeout(r, 50));
    }
  }

  get depth(): number { return this.queue.length; }

  clear(): void {
    for (const item of this.queue) {
      item.reject(new Error("Queue cleared — connection reset"));
    }
    this.queue = [];
  }
}

interface ConnectionHealth {
  connected: boolean;
  latencyMs: number;
  uptime: number;
  reconnects: number;
  queueDepth: number;
}

const HEARTBEAT_INTERVAL = WS_HEARTBEAT_INTERVAL;
const STALE_THRESHOLD = WS_STALE_THRESHOLD;

async function findAvailablePort(start: number): Promise<number> {
  for (let port = start; port <= WS_PORT_MAX; port++) {
    try {
      const res = await fetch(`http://${WS_HOST}:${port}/health`, {
        signal: AbortSignal.timeout(300),
      });
      const body = await res.json() as { service?: string; pid?: number };
      if (body.service === "crawlio-mcp" && body.pid === process.pid) {
        return port; // Our own zombie — safe to reuse
      }
      // Another live crawlio-mcp — skip this port
    } catch {
      return port; // Port free (connection refused) — use it
    }
  }
  throw new Error(`All ports ${WS_PORT}-${WS_PORT_MAX} in use by crawlio-mcp instances`);
}

function cleanStaleBridgeFiles(): void {
  try {
    const files = readdirSync(BRIDGE_DIR);
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = JSON.parse(readFileSync(join(BRIDGE_DIR, file), "utf-8")) as { pid?: number };
        if (data.pid && data.pid !== process.pid) {
          try { process.kill(data.pid, 0); } catch {
            // Process doesn't exist — remove stale file
            try { unlinkSync(join(BRIDGE_DIR, file)); } catch {}
          }
        }
      } catch { /* invalid JSON or read error — remove */
        try { unlinkSync(join(BRIDGE_DIR, file)); } catch {}
      }
    }
  } catch { /* BRIDGE_DIR doesn't exist yet — fine */ }
}

function writeBridgeFile(port: number): string {
  mkdirSync(BRIDGE_DIR, { recursive: true });
  const bridgeFile = join(BRIDGE_DIR, `${process.pid}.json`);
  writeFileSync(bridgeFile, JSON.stringify({
    port,
    pid: process.pid,
    cwd: process.cwd(),
    startedAt: Date.now(),
  }));
  return bridgeFile;
}

function removeBridgeFile(): void {
  try { unlinkSync(join(BRIDGE_DIR, `${process.pid}.json`)); } catch {}
}

export class WebSocketBridge {
  private wss: WebSocketServer | null = null;
  private httpServer: Server | null = null;
  private client: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private messageQueue = new MessageQueue();

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPong = 0;
  private lastPingSent = 0;
  private latencyMs = 0;
  private connectTime = 0;
  private reconnectCount = -1; // first connection is not a "reconnect"
  private actualPort = WS_PORT;

  onClientConnected?: () => void;
  onPortRefreshRequested?: () => void;

  get port(): number { return this.actualPort; }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.client?.readyState === WebSocket.OPEN) {
        this.lastPingSent = Date.now();
        this.client.ping();
        if (this.lastPong > 0 && Date.now() - this.lastPong > STALE_THRESHOLD) {
          console.error(`[Bridge] WebSocket stale — no pong in ${STALE_THRESHOLD / 1000}s, closing`);
          this.client.terminate();
        }
      }
    }, HEARTBEAT_INTERVAL);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  getHealth(): ConnectionHealth {
    return {
      connected: this.isConnected,
      latencyMs: this.latencyMs,
      uptime: this.connectTime > 0 && this.isConnected ? Date.now() - this.connectTime : 0,
      reconnects: Math.max(0, this.reconnectCount),
      queueDepth: this.messageQueue.depth,
    };
  }

  push(data: unknown): void {
    if (!this.isConnected) return;
    this.client!.send(JSON.stringify(data));
  }

  async start(): Promise<void> {
    this.httpServer = createServer((req, res) => {
      if (req.url === "/setup") {
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(buildSetupHTML(RESOLVED_INDEX_PATH));
        return;
      }
      if (req.url === "/health") {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        });
        res.end(JSON.stringify({ service: "crawlio-mcp", pid: process.pid, port: this.actualPort, ...this.getHealth() }));
        return;
      }
      // CORS preflight for extension fetch (no host_permissions)
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Max-Age": "86400",
        });
        res.end();
        return;
      }
      res.writeHead(426);
      res.end("Upgrade Required");
    });

    this.wss = new WebSocketServer({
      server: this.httpServer,
      maxPayload: 10 * 1024 * 1024, // 10 MB — prevents memory exhaustion
      verifyClient: (
        info: { origin?: string; secure: boolean; req: import("http").IncomingMessage },
        callback: (result: boolean, code?: number, message?: string) => void
      ) => {
        const origin = info.origin;
        // No origin header — Node.js clients (stdio), some extension contexts
        if (!origin || origin === "null") { callback(true); return; }
        // Chrome extension service workers: Origin: chrome-extension://<id>
        if (origin.startsWith("chrome-extension://")) { callback(true); return; }
        // Local origins (other local tools, web UIs on localhost)
        try {
          const url = new URL(origin);
          if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
            callback(true); return;
          }
        } catch { /* invalid URL — fall through to reject */ }
        // Reject with 403 (NOT 401) — 401 triggers Chrome's "HTTP Authentication failed" error
        console.error(`[Bridge] WebSocket origin rejected: ${origin}`);
        callback(false, 403, "Forbidden");
      },
    });

    this.wss.on("connection", (ws) => {
      if (this.client && this.client.readyState === WebSocket.OPEN) {
        console.error("[Bridge] Evicting stale client — new connection");
        this.client.close(1000, "Replaced by new connection");
      }
      console.error(`[Bridge] Extension connected`);
      // Cancel grace timer — preserve pending commands for resolution on new connection.
      // The pending map is keyed by command ID: if the extension processed a command
      // before disconnecting, it can send the response on this new connection.
      if (this.reconnectGraceTimer) {
        clearTimeout(this.reconnectGraceTimer);
        this.reconnectGraceTimer = null;
        if (this.pending.size > 0) {
          console.error(`[Bridge] Reconnect within grace period — ${this.pending.size} pending commands preserved`);
        }
      }
      this.client = ws;
      this.reconnectCount++;
      this.connectTime = Date.now();
      this.lastPong = Date.now();
      this.latencyMs = 0;
      this.startHeartbeat();
      this.onClientConnected?.();

      ws.on("pong", () => {
        this.lastPong = Date.now();
        if (this.lastPingSent > 0) {
          this.latencyMs = this.lastPong - this.lastPingSent;
        }
      });

      if (this.messageQueue.depth > 0) {
        console.error(`[Bridge] Draining ${this.messageQueue.depth} queued messages`);
        this.messageQueue.drain((msg, resolve, reject) => {
          return new Promise<void>((txResolve, txReject) => {
            if (!this.isConnected) { txReject(new Error("Disconnected during drain")); return; }
            const parsed = JSON.parse(msg) as ServerCommand;
            const timer = setTimeout(() => {
              this.pending.delete(parsed.id);
              reject(new Error(`Queued command timed out: ${parsed.type}`));
            }, TIMEOUTS.WS_COMMAND);
            this.pending.set(parsed.id, { resolve, reject, timer });
            this.client!.send(msg, (err) => {
              if (err) {
                clearTimeout(timer);
                this.pending.delete(parsed.id);
                txReject(err);
              } else {
                txResolve(); // Transmission confirmed — response handled by pending map
              }
            });
          });
        }).catch((e) => console.error("[Bridge] Queue drain error:", e));
      }

      ws.on("message", (raw) => {
        try {
          const len = typeof raw === "string" ? Buffer.byteLength(raw) : (raw as Buffer).length;
          if (len > 5 * 1024 * 1024) {
            console.error(`[Bridge] Oversized message dropped: ${(len / 1024 / 1024).toFixed(1)} MB`);
            return;
          }
          const msg: ExtensionResponse = JSON.parse(raw.toString());
          if (msg.type === "refresh_port") {
            this.onPortRefreshRequested?.();
            return;
          }
          this.handleMessage(msg);
        } catch (e) {
          console.error("[Bridge] Invalid message:", e);
        }
      });

      ws.on("error", (err) => {
        // Only log if this is still the active client (not an evicted stale connection)
        if (this.client === ws) {
          console.error("[Bridge] WebSocket error:", err.message);
        }
      });

      ws.on("close", () => {
        // Guard: only act if THIS ws is still the active client.
        // When the extension reconnects, the old ws's close fires async
        // AFTER this.client already points to the new connection.
        if (this.client !== ws) {
          console.error("[Bridge] Stale client closed (already replaced)");
          return;
        }
        console.error("[Bridge] Extension disconnected");
        this.stopHeartbeat();
        this.client = null;
        this.connectTime = 0;
        // Grace period: wait for extension to reconnect before rejecting pending commands
        // (Playwright MCP #1140 — premature session deletion on transport close)
        if (this.pending.size > 0) {
          console.error(`[Bridge] ${this.pending.size} pending commands — waiting ${WS_RECONNECT_GRACE / 1000}s for reconnect`);
          this.reconnectGraceTimer = setTimeout(() => {
            this.reconnectGraceTimer = null;
            for (const [id, req] of this.pending) {
              clearTimeout(req.timer);
              req.reject(new Error("Extension disconnected"));
              this.pending.delete(id);
            }
          }, WS_RECONNECT_GRACE);
        }
      });
    });

    this.wss.on("wsClientError", (err: Error, socket: import("stream").Duplex) => {
      console.error("[Bridge] WebSocket handshake error:", err.message);
      socket.destroy();
    });

    // Clean stale bridge files from dead processes
    cleanStaleBridgeFiles();

    // Dynamic port selection — find first free port in range
    const requestedPort = parseInt(process.env.CRAWLIO_PORT || "", 10);
    const startPort = (requestedPort >= WS_PORT && requestedPort <= WS_PORT_MAX)
      ? requestedPort : WS_PORT;
    this.actualPort = await findAvailablePort(startPort);

    // Retry port binding up to 3 times with backoff
    await new Promise<void>((resolve, reject) => {
      let attempts = 0;
      const tryListen = () => {
        const onError = (err: NodeJS.ErrnoException) => {
          if (err.code === "EADDRINUSE" && attempts < 3) {
            attempts++;
            console.error(`[Bridge] Port ${this.actualPort} still in use, retry ${attempts}/3...`);
            setTimeout(tryListen, 1000 * attempts);
          } else {
            reject(err);
          }
        };
        this.httpServer!.once("error", onError);
        this.httpServer!.listen(this.actualPort, WS_HOST, () => {
          this.httpServer!.removeListener("error", onError);
          console.error(`[Bridge] WebSocket server listening on ws://${WS_HOST}:${this.actualPort}`);
          resolve();
        });
      };
      tryListen();
    });

    // Write bridge file for extension discovery
    writeBridgeFile(this.actualPort);

    // Cleanup on exit
    const cleanup = () => removeBridgeFile();
    process.on("SIGTERM", cleanup);
    process.on("SIGINT", cleanup);
    process.on("beforeExit", cleanup);
  }

  get isConnected(): boolean {
    return this.client?.readyState === WebSocket.OPEN;
  }

  get queueDepth(): number { return this.messageQueue.depth; }

  async send(command: Omit<ServerCommand, "id"> & Record<string, unknown>, timeout: number = TIMEOUTS.WS_COMMAND): Promise<unknown> {
    const id = randomUUID();
    const fullCommand = { ...command, id } as ServerCommand;
    const serialized = JSON.stringify(fullCommand);

    if (!this.isConnected) {
      console.error(`[Bridge] Queuing command (offline): ${command.type} (queue depth: ${this.messageQueue.depth + 1})`);
      const queueTimeout = Math.max(timeout, 45_000);
      return this.messageQueue.enqueue(serialized, queueTimeout);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Command timed out after ${timeout}ms: ${command.type}`));
      }, timeout);

      this.pending.set(id, { resolve, reject, timer });
      this.client!.send(serialized, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private handleMessage(msg: ExtensionResponse): void {
    // Extension-initiated actions (fire-and-forget, no response expected)
    if (msg.type === "open_crawlio_app") {
      import("child_process").then(({ execFile }) => {
        execFile("open", ["-a", "Crawlio"], () => {});
      }).catch(() => {});
      return;
    }

    if (msg.type === "connected") {
      console.error(`[Bridge] Extension identified: ${msg.extensionId}`);
      return;
    }

    if (msg.type === "pong") {
      const req = this.pending.get(msg.id);
      if (req) {
        clearTimeout(req.timer);
        req.resolve("pong");
        this.pending.delete(msg.id);
      }
      return;
    }

    if (msg.type === "response") {
      const req = this.pending.get(msg.id);
      if (req) {
        clearTimeout(req.timer);
        if (msg.success) {
          req.resolve(msg.data ?? {});
        } else {
          const err = new Error(msg.error ?? "Unknown extension error");
          // Preserve permission-related fields from the extension response
          const wire = msg as unknown as Record<string, unknown>;
          if (wire.permission_required) {
            const errObj = err as unknown as Record<string, unknown>;
            errObj.permission_required = true;
            errObj.missing = wire.missing;
            errObj.suggestion = wire.suggestion;
          }
          req.reject(err);
        }
        this.pending.delete(msg.id);
      }
    }
  }

  async stop(): Promise<void> {
    this.stopHeartbeat();
    if (this.reconnectGraceTimer) { clearTimeout(this.reconnectGraceTimer); this.reconnectGraceTimer = null; }
    this.messageQueue.clear();
    this.client?.close();
    this.wss?.close();
    this.httpServer?.close();
    removeBridgeFile();
  }
}
