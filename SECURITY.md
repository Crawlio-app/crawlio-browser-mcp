# Security Model

Crawlio Browser is a Chrome extension + MCP server that exposes browser
automation capabilities to AI agents. This document describes the trust
boundaries, threat model, and design decisions.

## Trust Boundary

The **MCP client** (Claude Code, Cursor, etc.) is the trust boundary.
Crawlio trusts whatever the MCP client sends — the same way a terminal
trusts the user typing commands. The MCP protocol itself provides no
authentication; the client is responsible for prompt injection defense
and user consent.

## WebSocket Security

The MCP server listens on `ws://127.0.0.1:3001`.

**Origin validation:** The WebSocket server rejects upgrade requests from
non-localhost origins. Browser-initiated connections from arbitrary
webpages include an `Origin` header — `verifyClient` checks that the
origin hostname is `127.0.0.1` or `localhost`. Node.js MCP clients
(stdio transport) send no `Origin` header and are allowed through.

This mirrors Chrome's own DevTools HTTP handler, which validates incoming
WebSocket origins via the `--remote-allow-origins` flag and rejects
unauthorized origins with:

> Rejected an incoming WebSocket connection from the %s origin.

Chrome also validates the `Host` header, rejecting requests where the
host is not an IP address or `localhost`
(source: `devtools_http_handler.cc`).

**Bind address:** The server binds to `127.0.0.1` only — not `0.0.0.0`.
Remote connections are impossible without port forwarding.

**No token/nonce:** Chrome's `DevToolsActivePort` file mechanism writes
a random port + discovery token to the user data directory. We don't
replicate this because our extension connects to a fixed port via
`chrome.runtime` messaging, not via file-system token exchange.

## Tools — By Design

### `execute` (AsyncFunction evaluation)

The `execute` tool evaluates arbitrary JavaScript in the connected tab.
This is **by design** — it is the browser equivalent of a terminal's
`exec`. The MCP client is responsible for gating what code is executed.

### `set_outer_html` / `set_extra_headers`

These tools accept arbitrary HTML and header values respectively. They
are browser automation primitives that must accept unconstrained input
to be useful. The MCP client is the gate.

### `set_stealth_mode`

Stealth mode patches browser fingerprint APIs (navigator, WebGL, etc.).
It defaults to **off** and must be explicitly enabled by the MCP client.

## Extension Permissions

| Permission | Type | Rationale |
|---|---|---|
| `debugger` | Required | CDP access — core functionality |
| `storage` | Required | Session state persistence across SW restarts |
| `alarms` | Required | Reconnect intervals, scheduled captures |
| `tabs` | Optional | Tab listing — requested at runtime with user gesture |

`host_permissions` is limited to `http://127.0.0.1/*` for the MCP server
health probe CORS bypass. No broad host permissions.

## Site Opt-Out

Sites can opt out of Crawlio capture:

```html
<meta name="crawlio-agent" content="disable">
```

When detected, all CDP operations on that tab return an error message
asking the MCP client to respect the site's preference. The check is
cached per `tabId:url` with FIFO eviction at 500 entries.

## Storage Races

`writeStatus` uses a module-level cache to avoid read-modify-write races
on `chrome.storage.session`. Console log flush falls back to a direct
snapshot of the in-memory buffer rather than reading-then-merging from
storage.

## Reporting Vulnerabilities

If you find a security issue, please email security@crawlio.app.
