# Agent bridge

Status: accepted · Date: 2026-10-03

The agent bridge lets a coding agent (Claude Code, Codex, Cursor or any other MCP client) read what happens in local development tabs. This record describes the implemented bridge and its technical choices.

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

## Component and source mapping (phase 3)

**bippy, not an in-house mapper.** [bippy](https://github.com/aidenybai/bippy) 0.7 (MIT, no runtime dependencies) already resolves React 18 `_debugSource`, React 19 `_debugStack` and source maps. Only `bippy/source` is bundled: bippy's main entry installs a DevTools hook as a side effect and imports React. The fiber lookup (`__reactFiber$` key), composite check and display name are a few lines in `src/page-scripts/component-inspector.ts` instead.

**No script before page load.** The roadmap planned to install a `__REACT_DEVTOOLS_GLOBAL_HOOK__` with `Page.addScriptToEvaluateOnNewDocument`. It is not needed: the fiber is reachable from the DOM node itself, so nothing runs in the page until the user picks an element. The inspector (about 40 KB, bundled as one function by `scripts/build-preload.mjs`) runs once per pick through `Runtime.callFunctionOn` on the picked node, with a 4-second limit. If resolving sources leaves a DevTools hook the page did not have, it is removed.

**Webpack inline maps.** webpack dev builds (`eval-source-map`, the Next.js default with `--webpack`) keep each module's source map inline, which the page cannot fetch. For those frames the main process enables the `Debugger` domain for the duration of the pick, reads the module's `sourceMapURL` from `Debugger.scriptParsed`, and maps the line with a small decoder (`source-map.ts`). This adds about 300 ms to that pick.

**Confidence.**

- `exact`: a mapped `file:line`.
- `component`: the component is known but not the line, as with server components, whose code never reaches the browser (only the file is given), or production builds with readable names.
- `dom`: no React, or a production build with minified names, which would send the agent after components that do not exist.

**Results on the test matrix** (fixtures with three nested components, picking the button, a span and the heading):

| App                   | Bundler   | React | Result                                                                       |
| --------------------- | --------- | ----- | ---------------------------------------------------------------------------- |
| Vite                  | Vite 7    | 19    | `exact`, 3 of 3 lines right                                                  |
| Vite                  | Vite 7    | 18    | `exact`, 3 of 3 lines right                                                  |
| Next.js 16 App Router | Turbopack | 19    | client components `exact` 2 of 2; server component `component`               |
| Next.js 16 App Router | webpack   | 19    | client components `exact` 2 of 2; server component `component` with its file |
| Vite production build | —         | 19    | `dom`                                                                        |
| Plain HTML            | —         | —     | `dom`, no errors                                                             |

Not yet measured: Pages Router, webpack with React 18 outside Next.js, and large real projects. The roadmap's 90% target needs real apps, not fixtures.

## Runtime timeline (phase 4)

- **User actions** come from a small listener registered with `Page.addScriptToEvaluateOnNewDocument` in an isolated world (`yalqen-agent`), reported through `Runtime.addBinding` bound to that world only. The page's scripts can neither see the listener nor call the binding. The script also runs immediately in the current document, so switching the bridge on mid-session works. The `Page` domain has to stay on while observing, or the script does not reach later documents.
- **Privacy:** clicks, submits, `change` events and Enter are recorded with the element's tag, id, name and visible label. Typed values are never sent, only their length; password fields are skipped entirely.
- **Cause links:** the listener reports each event twice, in the capture phase on `window` and again in the bubble phase. A request that starts between the two was made synchronously by the handler and is linked as `direct`. Handlers that stop propagation never report the second phase, so an open action counts for at most 250 ms. A request within 1 second of an action is `likely`. A response is `direct` to its request. An exception is `direct` to a response when its stack shares a named, non-library function with the request's initiator stack, otherwise `likely` to a failed response in the previous second.
- **Episodes:** a response of 400 or above, a failed request (not a canceled one) or an uncaught exception opens an episode with the events of the preceding 10 seconds. Triggers within 3 seconds of each other extend the same episode. An episode keeps copies of its events (up to 60), so it outlives the 1,000-event timeline. The last 20 episodes per tab are kept in memory.
- **Interface:** the developer menu lists the latest episode and offers "Copy Reference for Agent", which copies its `yk_ep_` id.
- **Overhead:** reloading the Vite fixture, the median load event moved from 23.5 ms to 26.0 ms with the tab observed (15 reloads, three runs). Pages outside scope are unaffected.

## Agent actions and verification (phase 5)

- **Policy:** Settings → Developer → Agent actions: Off, Ask every time (default) or Allow. With "Ask", every action, and every replay as a whole, shows a confirmation dialog listing what will happen. `wait_for` only reads, so it never asks.
- **Visible control:** while an action runs, the tab is brought to the front, framed in the accent color, and a banner reads "Agent in control · Stop". Stop aborts the action at its next step; the next action in that tab asks again even under "Allow".
- **Input:** clicks are `Input.dispatchMouseEvent` at the centre of the element's content box after `DOM.scrollIntoViewIfNeeded`; `fill` focuses the field, selects all with the `selectAll` editing command and uses `Input.insertText`. No JavaScript is evaluated in the page for actions.
- **Scope:** `navigate` only opens addresses in scope; actions only reach observed tabs.
- **Replay:** the clicks and Enter presses of an episode are replayed by the selectors recorded with them. Typed values are not recorded, so changes to fields are skipped and reported, and fields keep their current contents. Submits are not replayed separately because the click or Enter that caused them is. Before replaying, Yalqen waits for the network to settle (as after an HMR update); afterwards it waits for the network again and 400 ms more for exceptions thrown from response handlers.
- **Verdict:** `passed` when the replay produced no failed response (status 0 or 400 and above) and no console error or exception; the per-request outcome (`POST /api/users: 500 → 201`) and a short notice above the page show the result. Starting an action closes any open episode, so the agent's own events never leak into the user's episode.

## Backlog items (phase 6)

- **Request rules over MCP:** `mock_response`, `block_request` and `redirect_request` add temporary rules to one observed tab. They live in memory with the observation, come before the user's saved rules, and use the same `Fetch` interception. Adding one is an agent action (it follows the action policy); clearing never asks. The developer indicator counts them.
- **Resending a request:** `resend_request` sends a recent request again from the main process with the tab's session (`session.fetch` with credentials), optionally with another method, body or headers. Only in-scope URLs; the response comes back masked and truncated.
- **Playwright export:** `export_playwright_test` (and "Copy Playwright Test" in the developer menu) turns an episode into a test that replays its clicks and Enter presses, waits for the requests that failed and expects them below 400 with a clean console. Typed values are left as blank `fill` calls with a comment, since they were never recorded.
- **Vue and Svelte:** the page inspector became `component-inspector`. Vue 3 (`__vueParentComponent`) and Vue 2 (`__vue__`) give the component, its file and owner chain but no line, so they report `component`. Svelte 5 (`__svelte_meta` with `loc` and the `parent` usage chain) gives the element's line and where the component is used, so it reports `exact`; Svelte 4 lines are zero-based and corrected.
- **WebMCP:** observed pages get a `navigator.modelContext` stand-in (`provideContext`, `registerTool`, `unregisterTool`, `clearContext`) in their own world when the browser has none. `list_page_tools` reads what the page registered; `call_page_tool` runs one as an agent action. A page that registers at load needs one reload after the connection is turned on.
- **Backend tracing** (Settings → Developer → Backend traces, off by default): same-origin `fetch` and XHR requests of observed tabs get a W3C `traceparent` header through `Fetch` interception limited to those resource types. Cross-origin requests never get it, because the extra header would trigger a CORS preflight the backend may refuse. The bridge accepts OTLP/HTTP JSON on `/v1/traces` with the same token; protobuf is refused with a hint to set `OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json`. A request's server span and every failing span join the timeline as `backend` events linked `direct` to the request, and are added to its episode even when they arrive after it closed; `get_backend_trace` returns all spans of the request.

## Setup and onboarding

- "Add to Claude Code" runs `claude mcp remove` then `claude mcp add --scope user` through the user's login shell (`$SHELL -ilc`), because apps opened from the Dock get a bare PATH. The URL and token go in as environment variables, never spliced into the script, and the token is masked in any error shown. The copied command also uses `--scope user`, so it works in every project rather than only the directory it was run in. Codex has no one-click setup yet: its CLI was not available to verify against.
- The settings pane names the connected agent from `clientInfo` in `initialize`, and warns when a request arrives with a wrong bearer token (a stale config after a token change). Requests without any token are clients probing for auth and are not flagged.
- The server's `instructions` describe the intended workflow: `get_error_episode` first, `replay_episode` after a fix. The developer menu copies a ready prompt with the episode id instead of the bare id.
- All tools stay listed even when agent actions are off. The whole list is about 2,800 tokens, hiding tools would need a reconnect after every policy change (the server has no notification stream), and a refused call already tells the agent where the user can allow actions.

## Agent panel

The window's agent panel runs Claude through the native chat interface (`agent-chat.ts`) or an optional PTY terminal (`agent-session.ts`). Both receive the local MCP connection. The terminal can receive the current tab reference, while chat messages can include tabs and picked elements. `project-runner.ts` starts the selected project's development server and opens its local URL in a tab.

## Naming

`yalqen` everywhere: the MCP server name, tool descriptions, the setup command and the docs.
