# Changelog

## [1.5.6] - 2026-03-08

### Added

- **Typed evidence system** — 16 typed interfaces in `src/shared/evidence-types.ts` (`PageEvidence`, `Finding`, `CoverageGap`, `ComparisonScaffold`, `MethodTrace`, etc.)
- **`smart.finding()`** — synchronous validation with confidence scoring; auto-caps confidence when coverage gaps reduce reliability
- **`smart.findings()` / `smart.clearFindings()`** — session-level evidence aggregation
- **Accessibility dimension** — `get_accessibility_tree` integration returning `AccessibilitySummary` (nodeCount, landmarkCount, imagesWithoutAlt, headingStructure)
- **Mobile-readiness dimension** — viewport meta + media query evaluation returning `MobileReadiness`
- **Confidence propagation** — `reducesConfidence: true` on perf/security gaps; findings auto-tagged with `confidenceCapped` / `cappedBy`
- **`extractPage({ trace: true })`** — adds `_trace: MethodTrace` with per-step timing
- **`ComparisonEvidence`** — `comparePages()` now returns scaffold with 10 dimensions, sharedFields, missingFields, metrics
- **40+ new unit tests** for evidence types, confidence propagation, and aggregation
- **E2E test suites** — `tests/e2e-method-mode.mjs` (20 steps) and `tests/e2e-recording.mjs`

### Fixed

- **`extractMetrics` bug** — assumed `perf.metrics.LCP` but real extension returns `perf.webVitals.lcp` / `perf.timing.firstByte` / `perf.chrome.taskDuration`

## [1.5.5] - 2026-03-07

### Added

- **Smart method layer** — 4 new `smart.*` methods for browser-automation skill:
  - `smart.scrollCapture()` — scroll to bottom, capturing content along the way
  - `smart.waitForIdle()` — wait for network + DOM to settle
  - `smart.extractPage()` — structured data extraction from current page
  - `smart.comparePages()` — diff two page snapshots for changes
- **`web-research` skill** — new skill for multi-page research workflows (`skills/web-research/SKILL.md`)
- **17 new unit tests** for smart methods in `tests/unit/smart-methods.test.ts`

### Changed

- Init wizard now installs both `browser-automation` and `web-research` skills

## [1.5.4] - 2026-03-06

### Changed

- Hardened skills: evaluate return-shape documentation + script performance rules
- Bumped extension manifest for CWS submission

## [1.5.3] - 2026-03-05

### Fixed

- Snapshot ref routing fix — correct frame context for DOM snapshots
- Evaluate auto-IIFE — wraps bare expressions in immediately-invoked function for correct return

### Changed

- Hardened skills documentation and error handling

## [1.5.2] - 2026-03-04

### Changed

- npm publish with updated package metadata

## [1.5.1] - 2026-03-03

### Added

- **Response shaping layer** — 8 shaping functions that compress raw extension data before it reaches the AI's context window (up to 99.9% reduction on `capture_page`)

## [1.5.0] - 2026-03-03

### Added

- **Response shaping layer** (`src/mcp-server/response-shapers.ts`) — 8 shaping functions that compress raw extension data before it reaches the AI's context window. Every MCP tool response previously dumped unfiltered, pretty-printed JSON. Now shaped tools return compact, actionable summaries:
  - `truncateUrl(url, max=120)` — caps long URLs (Google search URLs can be 600+ chars)
  - `shapeListTabs()` — drops `windowId`, `connected`; truncates URLs; renames `tabId` → `id`
  - `shapeConnectTab()` — replaces verbose `domainState` arrays with `{ok: true}` or `{ok: false, failedDomains: [...]}`
  - `shapeCapturePage()` — replaces full network/console/cookie/DOM arrays with summary stats and error highlights
  - `shapeConsoleLogs()` — errors in full, warnings capped at 10, info/debug as counts
  - `shapeNetworkLog()` — failed requests + byStatus/byType summaries + top 5 slowest
  - `shapeCookies()` — drops value/path/expires/size; keeps name/domain/flags
  - `shapeInteraction()` — drops x/y coordinates, deltaX/Y, steps, clearFirst; keeps action/selector/ref/snapshot
- **35 new unit tests** in `tests/unit/response-shapers.test.ts` covering all shapers with realistic fixture data

### Changed

- **`toolSuccess()` compact JSON** — removed pretty-printing (`JSON.stringify(content, null, 2)` → `JSON.stringify(content)`). AI parses JSON regardless of whitespace. ~20% savings on all responses.
- **16 tool handlers** now apply response shapers: `list_tabs`, `connect_tab`, `capture_page`, `get_console_logs`, `stop_network_capture`, `get_cookies`, `browser_click`, `browser_type`, `browser_press_key`, `browser_hover`, `browser_select_option`, `browser_scroll`, `browser_double_click`, `browser_drag`, `browser_file_upload`, `browser_fill_form`

### E2E Token Savings (measured against github.com)

| Tool | Before | After | Reduction |
|------|--------|-------|-----------|
| `capture_page` | 841,132 B | 738 B | **99.9%** |
| `get_console_logs` | 1,558 B | 55 B | **96.5%** |
| `get_cookies` | 1,783 B | 593 B | **66.7%** |
| `list_tabs` (10 tabs) | 2,858 B | 1,190 B | **58.4%** |

The AI still has full drill-down access — `get_dom_snapshot`, `get_console_logs`, `get_cookies`, and `execute` return complete data when the AI needs to go deeper.

### Tools NOT changed (already efficient or user-controlled)

`execute`, `search`, `take_screenshot`, `detect_framework`, `get_connection_status`, `browser_snapshot`, `browser_evaluate`, recording tools, performance/coverage tools

## [1.4.0] - 2026-03-02

### Added

- **Session recording** — 3 new MCP tools (`start_recording`, `stop_recording`, `get_recording_status`) that capture a full browser session as structured data. Records all tool interactions (with args, results, timing), page navigations, network requests, and console logs — organized by page. Supports auto-stop on duration limit, interaction limit, tab closed, or tab disconnected.
  - Types: `RecordingSession`, `RecordingPage`, `RecordingInteraction`, `RecordingStatus` in `src/shared/types.ts`
  - Protocol: 3 new `ServerCommand` variants in `src/shared/protocol.ts`
  - Extension: `RECORDING_INTERACTION_TOOLS` set (12 tools intercepted), `handleCommandWithRecording()` state machine, `lastAutoStoppedSession` recovery in `src/extension/background.ts`
  - MCP tools: Zod-validated input (`maxDurationSec` 10–600, `maxInteractions` 1–500), internal try/catch with `toolError()` in `src/mcp-server/tools.ts`
- **72 new recording tests** across 3 test files:
  - `tests/unit/recording.test.ts` — tool registration, bridge protocol, Zod validation, response parsing (11 tests)
  - `tests/unit/recording-smoke.test.ts` — full lifecycle with realistic mock data (12 tests)
  - `tests/unit/recording-e2e.test.ts` — comprehensive black-box E2E: discoverability, type contracts, validation boundaries, state machine simulation, interaction interception set, permission exemption, timeout config, error propagation, session data integrity (49 tests)
- `get_recording_status` added to `PERMISSION_EXEMPT_TOOLS` (no tab required)
- `TOOL_TIMEOUTS` entries: `start_recording` 10s, `stop_recording` 10s, `get_recording_status` 5s
- Session recording documentation in `skills/browser-automation/SKILL.md` and `reference.md`

### Changed

- **`--cloudflare` flag for init wizard** — `npx crawlio-browser init --cloudflare` adds Cloudflare MCP integration with zero wrangler dependency. Prompts for a Cloudflare API token (or detects `CLOUDFLARE_API_TOKEN` env var), verifies it against the Cloudflare API, auto-detects account ID, and writes the config. Supports `--yes` for non-interactive mode, `--dry-run`, multiple accounts, and legacy entry cleanup (`cloudflare-bindings`/`cloudflare-builds` → single `cloudflare`).
  - New exports: `buildCloudflareEntry()`, `isCloudflareConfigured()`, `verifyCloudflareToken()`
  - 8 new tests in `tests/unit/init.test.ts` (parseFlags, buildCloudflareEntry, isCloudflareConfigured)
- **Cloudflare MCP: replaced `mcp-remote` with `@cloudflare/mcp-server-cloudflare`** — eliminates broken browser OAuth flow entirely. Uses `CLOUDFLARE_API_TOKEN` env var for auth (no wrangler required). Single `cloudflare` server replaces both `cloudflare-bindings` and `cloudflare-builds`, providing 89 tools (KV, Workers, R2, D1, Durable Objects, Queues, AI, Workflows, Zones, Secrets, Versions, Routes, Cron).

### Fixed

- **Recording tool error handling** — all 3 recording tool handlers now catch `bridge.send()` errors internally and return `toolError()` responses, matching the pattern used by `get_cookies`, `get_storage`, and other tool handlers. Previously, bridge errors propagated as unhandled throws.

### Technical Details

#### Session Recording Architecture

The extension's service worker (`background.ts`) manages a recording state machine:

```
idle → start_recording → recording → stop_recording → idle
                              ↓
                         auto-stop (duration/interactions/tab closed)
                              ↓
                     lastAutoStoppedSession cached
```

During recording, the 12 interaction tools in `RECORDING_INTERACTION_TOOLS` are intercepted — each tool's args, result, timing, and page URL are captured as `RecordingInteraction` entries. Page transitions create new `RecordingPage` entries with delta snapshots of console logs and network requests.

#### Cloudflare MCP Migration

| Before | After |
|--------|-------|
| `mcp-remote@0.1.38` proxy to `bindings.mcp.cloudflare.com` | `@cloudflare/mcp-server-cloudflare@0.2.0` local server |
| `mcp-remote@0.1.38` proxy to `builds.mcp.cloudflare.com` | (merged into single server above) |
| Browser OAuth flow (buggy — [cloudflare/mcp-server-cloudflare#294](https://github.com/cloudflare/mcp-server-cloudflare/issues/294)) | `CLOUDFLARE_API_TOKEN` env var — no wrangler, no browser OAuth |
| 2 MCP servers, race-prone OAuth | 1 server, 89 tools, instant startup |
| Manual config editing | `npx crawlio-browser init --cloudflare` guided setup |

Root cause of the OAuth failures:
1. `bindings.mcp.cloudflare.com/oauth/authorize` returns 500 Internal Error (upstream bug: 4xx errors misclassified as 500)
2. `builds.mcp.cloudflare.com` returns `request_forbidden` ("You are not allowed to perform this action")
3. `mcp-remote@0.1.38` has a build bug: internal version string says `"0.1.37"`, causing auth directory namespace mismatch

## [1.3.0] - 2026-03-01

### Changed

- **Renamed package** from `crawlio-agent` to `crawlio-browser`
- **Code-mode is now the default** — 3 tools (search, execute, connect_tab) with 125 searchable commands. Use `--full` to expose all 92 individual tools. `--code-mode` flag deprecated.

### Added

- **Browser automation skill** (`skills/browser-automation/SKILL.md`) — workflow patterns for connection, navigation, screenshots, clicks, network capture, framework detection
- **Command reference** (`skills/browser-automation/reference.md`) — full catalog of 92 browser + 33 desktop commands
- **Claude Code plugin** (`.claude-plugin/plugin.json`) — enables `claude plugin install`
- `--full` flag for init
- Skill auto-install during `npx crawlio-browser init`

## [1.2.0] - 2026-03-01

### Added

- `npx crawlio-agent init` — neon-inspired interactive wizard that auto-detects environment and configures the right transport:
  - **Default (stdio):** runs `npx add-mcp crawlio-agent` — clients spawn crawlio-agent as a child process, no server needed
  - **`.mcp.json` detected:** prompts to add a stdio entry directly to the config (MetaMCP / multi-engine setups)
  - **`--portal` flag:** starts persistent HTTP server on :3001 + configures clients with the HTTP URL (multi-client sharing, ChatGPT Desktop)
- New flags: `--portal`, `--yes` / `-y` (skip prompts), `-a <agent>` (target specific MCP clients)
- `setup` and `--setup` remain as backwards-compatible aliases for `init`
- `alarms` permission for WebSocket reconnect scheduling (zero install warning, invisible to users)

### Removed

- **`nativeMessaging`** from `optional_permissions` — native messaging host (`com.crawlio.agent`) is not a shipped product; no user flow triggers it; code guards with `chrome.permissions.contains()` so removal is safe; eliminates CWS reviewer question with no defensible answer

### Changed

- Extension permissions simplified to `["activeTab", "alarms", "debugger", "storage"]` + optional `["tabs"]` + optional host `["http://127.0.0.1/*"]`

### Fixed

- **Node path resolution** — `process.execPath` replaced with `resolveNodePath()` that runs `which node` / `where node`, preventing launchd plist from baking in ephemeral npm cache or Homebrew Cellar paths that break after Node upgrades
- **Windows path handling** — `new URL(import.meta.url).pathname` replaced with `fileURLToPath()` to avoid leading-slash bug on Windows (`/C:/path/...`)
- **Windows npx** — `execFileSync("npx")` replaced with platform-aware `npx.cmd` detection
- **Cross-platform skill discovery** — `find` command replaced with `readdirSync({ recursive: true })` + path filter (Windows `find` is a text search utility)
- **Port conflict detection** — when health check fails after spawn, setup now probes port 3001 and prints a clear message suggesting `--port 3002` if occupied
- **Better error categorization** — `configureClients` now distinguishes ENOENT (npx not in PATH) vs ETIMEDOUT (network) vs generic failures
- **Stale version strings** — health endpoint and MCP server constructor both hardcoded old versions; now report `1.2.0`

### Removed

- **`commander`** from dependencies — was never imported, dead weight
- **`idb`** from dependencies — only used by extension code (browser-only IndexedDB wrapper), not the MCP server

### Added

- `--dry-run` flag for `npx crawlio-agent setup --dry-run` — prints what setup would do (node path, server path, launchd method, add-mcp command) without executing
- GitHub Actions CI pipeline (`.github/workflows/ci.yml`) — runs typecheck, tests, and build on Node 18/20/22 for push to main and PRs
- `prepublishOnly` script — ensures typecheck + test + build pass before `npm publish`

### Changed

- `files` array in package.json narrowed from `bin/` (which included `crawlio-server.sh` with hardcoded paths) to `bin/crawlio-agent.js`
- `build:server` script now cleans `dist/mcp-server/` before building to prevent stale chunk accumulation (cross-platform `fs.rmSync` instead of `rm -rf`)
- `-g` flag changed to `--global` in add-mcp invocation for clarity

## [1.1.0] - 2026-02-24

### Changed

- **Replaced broad `host_permissions`** (`http://*/*`, `https://*/*`) with narrow `http://127.0.0.1/*` — eliminates Chrome Web Store "delayed in-depth review" warning while keeping CORS bypass for the local MCP server health probe
- **Removed `content_scripts`** manifest entry — content script is no longer auto-injected on every page
- **Migrated all MCP tool handlers from `chrome.scripting.executeScript` to CDP `Runtime.evaluate`** — uses the already-attached debugger session, which is independent of the `host_permissions` permission chain
- **Enrichment accumulator** now uses CDP for framework detection and DOM capture when the debugger is attached, skips silently otherwise

### Added

- `cdpExecuteFunction<T>()` helper — serializes a function + args and executes via `sendCDPCommand("Runtime.evaluate")`, bypassing the `chrome.scripting` permission gate entirely

### Technical Details

Chrome's permission check chain for `chrome.scripting.executeScript` checks tab-specific permissions (activeTab), granted host_permissions, and optional host_permissions in sequence. Without `host_permissions` and without a user gesture (no `activeTab` grant), `executeScript` fails. However, CDP operations via `chrome.debugger.sendCommand` use a completely separate authorization domain — the `debugger` permission alone is sufficient. Since all MCP tool handlers are called after `getConnectedTab()` (which guarantees the debugger is attached), CDP `Runtime.evaluate` is a drop-in replacement.

### Migration Impact

| Audience | Before | After |
|----------|--------|-------|
| AI via MCP | Full experience | Identical (CDP instead of scripting API) |
| Passive enrichment | Auto-captures framework + screenshot on every navigation | Framework captured only when debugger is attached; screenshots may fail silently |
| Chrome Web Store | Delayed in-depth review | Standard review timeline |

### Affected Tools

- `detect_framework` — now uses `cdpExecuteFunction`
- `get_dom_snapshot` — now uses `cdpExecuteFunction`
- `capture_page` (framework + DOM) — now uses `cdpExecuteFunction`
- `browser_type` (focus) — now uses `cdpExecuteFunction`
- `browser_select_option` — now uses `cdpExecuteFunction`

### Permissions After Change

```json
"permissions": ["activeTab", "scripting", "debugger", "storage", "tabs", "webNavigation"],
"host_permissions": ["http://127.0.0.1/*"]
```

`activeTab` and `scripting` retained for popup-triggered user gestures. Broad `host_permissions` (`http://*/*`, `https://*/*`) replaced with localhost-only. `content_scripts` removed entirely.

### Why `http://127.0.0.1/*` is Needed

Chrome's CORS enforcement fires when there's either no `Access-Control-Allow-Origin` header or a connection refused (no response at all). The service worker probes `http://127.0.0.1:9333/health` to check if the MCP server is running. Without `host_permissions` for localhost, Chrome enforces CORS on this fetch — and when the server isn't running, connection refused triggers a CORS error regardless of server-side headers. A narrow localhost `host_permissions` gives the extension CORS bypass for the probe without triggering CWS delayed review.
