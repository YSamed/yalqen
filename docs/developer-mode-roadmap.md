# Yalqen Developer Mode: Roadmap

[Türkçe](developer-mode-roadmap.tr.md)

Status: draft · Date: 2026-10-03 · Scope: `apps/browser`

## 1. Summary

Developer Mode is a bridge between Yalqen and the coding agent a developer already uses (Claude Code, Codex, Cursor and any other agent that speaks MCP). The agent can read the source code but cannot see what happens in the browser. Yalqen gives it that information: the selected element, its component and source file, console errors, network requests, a screenshot and the order in which events happened.

Core principle:

```
The developer says what they want.
The agent changes the code.
Yalqen provides the context of the running app.
```

Yalqen does not gain an AI model, a chat panel or a paid service. It only shares what the browser already knows.

## 2. Positioning

"Select an element, send it to the agent" became common in 2026: Cursor Design Mode, the Codex in-app browser, the Claude Code desktop browser pane, the VS Code integrated browser, cmux, Stagewise and, for free, Chrome DevTools MCP together with react-grab. Most of these tools are tied to one agent or one IDE.

Yalqen has to stand out on four points:

1. **Agent-agnostic.** It serves any agent through standard MCP.
2. **No setup in the project.** No package, extension or flag is added to the developer's app.
3. **The developer's everyday browser.** Signed-in sessions, extensions and real tabs stay where they are.
4. **Runtime timeline.** Clicks, requests, errors and renders are kept in one local, always-on timeline.

At the end of every phase, ask again: "Why Yalqen when Chrome + chrome-devtools-mcp + react-grab exist?" If the answer does not rest on these four points, do not move to the next phase.

## 3. Design principles

1. **Yalqen does not push; the agent pulls.** Yalqen never types into a terminal. The agent asks through MCP when it needs something, so agent updates cannot break the integration.
2. **Off by default, localhost only.** Until the feature is turned on, no port is open and no tab is observed. When it is on, only local development tabs are visible to the agent.
3. **No separate "mode".** Yalqen is already a browser for developers. Instead of switching between a normal mode and a developer mode, a single "Agent connection" switch lives under Settings → Developer.
4. **Reuse what exists.** The CDP connection (`src/main/devtools/page-debugger.ts`), request rules (`src/main/devtools/request-rules.ts`), the console error counter (`src/main/tabs/tabs.ts`) and safeStorage encryption (`src/main/privacy/password-handlers.ts`) are already there.
5. **Data stays on the machine.** Everything collected is kept in memory, never written to disk and cleared when the tab closes. Yalqen makes no outbound requests for this feature.
6. **Every phase ships on its own.** Each phase ends with something releasable and a measurable exit criterion.
7. **Portable core.** Logic that handles CDP messages is written as pure functions, so the Electron-specific layer stays thin if Yalqen ever moves to CEF + AppKit (see [why-electron.md](decisions/why-electron.md)).

## 4. Phases at a glance

Durations are rough estimates for a single developer.

| Phase | Name                           | What the user gets                                                      | Duration  |
| ----- | ------------------------------ | ----------------------------------------------------------------------- | --------- |
| 0     | Preparation and measurement    | Nothing yet; decisions and baseline measurements                        | 1 week    |
| 1     | Agent bridge (read-only)       | "Look at the last error" is enough; the agent reads console and network | 2–3 weeks |
| 2     | Element picker                 | Click an element, tell the agent "fix this"                             | 2 weeks   |
| 3     | Component and source mapping   | The selection is tied to a React component and a `file:line`            | 3–4 weeks |
| 4     | Runtime timeline               | "What happened after I clicked the button?" is answered in one place    | 3–4 weeks |
| 5     | Agent actions and verification | The agent replays the flow and checks its own fix                       | 3 weeks   |
| 6     | Conditional backlog            | Expansion if the metrics justify it                                     | —         |

Decision points are at the end of phases 0, 2, 3 and 4 (see section 8).

## 5. Phases

### Phase 0: Preparation and measurement (1 week)

**Goal:** measure the problem in your own work and record the technical decisions.

**Work**

- For one week, write down every time you explain context to an agent: what you copied (console, network response, element, screenshot), how long it took, and how many times the agent went to the wrong file. This is the baseline.
- Do the same tasks with competing tools: Chrome + chrome-devtools-mcp + react-grab, and the Claude Code desktop browser pane. List the friction in each.
- Write the decision record `docs/decisions/agent-bridge.md`:
  - Transport: Streamable HTTP MCP on `127.0.0.1`. Yalqen is a GUI app, so a stdio process launched by the agent does not fit. The Electron fuses disable `runAsNode`, so a separate Node process is not an option either.
  - Dependencies: no MCP SDK at runtime; a small JSON-RPC server on `node:http`. The SDK is a dev dependency for end-to-end tests (see [agent-bridge.md](decisions/agent-bridge.md)).
  - Port: a fixed default port, falling back to the next free one. The chosen port is shown in settings.
- Naming: use `yalqen` everywhere in the CLI, tools and docs (not `yalken`).
- Prepare sample apps for testing: Next.js (App Router, Turbopack), Vite + React 19, webpack + React 18. Keep them in a separate repository so Yalqen's CI does not slow down.

**Exit criteria**

- The baseline measurements are written down.
- The decision record is merged.
- The sample apps run, and each has deliberately planted bugs: an API that returns 500, a `TypeError` and a button that overflows on mobile.

### Phase 1: Agent bridge, read-only (2–3 weeks)

**Goal:** let the agent read console, network and page information from localhost tabs. The error scenario works end to end with this phase.

**User experience**

1. Turn on Settings → Developer → "Agent connection (experimental)".
2. The settings page shows the setup commands:

   Claude Code:

   ```bash
   claude mcp add --transport http yalqen http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"
   ```

   Codex (`~/.codex/config.toml`):

   ```toml
   [mcp_servers.yalqen]
   url = "http://127.0.0.1:<port>/mcp"
   bearer_token_env_var = "YALQEN_MCP_TOKEN"
   ```

3. "Copy" and "Regenerate token" buttons are available.
4. When an agent connects, a small dot appears on the developer indicator in the toolbar. When the agent reads a tab, the indicator briefly highlights, so the user always knows what was read.

**Technical design**

New domain folder `src/main/agent-bridge/`:

| File                | Responsibility                                           |
| ------------------- | -------------------------------------------------------- |
| `server.ts`         | HTTP server and MCP sessions, start/stop, port selection |
| `auth.ts`           | Bearer token check, `Origin` and `Host` validation       |
| `tab-scope.ts`      | Decides which tabs are visible to the agent              |
| `runtime-buffer.ts` | Per-tab ring buffers for console and network             |
| `cdp-events.ts`     | Pure functions that turn CDP events into buffer records  |
| `redact.ts`         | Masks sensitive headers and values                       |
| `tools.ts`          | MCP tool definitions and input validation                |

- **Scope:** `localhost`, `127.0.0.1`, `[::1]`, `*.localhost` and `*.test`, plus origins added in settings. `LOCAL_HOSTS` in `src/main/privacy/passwords.ts` moves to a shared helper. Private windows are never in scope.
- **Collection:** only while the bridge is on and only in tabs in scope.
  - `Runtime.enable`: `consoleAPICalled` and `exceptionThrown` with stack traces.
  - `Log.enable`: errors produced by the browser itself (CSP, mixed content and similar).
  - `Network.enable`: `requestWillBeSent` (including the initiator), `responseReceived`, `loadingFinished`, `loadingFailed`.
  - Response bodies are fetched with `Network.getResponseBody` only on request and only for status 400 and above, truncated at 64 KB.
- **Buffer limits:** the last 200 console entries and the last 300 requests per tab. Cleared when the tab closes or the memory saver discards it.
- **Sharing CDP:** `page-debugger.ts` attaches once. Page overrides, device emulation and the bridge share that connection through a single `message` listener. Verify that it also works while DevTools is open.
- **Existing counter:** the `console-message` counter in `tabs.ts` stays as it is. The bridge uses its own CDP source because it needs stack traces.

**Phase 1 tools**

| Tool                   | Input                                                    | Output                                                                 |
| ---------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `list_tabs`            | —                                                        | Tabs in scope: id, URL, title, whether active                          |
| `get_page_info`        | `tab?`                                                   | URL, title, viewport, device emulation, color scheme, active overrides |
| `get_console_errors`   | `tab?`, `since?`, `include_warnings?`                    | Level, message, source `url:line`, stack                               |
| `get_network_requests` | `tab?`, `failed_only?` (default `true`), `url_contains?` | Method, URL, status, duration, initiator                               |
| `get_request_details`  | `request_id`                                             | Masked headers, request body, truncated response body                  |
| `take_screenshot`      | `tab?`, `full_page?`                                     | PNG (full page uses `captureFullPage`)                                 |
| `reload_page`          | `tab?`, `ignore_cache?`                                  | Result of the reload                                                   |

When `tab` is omitted, the active in-scope tab of the focused window is used.

**Security (completed in this phase)**

- The server binds to `127.0.0.1` only.
- A random 32-byte token is stored encrypted with `safeStorage`.
- Any request carrying an `Origin` header is rejected, so a page open in Yalqen or any other browser cannot reach the local port.
- Requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` are rejected (DNS rebinding protection).
- Headers such as `Authorization`, `Cookie`, `Set-Cookie`, `Proxy-Authorization` and `X-Api-Key` are masked by default.
- Tool descriptions and outputs state that text coming from the page is data, not instructions (against prompt injection).

**Tests** (`test/main/agent-bridge/`)

- Requests are rejected with no token, a wrong token, an `Origin` header or a wrong `Host`.
- Scope filter: localhost is accepted; regular sites and private windows are rejected.
- Buffers drop the oldest entry at the limit.
- Masking catches the expected headers.
- The server is started and the tools are called end to end with the MCP SDK client.

**Performance**

- With the bridge off, `npm run bench` results must not change. There must be no listeners and no open port (checked with `lsof -i`).
- With the bridge on, a small cost is acceptable on localhost pages only; measure it and add it to the performance reports.

**Exit criteria**

- In the sample Next.js app, telling Claude Code or Codex "look at the last error" makes the agent read the failing 500 request and the `TypeError` from Yalqen and reach the right file.
- On a regular site (for example github.com) no tool returns data.
- The feature ships with an "experimental" label.

### Phase 2: Element picker (2 weeks)

**Goal:** let the developer point at an element and let the agent receive it as "the selected element". In this phase the context is DOM-level; component mapping arrives in phase 3.

**User experience**

1. A shortcut (proposed: `⌥⌘P`; shortcuts starting with `⌥` alone type characters on macOS, so they are avoided), the developer menu or `>pick` in the command bar starts picking.
2. Chromium's own highlight follows the pointer. `Esc` exits.
3. On click, a small notice appears:

   ```
   Selected: button.primary "Add to cart"
   yk_3a271 copied to clipboard
   ```

4. In the terminal the developer types "make the selected button full width on mobile". The agent fetches the selection with `get_selected_element`.
5. Optional: clicking with `⇧` held adds more elements to the same selection.

**Technical design**

- Picking uses `Overlay.setInspectMode({ mode: 'searchForNode' })` and receives the node from the `Overlay.inspectNodeRequested` event. No script needs to be injected into the page.
- A snapshot is taken at pick time and stored immutably, so the selection stays valid even if HMR removes the node.
  - `DOM.describeNode`, `DOM.getOuterHTML` (truncated at 4 KB)
  - `CSS.getComputedStyleForNode` (layout-related properties only: display, position, width, flex/grid, margin, padding, font, color)
  - `DOM.getBoxModel` and an element screenshot clipped to the box
  - Accessible name and role from `Accessibility.getPartialAXTree`
  - Ancestor chain: tag, id, classes and short text at each level
- The selection id is `yk_` followed by 6 hex digits. The last 10 selections per tab are kept.
- The notice uses the existing toolbar notice style; no new panel is added.

**New tools**

| Tool                   | Input           | Output                                                         |
| ---------------------- | --------------- | -------------------------------------------------------------- |
| `get_selected_element` | `selection_id?` | HTML, styles, box, accessible name, ancestor chain, screenshot |
| `list_selections`      | `tab?`          | Recent selections: id, short description, time                 |

**Exit criteria**

- Across 10 tasks in each of the three sample apps, measure and record how often the agent finds the right file with DOM context alone. This becomes the baseline for phase 3's gain.
- Picking works inside iframes, or clearly says it is not supported.

### Phase 3: Component and source mapping (3–4 weeks)

**Goal:** tie the selected element to its React component and a `file:line`. React and Next.js come first.

**User experience**

The notice now reads:

```
Selected: AddToCartButton
src/features/product/AddToCartButton.tsx:84
ProductPage › ProductDetails › PurchaseActions › AddToCartButton
```

**Technical design**

- **Spike (first week):** evaluate whether `bippy` (MIT, the foundation of react-grab) can be used instead of writing this from scratch. Compare license, size and React 19 support, and add the decision to the record.
- **Hook injection:** dropped after the spike. The fiber is reachable from the DOM node, so nothing runs in the page before the user picks an element (see [agent-bridge.md](decisions/agent-bridge.md)).
- **Component chain:** find the fiber through the `__reactFiber$...` key on the selected DOM node and walk up the `return` chain, listing user (non-host) components.
- **Source location:**
  - React 18 and earlier: `_debugSource` on the fiber.
  - React 19: `_debugSource` was removed. Parse `_debugStack` on the fiber and map the bundled `url:line:column` to the real file through the dev server's source map (`source-map-js`, BSD-3). Cache source maps per script URL.
  - Path normalization: `webpack-internal:///`, `turbopack://`, and Vite's `/src/...` and `/@fs/...` forms are converted to project paths.
- **Props:** first level and primitive values only; functions appear as `[Function onClick]` and long strings are truncated.
- **Confidence:** every result carries a confidence level: `exact` (exact line from a source map), `component` (component name only), `dom` (DOM only). The agent never mistakes a guess for a certainty.

**Changed and new tools**

- `get_selected_element` now also returns `component`, `source { file, line, column, confidence }`, `owner_chain` and `props`.
- `get_component_tree(selection_id, depth?)`: the component tree around the selection.

**Test matrix**

| App                  | Bundler   | React | Expected                 |
| -------------------- | --------- | ----- | ------------------------ |
| Next.js App Router   | Turbopack | 19    | `exact` (source map)     |
| Next.js Pages Router | webpack   | 19    | `exact`                  |
| Vite + React         | Vite      | 19    | `exact`                  |
| webpack + React      | webpack   | 18    | `exact` (`_debugSource`) |
| Production build     | —         | 19    | `component` or `dom`     |
| Non-React page       | —         | —     | `dom`, no errors         |

**Exit criteria**

- In the development builds of the matrix, `file:line` accuracy is above 90% for elements rendered by user components.
- Repeat the 30 tasks from phase 2 and measure how much more often the agent reaches the right file.
- Hook injection never runs on non-localhost pages (verified by a test).

### Phase 4: Runtime timeline (3–4 weeks)

**Goal:** answer "what exactly happened after I clicked the button?" in one place. This phase is where the product really stands apart.

**User experience**

- When an error occurs, the developer indicator in the toolbar shows the latest "error episode" as a short list:

  ```
  10:31:14  Clicked "Save" (UserForm)
  10:31:14  POST /api/users
  10:31:15  500 Internal Server Error
  10:31:15  TypeError: Cannot read properties of undefined (reading 'id')
  ```

- A "Copy reference" button copies an episode id such as `yk_ep_91f20`. Typing "look at yk_ep_91f20" in the terminal is enough.

**Technical design**

- **Event model:**

  ```ts
  interface TimelineEvent {
    id: string;
    tabId: number;
    time: number;
    kind:
      | "navigation"
      | "click"
      | "input"
      | "submit"
      | "request"
      | "response"
      | "console"
      | "exception";
    data: unknown;
    causeId?: string;
    causeConfidence?: "direct" | "likely";
  }
  ```

- **User actions:** a small script injected into tabs in scope listens for `click`, `submit`, `change` and the Enter key in the capture phase and forwards them to the main process through `Runtime.addBinding`. No new preload IPC is added.
- **Input privacy:** input values are not recorded, only their lengths. Password fields are never recorded. An optional setting allows recording values on localhost.
- **Cause links:**
  - If `initiator.stack` in `Network.requestWillBeSent` contains the handler of a user action, the link is `direct`.
  - If a request starts within 1 second of an action and there is no stack, the link is `likely`.
  - An exception whose stack points at the same handler is linked to the request.
  - The agent is told explicitly that `likely` links are not certain.
- **Error episode:** a response of 400 or above, or an uncaught exception, is grouped with the events from the preceding 10 seconds into an episode.
- **Limits:** the last 1,000 events and the last 20 episodes per tab, in memory only.

**New tools**

| Tool                  | Input                          | Output                                                     |
| --------------------- | ------------------------------ | ---------------------------------------------------------- |
| `get_timeline`        | `tab?`, `since?`, `limit?`     | Events in time order with their links                      |
| `get_error_episode`   | `episode_id?` (latest episode) | Events in the episode, request details, related selections |
| `list_error_episodes` | `tab?`                         | Episode summaries                                          |

**Exit criteria**

- In the three error scenarios of the sample apps, the episode shows events in the right order with the right links.
- Measure the overhead on localhost page loads; if it is significant, shrink the injected script.
- With only the episode id, the agent finds the cause in fewer steps than in the baseline.

### Phase 5: Agent actions and verification (3 weeks)

**Goal:** let the agent replay the same flow after a fix and verify the result itself.

**User experience**

- Settings → Developer → "Agent actions": Off / Ask every time (default) / Allow.
- While the agent controls a tab, a clear border and an "Agent in control · Stop" button appear around it.
- The verification result is also shown as a notice:

  ```
  Verification passed
  POST /api/users → 201
  No console errors
  ```

**Technical design**

- Actions use CDP `Input.dispatchMouseEvent` and `Input.insertText`, the closest path to real user input.
- Navigation is allowed only to origins in scope.
- Waiting for HMR: wait for `Page.frameNavigated`, Vite/Next HMR console messages or the network to settle.
- Replay: the user actions in an error episode are replayed in order. The result is compared with the request statuses and errors in the episode.
- `evaluate` (running arbitrary JavaScript in the page) is not added in this phase.

**New tools**

| Tool             | Input                                    | Output                                                                |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `click`          | `selector` or `selection_id`             | Result and the events that followed                                   |
| `fill`           | `selector`, `value`                      | Result                                                                |
| `navigate`       | `url` (in scope)                         | Result                                                                |
| `wait_for`       | `selector?`, `network_idle?`, `timeout?` | Result                                                                |
| `replay_episode` | `episode_id`                             | New episode and its difference from the old one: `passed` or `failed` |

**Exit criteria**

- In the sample app, the agent fixes the bug, calls `replay_episode` and gets "201, no console errors".
- With "Off", no action tool runs; with "Ask every time", no action happens without the confirmation dialog.

### Phase 6: Conditional backlog

These items are taken up only if the metrics justify it, on demand rather than in order.

- **Request rules over MCP:** `mock_response`, `block_request` and `redirect_request` tools on top of the existing `request-rules.ts`. Low cost.
- **Resending a request:** resend a failed request with an edited body.
- **Playwright test export:** generate a test file from an error episode.
- **Vue and Svelte support:** easier than React. Vue development builds expose the file through `__vueParentComponent.type.__file`, Svelte development builds through `__svelte_meta`.
- **Backend tracing:** add a `traceparent` header to localhost requests and run a local OTLP receiver that links backend spans into the same timeline.
- **WebMCP:** if a page registers tools with `navigator.modelContext`, expose them to the agent.
- **Sending to the terminal:** only if users explicitly ask for it, and only through a wrapper such as `yalqen claude`.

## 6. Security and privacy model

| Threat                                           | Mitigation                                                                          |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| A web page sending requests to the local port    | Requests with `Origin` are rejected, `Host` is validated, a token is required       |
| Another process on the machine reaching the port | Bearer token; the token can be regenerated                                          |
| The agent reading a banking or email tab         | Only localhost and allowed origins; private windows are never in scope              |
| Secrets in network data                          | Sensitive headers are masked, bodies are truncated                                  |
| Prompt injection from page content               | Tool outputs are marked as untrusted page data                                      |
| The agent taking unwanted actions                | Actions ask for confirmation by default, with a visible border and a stop button    |
| Data becoming persistent                         | Everything stays in memory; nothing is written to disk, cleared when the tab closes |

At the end of each phase, [SECURITY.md](../.github/SECURITY.md) and the privacy page are updated to match this table.

## 7. Success metrics

Because of Yalqen's privacy stance, no automatic telemetry is added for this feature. Measurement comes from three places:

- **Your own use:** compared with the phase 0 baseline. Time spent explaining context, how often the agent goes to the wrong file, and weekly usage.
- **Local counters:** counters under Settings → Developer that only the user can see: selections this week, tool calls by the agent. Beta users can share them by hand if they want.
- **Beta group:** 5–10 developers, with a short interview at the end of each phase.

Targets:

- End of phase 2: you and more than half of the beta group use it at least 3 times a week.
- End of phase 3: the rate at which the agent reaches the right file on the first try is clearly higher than in phase 2.
- After 4 weeks: most beta users still keep the feature on.

## 8. Decision points

| When           | Question                                                    | If not                                                       |
| -------------- | ----------------------------------------------------------- | ------------------------------------------------------------ |
| End of phase 0 | Does carrying context really cost time?                     | Stop the project and return to core browser work             |
| End of phase 2 | Was the target of 3 uses a week met?                        | Do not start phase 3; change direction from feedback or stop |
| End of phase 3 | Is React mapping above 70%?                                 | Drop the in-house mapping and integrate react-grab/bippy     |
| End of phase 4 | Is the timeline used, and does it shorten the agent's work? | Postpone phase 5; polish phases 1–3                          |

## 9. Open questions

- **Port:** a fixed default port, or a random port on every launch? A fixed port means the setup command is written once; a random port is safer but the command changes every time.
- **Multiple windows and profiles:** should the default tab follow the focused window, or should the agent always name the tab?
- **Remote development environments:** should addresses such as `*.ngrok.app` or Codespaces be supported through origins the user adds by hand?
- **CEF + AppKit migration:** CEF also supports the DevTools protocol. CDP logic written as pure functions is portable; only the thin Electron layer is rewritten.
- **Licenses:** `source-map-js` (BSD-3) and, if used, `bippy` (MIT) are added to [THIRD_PARTY_NOTICES.md](../apps/browser/THIRD_PARTY_NOTICES.md).

## 10. Permanently out of scope

- An AI model, chat panel or paid service inside Yalqen.
- Cloud sync, or collected data leaving the machine.
- Exposing pages outside localhost to the agent by default.
- A separate "Normal Mode / Developer Mode" switch.
