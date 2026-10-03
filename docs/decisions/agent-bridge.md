# Agent bridge

Status: accepted · Date: 2026-10-03 · Roadmap: [developer-mode-roadmap.md](../developer-mode-roadmap.md)

The agent bridge lets a coding agent (Claude Code, Codex, Cursor or any other MCP client) read what happens in local development tabs. This record fixes the technical choices made in phase 0.

## Transport: Streamable HTTP on 127.0.0.1

Yalqen is a GUI app that is already running when the agent wants context, so the agent cannot launch it as a stdio subprocess. The Electron fuses disable `runAsNode`, so Yalqen cannot ship a helper Node process that the agent launches either. The bridge therefore runs an HTTP server inside the main process and speaks the MCP [Streamable HTTP](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports) transport.

- The server listens on `127.0.0.1` only, at the path `/mcp`.
- Every `POST` is answered with a single `application/json` response. The bridge has no server-initiated messages, so it never opens an SSE stream; `GET` returns `405`, as the transport allows.
- Supported methods: `initialize`, `notifications/initialized`, `ping`, `tools/list`, `tools/call`. Anything else returns JSON-RPC error `-32601`.

## Dependencies: no MCP SDK at runtime

`@modelcontextprotocol/sdk` 1.32 (MIT) pulls in 17 runtime dependencies, including `express`, `hono`, `cors`, `ajv` and `jose`. For a server with five JSON-RPC methods and no streaming, that is more code than the feature itself, and all of it would load into the browser's main process.

Decision: the server is a small hand-written JSON-RPC handler on `node:http`. Tool inputs are validated by hand, the same way `sanitizeSettings` validates settings. The SDK is added as a dev dependency only, so the end-to-end tests talk to the bridge through the official client and catch any drift from the protocol.

Revisit if the bridge needs streaming, resources, prompts or sampling.

## Port: fixed default with fallback

The default port is `47823`. If it is taken, the next free port in `47823–47832` is used. The chosen port is shown in Settings → Developer, together with the setup command. A fixed default means the setup command is written once; the token, not the port, is what protects the server.

## Authentication

- A random 32-byte token (base64url) is created the first time the bridge is turned on and stored encrypted with `safeStorage`. "Regenerate token" replaces it and drops every session.
- Every request must carry `Authorization: Bearer <token>`. The comparison is constant-time.
- Any request with an `Origin` header is rejected, so no web page, in Yalqen or any other browser, can reach the port.
- The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding protection).

## Scope

A tab is visible to the agent only when all of these hold:

- the bridge is on;
- the tab is not in a private window;
- its URL is `http:` or `https:`, and its host passes `isDevelopmentHost` from `src/shared/hosts.ts` (`localhost`, `127.0.0.0/8`, `[::1]`, `0.0.0.0`, `*.localhost`, `*.test`, `*.local`) or its origin was added by hand in settings.

The existing helper is reused instead of moving `LOCAL_HOSTS` out of `passwords.ts`; that set has a different job (which plain-HTTP origins may save passwords).

## Collection

Collection uses the page's existing CDP connection (`src/main/devtools/page-debugger.ts`). The bridge enables `Runtime`, `Log` and `Network` only in tabs in scope, only while it is on, and turns them off again when it is switched off or the tab leaves scope.

CDP events are turned into records by pure functions in `src/main/agent-bridge/cdp-events.ts`, so the Electron layer stays thin and the logic carries over to CEF if Yalqen moves there.

Limits per tab, in memory only: the last 200 console entries and the last 300 requests. Response bodies are fetched on request, only for status 400 and above, and truncated at 64 KB. Sensitive headers are masked before anything leaves the bridge.

## Element picker (phase 2)

- Picking uses Chromium's own inspect mode (`Overlay.setInspectMode`), so nothing is injected into the page. `⌥⌘P`, `>pick` and the developer menu start it; `Esc`, a second `⌥⌘P` or a navigation cancels it.
- Picking needs the agent connection on and the tab in scope; otherwise a notice says why.
- The selection is captured at click time (HTML up to 4 KB, layout styles, box, accessible role and name, ancestor chain, selector, element screenshot) and kept immutably, so HMR cannot invalidate it. The last 10 selections per tab are kept in memory.
- The selection id (`yk_` and 6 hex digits) is copied to the clipboard and shown in a short notice above the page.
- Same-process iframes can be picked. Cross-origin iframes run in their own process and are not reachable through the page's debugger session, so the inspect overlay does not enter them. Multi-select with `⇧` is not implemented: the inspect event carries no modifier keys.

## Naming

`yalqen` everywhere: the MCP server name, tool descriptions, the setup command and the docs.
