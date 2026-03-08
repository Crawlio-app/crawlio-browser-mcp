import { homedir } from "os";
import { join } from "path";

// Single source of truth — bump here, tests enforce sync with package.json
export const PKG_VERSION = "1.5.6";

export const WS_PORT = 9333;
export const WS_PORT_MAX = 9342;    // end of port range (inclusive) — 10 slots
export const WS_HOST = "127.0.0.1";

// Bridge discovery directory — each running server writes a JSON file here
export const BRIDGE_DIR = join(homedir(), ".crawlio", "bridges");

export const CRAWLIO_PORT_FILE = join(
  homedir(),
  "Library",
  "Logs",
  "Crawlio",
  "control.port"
);

export const TIMEOUTS = {
  WS_COMMAND: 30_000,       // 30s for most commands
  NETWORK_CAPTURE: 120_000, // 2min for network capture
  SCREENSHOT: 10_000,       // 10s
  RECONNECT: 3_000,         // 3s reconnect delay
  CODE_EXECUTE: 120_000,    // 2min for code-mode execute()
} as const;

// Bridge heartbeat — tuned for heavy execute sessions (Playwright MCP #982)
export const WS_HEARTBEAT_INTERVAL = 20_000;  // 20s between pings
export const WS_STALE_THRESHOLD = 90_000;     // 90s before declaring stale
export const WS_RECONNECT_GRACE = 5_000;      // 5s grace period before rejecting pending commands
