> **This repository has moved.** Active development continues at [`Crawlio-app/crawlio-browser-agent`](https://github.com/Crawlio-app/crawlio-browser-agent).
>
> Install the latest version: `npx -y crawlio-browser`

# Crawlio Agent

MCP server that gives AI full control of a live Chrome browser via CDP. 96 tools (92 browser + 3 session recording + 1 compiler) with framework-aware intelligence — captures what static crawlers can't see.

[![npm version](https://img.shields.io/npm/v/crawlio-browser)](https://www.npmjs.com/package/crawlio-browser)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## When to use Crawlio Agent

Use Crawlio Agent when your AI needs to interact with a **real browser** — SPAs, authenticated pages, dynamic content, JS-rendered frameworks. Unlike headless browser tools, Crawlio Agent connects to **your actual Chrome** via a lightweight extension, giving the AI access to your logged-in sessions, cookies, and full browser state.

**Crawlio Agent vs Playwright MCP:** Playwright MCP launches a headless browser. Crawlio Agent connects to your existing Chrome — no separate browser process, no login flows, full access to your tabs and sessions.

## Quick Start

1. Install the [Chrome Extension](https://crawlio.app/agent)
2. Run the init wizard:
   ```bash
   npx crawlio-browser init
   ```

That's it. Auto-detects and configures Claude Code, Cursor, VS Code, Codex, Claude Desktop, ChatGPT Desktop, and 8 more MCP clients.

### Init wizard options

```bash
npx crawlio-browser init              # Default: code mode, stdio transport
npx crawlio-browser init --full       # Full mode (96 individual tools)
npx crawlio-browser init --portal     # Portal mode (persistent HTTP server)
npx crawlio-browser init --cloudflare # Add Cloudflare MCP (89 tools, no wrangler)
npx crawlio-browser init --dry-run    # Show what would happen
npx crawlio-browser init --yes        # Skip prompts (CI / scripted installs)
npx crawlio-browser init -a claude    # Target specific MCP client
```

### Manual setup (any client)

<details>
<summary><b>Per-client manual config</b></summary>

**Claude Desktop** — add to `claude_desktop_config.json`:
```json
{ "mcpServers": { "crawlio-browser": { "command": "npx", "args": ["-y", "crawlio-browser"] } } }
```

**Claude Code (Portal Mode)** — start `npx crawlio-browser --portal`, then add to `.mcp.json`:
```json
{ "mcpServers": { "crawlio-browser": { "type": "http", "url": "http://127.0.0.1:3001/mcp" } } }
```

**Claude Code (stdio):**
```bash
claude mcp add crawlio-browser -- npx -y crawlio-browser
```

**Cursor** — add to `.cursor/mcp.json`:
```json
{ "mcpServers": { "crawlio-browser": { "command": "npx", "args": ["-y", "crawlio-browser"] } } }
```

**Windsurf** — add to Windsurf Settings > MCP:
```json
{ "mcpServers": { "crawlio-browser": { "command": "npx", "args": ["-y", "crawlio-browser"] } } }
```

**Cline (VS Code)** — add to `settings.json`:
```json
{ "cline.mcpServers": { "crawlio-browser": { "command": "npx", "args": ["-y", "crawlio-browser"] } } }
```

**ChatGPT Desktop** — Settings > Integrations > MCP:
URL: `http://127.0.0.1:3001/mcp` | Type: Streamable HTTP

</details>

## How It Works

```
AI Client (stdio)  -->  MCP Server (Node.js)  -->  Chrome Extension (MV3)
                        crawlio-browser               WebSocket -> CDP
```

The MCP server communicates with the Chrome extension via WebSocket. The extension controls the browser through Chrome DevTools Protocol — the same protocol used by Chrome DevTools and Playwright.

## Architecture: JIT Context Runtime

The execution runtime is built on four pillars that separate it from stateless cloud sandboxes:

- **Attention Dilution Cure** — 3 tools (`search`, `execute`, `connect_tab`) instead of 96. The agent discovers capabilities on demand through `search`, keeping the context window clean and tool selection accurate.
- **Polymorphic Context** — Before code executes, the runtime probes the browser for framework signatures and injects a shape-shifting `smart` object with framework-native accessors (React, Vue, Next.js, Shopify, etc. — 17 namespaces across 4 tiers).
- **Deterministic Execution** — Every `smart.click()` runs an actionability check (visibility, dimensions, enabled state, overlay detection) with progressive backoff, then enforces a post-action settle delay (500ms/300ms/1000ms).
- **Agentic REPL** — The runtime maintains a persistent connection to the browser. When a script fails, the browser state is preserved — the agent reads the structured error and iterates against the same live session.

```
execute call lifecycle:
  search -> discover capabilities
  detect -> probe DOM for active frameworks
  inject -> build polymorphic smart object
  run    -> execute with actionability checks + settle delays
  return -> result or structured error (browser state preserved)
```

[Read the full architecture guide &rarr;](https://docs.crawlio.app/browser-agent/jit-context-runtime)

## Two Modes

### Code Mode (3 tools) — default

Collapses 96 tools into 3 high-level tools with ~95% schema token reduction:

| Tool | Description |
|------|-------------|
| `search` | Discover available commands by keyword |
| `execute` | Run async JS with `bridge`, `crawlio`, `smart`, `sleep`, and `compileRecording` in scope |
| `connect_tab` | Connect to a browser tab |

```javascript
// Navigate and screenshot
await bridge.send({ type: 'browser_navigate', url: 'https://example.com' }, 30000);
await sleep(2000);
const screenshot = await bridge.send({ type: 'take_screenshot' }, 10000);
return screenshot;
```

### Full Mode (96 tools)

Every tool exposed directly to the LLM. Enable with `--full`:

```bash
npx crawlio-browser init --full
```

## Smart Object

In Code Mode, the `smart` object provides framework-aware helpers with auto-waiting and actionability checks.

### Core Methods

| Method | Description |
|--------|-------------|
| `smart.evaluate(expression)` | Execute JS in the page via CDP |
| `smart.click(selector, opts?)` | Auto-waiting click with 500ms settle |
| `smart.type(selector, text, opts?)` | Auto-waiting type with 300ms settle |
| `smart.navigate(url, opts?)` | Navigate with 1000ms settle |
| `smart.waitFor(selector, timeout?)` | Poll until element is actionable |
| `smart.snapshot()` | Accessibility tree snapshot |

### Higher-Order Methods

| Method | Description |
|--------|-------------|
| `smart.scrollCapture()` | Scroll to bottom, capturing content along the way |
| `smart.waitForIdle()` | Wait for network + DOM to settle |
| `smart.extractPage(opts?)` | Structured page evidence extraction (returns `PageEvidence`) |
| `smart.comparePages(a, b)` | Diff two page snapshots across 10 dimensions (returns `ComparisonEvidence`) |

### Typed Evidence

Methods for structured analysis findings:

| Method | Description |
|--------|-------------|
| `smart.finding(data)` | Create a validated `Finding` with confidence scoring |
| `smart.findings()` | Get all session-accumulated findings |
| `smart.clearFindings()` | Reset session finding state |

Findings support confidence propagation — gaps in data collection automatically cap confidence and add `confidenceCapped` / `cappedBy` fields.

### Framework Namespaces

When a framework is detected, the smart object exposes framework-specific helpers:

<details>
<summary><b>React</b> — <code>smart.react</code></summary>

| Method | Returns |
|--------|---------|
| `getVersion()` | Version string and bundle type |
| `getRootCount()` | Number of React root components |
| `hasProfiler()` | Whether profiler is available |
| `isHookInstalled()` | Whether DevTools hook is installed |

</details>

<details>
<summary><b>Vue.js</b> — <code>smart.vue</code></summary>

| Method | Returns |
|--------|---------|
| `getVersion()` | Vue version string |
| `getAppCount()` | Number of Vue app instances |
| `getConfig()` | App config object |
| `isDevMode()` | Whether DevTools is enabled |

</details>

<details>
<summary><b>Angular</b> — <code>smart.angular</code></summary>

| Method | Returns |
|--------|---------|
| `getVersion()` | ng-version attribute value |
| `isDebugMode()` | Whether debug APIs available |
| `isIvy()` | Whether Ivy compiler is active |
| `getRootCount()` | Number of Angular root elements |
| `getState()` | Full state object |

</details>

<details>
<summary><b>Svelte</b> — <code>smart.svelte</code></summary>

| Method | Returns |
|--------|---------|
| `getVersion()` | Svelte version string |
| `getMeta()` | Svelte metadata object |
| `isDetected()` | Whether Svelte is detected |

</details>

<details>
<summary><b>Redux</b> — <code>smart.redux</code></summary>

| Method | Returns |
|--------|---------|
| `isInstalled()` | Whether Redux DevTools is installed |
| `getStoreState()` | Full store state |

</details>

<details>
<summary><b>Alpine.js</b> — <code>smart.alpine</code></summary>

| Method | Returns |
|--------|---------|
| `getVersion()` | Alpine version string |
| `getStoreKeys()` | Store object keys |
| `getComponentCount()` | Count of `[x-data]` components |

</details>

<details>
<summary><b>Next.js</b> — <code>smart.nextjs</code></summary>

| Method | Returns |
|--------|---------|
| `getData()` | `__NEXT_DATA__` object |
| `getRouter()` | Router state (pathname, query, asPath) |
| `getSSRMode()` | SSR mode (hybrid, app-router, static) |
| `getRouteManifest()` | Current page data |

</details>

<details>
<summary><b>Nuxt</b> — <code>smart.nuxt</code></summary>

| Method | Returns |
|--------|---------|
| `getData()` | `__NUXT__` object |
| `getConfig()` | App config |
| `isSSR()` | Whether server-rendered |

</details>

<details>
<summary><b>Remix</b> — <code>smart.remix</code></summary>

| Method | Returns |
|--------|---------|
| `getContext()` | `__remixContext` object |
| `getRouteData()` | Loader data from state |

</details>

<details>
<summary><b>Shopify</b> — <code>smart.shopify</code></summary>

| Method | Returns |
|--------|---------|
| `getShop()` | Shop metadata (theme, locale, currency) |
| `getCart()` | Shopping cart object |

</details>

<details>
<summary><b>WordPress</b> — <code>smart.wordpress</code></summary>

| Method | Returns |
|--------|---------|
| `isWP()` | Whether WordPress is present |
| `getRestUrl()` | REST API endpoint |
| `getPlugins()` | List of active plugins |

</details>

<details>
<summary><b>More frameworks</b> — Gatsby, WooCommerce, Laravel, Django, Drupal, jQuery</summary>

| Namespace | Methods |
|-----------|---------|
| `smart.gatsby` | `getData()`, `getPageData()` |
| `smart.woocommerce` | `getParams()` |
| `smart.laravel` | `getCSRF()` |
| `smart.django` | `getCSRF()` |
| `smart.drupal` | `getSettings()` |
| `smart.jquery` | `getVersion()` |

</details>

## Session Recording

Record browser sessions as structured data, then compile them into reusable automation skills.

| Tool | Description |
|------|-------------|
| `start_recording` | Begin recording interactions, navigations, network, console |
| `stop_recording` | Stop and return full session data |
| `get_recording_status` | Check if recording is active |
| `compile_recording` | Convert a recorded session into a SKILL.md automation |

12 interaction tools are automatically intercepted during recording (click, type, navigate, scroll, etc.). Each interaction captures args, result, timing, and page URL.

```javascript
// In code mode: record, interact, compile
await bridge.send({ type: 'start_recording' }, 10000);
// ... interact with the page ...
const session = await bridge.send({ type: 'stop_recording' }, 10000);
const skill = compileRecording(session.session, 'my-automation');
return skill;
```

## Auto-Settling

Mutative tools (`browser_click`, `browser_type`, `browser_navigate`, `browser_select_option`) use Playwright-inspired actionability checks:

1. **Pre-flight**: Polls element visibility, stability, and enabled state before acting
2. **Action**: Dispatches the CDP command
3. **Post-settle**: Waits for DOM mutations to quiesce with progressive backoff `[0, 20, 100, 100, 500]ms`

This means the AI doesn't need to manually add `sleep()` or `waitFor()` calls between actions — the tools handle SPA rendering delays automatically.

## Framework Detection

Detects **64 technologies** across 4 tiers using globals, DOM markers, meta tags, HTTP headers, and script URLs:

| Tier | Frameworks | Signal Strength |
|------|-----------|----------------|
| **Meta-frameworks** | Next.js, Nuxt, SvelteKit, Remix, Gatsby | Unique globals + parent detection |
| **Core** | React, Vue.js, Angular, Svelte, Astro, Qwik, SolidJS, Lit, Preact | Globals + DOM markers |
| **CMS & Platforms** | WordPress, Shopify, Webflow, Squarespace, Wix, Drupal, Magento, Ghost, Bubble | Meta tags + globals |
| **Libraries & Tools** | jQuery, Bootstrap, Tailwind CSS, Alpine.js, HTMX, Turbo, Stencil, Redux, Ember.js, Backbone.js | DOM + globals |

Multi-framework detection returns a **primary** framework (meta-framework takes priority) plus a `subFrameworks` array for the full stack.

## Tools Reference

### Connection & Status

| Tool | Description |
|------|-------------|
| `connect_tab` | Connect to a browser tab by URL, tab ID, or active tab |
| `disconnect_tab` | Disconnect from the current tab |
| `list_tabs` | List all open tabs with IDs and URLs |
| `get_connection_status` | Check CDP connection state |
| `reconnect_tab` | Force reconnect to fix stale connections |
| `get_capabilities` | List all tools and their availability |

### Page Capture

| Tool | Description |
|------|-------------|
| `capture_page` | Full capture: framework + network + console + DOM |
| `detect_framework` | Detect JS framework and version |
| `start_network_capture` | Start recording network requests |
| `stop_network_capture` | Stop recording and return captured requests |
| `get_console_logs` | Get console logs (errors, warnings, info) |
| `get_cookies` | Get cookies (sensitive values redacted) |
| `get_dom_snapshot` | Simplified DOM tree with shadow DOM and iframe support |
| `take_screenshot` | Screenshot as base64 PNG |
| `get_response_body` | Get response body for a captured network request |

### Navigation & Interaction

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL (auto-settle) |
| `browser_click` | Click element by CSS selector (auto-settle, left/right/middle, modifiers) |
| `browser_double_click` | Double-click element |
| `browser_type` | Type text into element (auto-settle) |
| `browser_press_key` | Press keyboard key (Enter, Tab, Escape, shortcuts) |
| `browser_hover` | Hover over element |
| `browser_select_option` | Select `<option>` by value (auto-settle) |
| `browser_scroll` | Scroll page or element |
| `browser_drag` | Drag from one element to another |
| `browser_file_upload` | Upload files to `<input type="file">` |
| `browser_wait` | Wait N milliseconds |
| `browser_wait_for` | Wait for element state (visible, hidden, attached, detached) |

### Network

| Tool | Description |
|------|-------------|
| `browser_intercept` | Block, modify headers, or mock responses for URL patterns |
| `emulate_network` | Throttle network (offline, 3G, 4G, WiFi presets) |
| `set_cache_disabled` | Disable/enable browser cache |
| `set_extra_headers` | Add custom headers to all requests |
| `get_websocket_connections` | List active WebSocket connections |
| `get_websocket_messages` | Get WebSocket message history |

### Frames & Tabs

| Tool | Description |
|------|-------------|
| `get_frame_tree` | Get frame hierarchy (main + iframes) |
| `switch_to_frame` | Switch execution context to iframe |
| `switch_to_main_frame` | Switch back to main frame |
| `create_tab` | Create new tab with URL |
| `close_tab` | Close tab by ID |
| `switch_tab` | Focus a tab by ID |

### Cookies & Storage

| Tool | Description |
|------|-------------|
| `set_cookie` | Set cookie (supports httpOnly via CDP) |
| `delete_cookies` | Delete cookies by name/domain/path |
| `get_storage` | Read localStorage or sessionStorage |
| `set_storage` | Write storage item |
| `clear_storage` | Clear all storage items |
| `get_databases` | List IndexedDB databases |
| `query_object_store` | Query IndexedDB object store |
| `clear_database` | Clear or delete IndexedDB database |

### Dialogs

| Tool | Description |
|------|-------------|
| `get_dialog` | Get pending JS dialog (alert/confirm/prompt) |
| `handle_dialog` | Accept or dismiss dialog |

### Emulation

| Tool | Description |
|------|-------------|
| `set_viewport` | Set viewport dimensions |
| `set_user_agent` | Override User-Agent string |
| `emulate_device` | Emulate device (iPhone, iPad, Pixel, Galaxy, Desktop) |
| `set_geolocation` | Override geolocation coordinates |
| `set_stealth_mode` | Anti-detection mode (opt-in, patches webdriver fingerprint) |

### Security

| Tool | Description |
|------|-------------|
| `get_security_state` | TLS certificate details, protocol, cipher |
| `ignore_certificate_errors` | Ignore cert errors for staging environments |

### Service Workers

| Tool | Description |
|------|-------------|
| `list_service_workers` | List all service worker registrations |
| `stop_service_worker` | Stop/unregister a service worker |
| `bypass_service_worker` | Bypass service workers for network requests |

### DOM Manipulation

| Tool | Description |
|------|-------------|
| `set_outer_html` | Replace element's HTML |
| `set_attribute` | Set element attribute |
| `remove_attribute` | Remove element attribute |
| `remove_node` | Remove element from DOM |

### CSS & JS Coverage

| Tool | Description |
|------|-------------|
| `start_css_coverage` / `stop_css_coverage` | Track which CSS rules are used |
| `start_js_coverage` / `stop_js_coverage` | Track which JS code is executed |
| `get_computed_style` | Get resolved CSS properties for element |
| `force_pseudo_state` | Force :hover, :focus, :active states |

### Performance & Memory

| Tool | Description |
|------|-------------|
| `get_performance_metrics` | Chrome metrics + Web Vitals (LCP, CLS, FID) |
| `get_dom_counters` | Count DOM nodes, documents, event listeners |
| `force_gc` | Force garbage collection |
| `take_heap_snapshot` | V8 heap snapshot summary |

### PDF & Accessibility

| Tool | Description |
|------|-------------|
| `print_to_pdf` | Generate PDF (custom paper, margins, orientation) |
| `get_accessibility_tree` | Accessibility tree for screen-reader audit |

### Targets & Contexts

| Tool | Description |
|------|-------------|
| `get_targets` | List all Chrome targets (pages, workers, extensions) |
| `attach_to_target` | Attach CDP session to any target |
| `create_browser_context` | Create isolated (incognito-like) context |

### Visual Debug

| Tool | Description |
|------|-------------|
| `highlight_element` | Highlight element with colored overlay |
| `show_layout_shifts` | Visualize CLS regions |
| `show_paint_rects` | Visualize paint/repaint areas |

### Session Recording

| Tool | Description |
|------|-------------|
| `start_recording` | Begin recording browser session |
| `stop_recording` | Stop recording and return session data |
| `get_recording_status` | Check recording state |
| `compile_recording` | Compile session into SKILL.md automation |

### Crawlio App Integration

> Optional — requires [Crawlio.app](https://crawlio.app) running locally.

| Tool | Description |
|------|-------------|
| `extract_site` | Start a Crawlio crawl of the active tab's URL |
| `get_crawl_status` | Get crawl progress and status |
| `get_enrichment` | Get browser enrichment data |
| `get_crawled_urls` | Get crawled URLs with status and pagination |
| `enrich_url` | Navigate + capture + submit enrichment in one call |

## Requirements

- **Node.js** >= 18
- **Chrome** (or Chromium) with the [Crawlio Agent extension](https://crawlio.app/agent) installed
- **Crawlio.app** (optional) — for site crawling and enrichment

## License

MIT
