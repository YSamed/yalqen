# Startup and agent chat performance — 2026-10-13

Baseline: `2a90ac2` (Yalqen 0.3.62). This pass profiled the main process first and the window interface second, with CPU profiles of both instead of reading for suspects. The earlier passes ([backend](backend-performance.md), [interface](interface-performance.md), [main process](main-process-performance.md), [runtime](runtime-resource-audit.md), [structure](structure-audit.md)) left the measured operations fast, so most of the gain here comes from two places they did not cover: the order of work while the first window opens, and the agent chat that was added since.

## Main process

A CPU profile of the first 2.5 seconds showed about 165 ms of main-thread work, and one 10-second idle profile showed none beyond the profiler itself. Three findings were worth a change.

| Path              | Finding                                                                                                                                                                                                                                             | Change                                                                                                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First window      | `new BaseWindow` blocks the main thread for 37–46 ms the first time (41–49 ms in an empty Electron app whatever the options, 8–15 ms for a second window). The interface started loading only after it, so its renderer process waited for nothing. | `YalqenWindow` creates the interface view and calls `loadFile` first, then creates the native window and attaches the view. Electron's own `BaseWindow` example loads a view before attaching it.                   |
| Agent chat        | A streamed reply publishes every 32 ms. Each publish serialized every message to add up the history size, deep-cloned the transcript for the snapshot, and the window serialized the clone again to send it.                                        | The transcript is serialized once. Its length decides whether old messages must go, and the same text is sent to the interface. The trim loop runs only when the message or size cap is passed, with the same caps. |
| Module loading    | `parse5` was the most expensive module in the startup graph (4.1 ms of 33 ms), imported by `page-files.ts` for saving a page as HTML.                                                                                                               | It loads when a page is saved, as `bookmark-html.ts` already does for imports.                                                                                                                                      |
| Desktop wallpaper | Every window looked up and converted the desktop picture as soon as its interface loaded: two `plutil` runs, `osascript`, `sips` and a 40–75 KiB data URL over IPC. Only the full-screen glass backdrop draws it.                                   | Windows without glass skip it. Glass windows preload it three seconds after the interface loads, and still request it at once on entering full screen.                                                              |

## Window interface

The interface was profiled through the DevTools protocol while the real application started and while it received updates.

| Path          | Finding                                                                                                                                                                                                                                                                                                          | Change                                                                                                                                                                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First layout  | The window is shown when the interface reports its layout. That message was sent from an `$effect`, which runs after the DOM update and after the child components' effects, so it waited for all tab rows to render and for the toolbar's forced layout: 19 ms with 50 tabs.                                    | The layout effect and the two effects that feed it use `$effect.pre`. The layout depends only on state, so it is sent before the rows render: 3.4–4.4 ms after the state arrives. The first state request is also sent before the first `localStorage` read. |
| Agent chat    | Each update replaced the whole transcript with newly parsed objects. Every message part looked changed, so `marked` and DOMPurify rendered every text part again, and every tool card recomputed its diff, 30 times a second.                                                                                    | `reuseChatSnapshot` keeps the previous object for every message and part that is unchanged, matched by message id. Only the streamed text is rendered again.                                                                                                 |
| State signals | `App.svelte` gives each state field its own signal so that children do not subscribe to the whole state. Fields added later (`selectedTabIds`, groups, profile name, media and the agent panel's properties) were passed as `browser.x`, so every push rebuilt the selection set and re-evaluated every tab row. | Those fields have their own signals. `reuseBrowserState` also keeps unchanged agent providers, projects and background chats.                                                                                                                                |
| Settings page | `Sites.svelte` imported `tldts` to group origins by domain. The public suffix list was 263 kB of the 349 kB settings script, parsed on every visit to any pane.                                                                                                                                                  | The pane imports it on mount. The settings script is 86 kB; the list loads only with the Sites pane.                                                                                                                                                         |
| Benchmark     | `bench-interface.mjs` failed: its state lacked fields the interface now reads. The `reuseBrowserState` test fixture had the same stale shape.                                                                                                                                                                    | Both fixtures match `BrowserState` again.                                                                                                                                                                                                                    |

## Measurements

MacBook Air (Mac16,12, Apple M4, 16 GB), macOS 27.0.1, Electron 44.4.5, Svelte 5.57.1. Before and after use the same harness, fixtures and runtime; the baseline is a preserved build of `2a90ac2`.

### Startup

`scripts/bench.mjs --scenario startup --adblock off`, twelve rounds that alternate the baseline and the current build one run at a time. Every run uses a fresh profile with 50 restored tabs and 5,000 history visits. Median, with the range in brackets.

| Milliseconds                       | Before           | After            |
| ---------------------------------- | ---------------- | ---------------- |
| Window shown, from spawn           | 403.5 [387–437]  | 367.5 [347–371]  |
| Interface loaded, from spawn       | 323.5 [312–347]  | 301 [281–319]    |
| First page loaded, from spawn      | 311 [295–315]    | 330 [311–348]    |
| Extensions loaded → window shown   | 212 [197–246]    | 178 [158–183]    |
| Windows opened → interface loaded  | 71.5 [66.9–97.5] | 60.2 [50.0–61.9] |
| Interface loaded → window shown    | 80.0 [71.1–90.5] | 65.0 [50.3–69.7] |
| Modules loaded, from process start | 90.3             | 85.2             |

The window is shown about 36 ms (9%) earlier, and the ranges of the two builds do not overlap. The first page finishes about 19 ms later, because showing the window now competes with the page load instead of following it. It still finishes before the window is visible, so the time until both are ready falls from 403.5 to 367.5 ms. The bench page is a local static file; a real page loads after the window is shown in both builds.

The earlier window is not an empty one. In six more alternating runs that also read the interface's paint timing, its first contentful paint moved from 446.9 ms [420.8–509.6] to 407.7 ms [396.0–445.0] after process start, and the time from the shown window to that paint stayed at about 76 ms in both builds.

Requiring the main entry module took 33.9–35.8 ms before and 29.4–29.6 ms after (four alternating runs, 232 and 231 modules).

### Agent chat

Main process, `scripts/bench-agent-chat.mjs` with Node 22.23.3: the real `AgentChat` publishes a streamed reply into a transcript of prompts, replies, file reads and command results. Median of seven batches of 100 publishes, two alternating runs, checksum `13715` in both builds. The baseline number includes the serialization the window did.

| Transcript                      |  Before, ms |   After, ms | Speedup |
| ------------------------------- | ----------: | ----------: | ------: |
| 18 messages, 108 KiB            |       0.373 |       0.155 |    2.4× |
| 70 messages, 416 KiB            | 1.222–1.233 | 0.377–0.380 |    3.2× |
| 120 messages (the cap), 715 KiB | 2.028–2.069 | 0.570–0.582 |    3.6× |

Interface: the real application with the agent panel open received 100 updates that each extend the last reply of a rendered transcript. A CPU profile of the interface gives the active time per update.

| Transcript           | Before, ms per update | After, ms per update |
| -------------------- | --------------------: | -------------------: |
| 14 messages, 115 KiB |                  3.11 |                 1.11 |
| 50 messages, 411 KiB |                  9.16 |                 1.71 |

At 30 updates a second the 411 KiB case used 27% of the interface's main thread and now uses 5%. What remains is parsing the snapshot (0.34 ms) and the layout forced by keeping the conversation scrolled to its end (0.5 ms). The profiler adds overhead to both builds, so read these as a ratio.

### Window interface updates

`scripts/bench-interface.mjs`, 200 samples after 20 warm-up updates in a hidden window, two alternating runs. Round trip from send to applied update, median.

| Tabs | Scenario          |  Before, ms |   After, ms |
| ---- | ----------------- | ----------: | ----------: |
| 200  | Background title  | 0.985–1.008 | 0.920–0.921 |
| 200  | Download progress | 0.434–0.439 | 0.377–0.380 |
| 500  | Background title  | 2.417–2.436 | 2.216–2.218 |
| 500  | Download progress | 1.012–1.026 | 0.851–0.857 |

Updates take 6–17% less time. Without `tabGroups` in the state, which the main process always sends, the baseline's download update reads 1.44 ms at 500 tabs; that larger difference is an artifact of the fixture and is not claimed.

## Measured and left unchanged

- **Code caches.** Node's [`module.enableCompileCache`](https://nodejs.org/api/module.html#moduleenablecompilecachecachedir) and a V8 code cache for the interface scripts would cut compile time. Both store compiled code in a directory the user can write, outside the ASAR integrity check that the packaged app enables. [CVE-2025-55305](https://blog.trailofbits.com/2025/09/03/subverting-code-integrity-checks-to-locally-backdoor-signal-1password-slack-and-more/) used V8 snapshot files in the same way, so neither cache was added.
- **Internal page templates.** Reading each `yalqen://` template on first use saved 0.5 ms (4.2 to 3.7 ms between loaded stores and loaded extensions, twelve rounds) and was reverted.
- **Tab row animation.** Svelte measures every row of an animated `each` block when its list changes. With 500 tabs, `getBoundingClientRect` is 42% of a background title update in the hidden-window benchmark, most of it the layout that the toolbar alignment forces. A visible window pays for that layout once per frame anyway. Iterating stable id lists would avoid the measuring, but it rewrites the drag-and-drop template for about 0.3 ms at 500 tabs.
- **Locales.** Both translations (86 kB and 92 kB as compiled modules) are in the shared 216 kB interface script and in the main process (1.5 ms to load). Choosing one at run time needs an asynchronous import before the first render.
- **Native window and sessions.** Creating the first window (about 40 ms) and the three sessions (7 ms) is native work with no cheaper option.
- **Existing benchmarks.** `bench-backend.mjs` and `bench-tab-snapshots.mjs` produce the baseline checksums (`23893350` and `35000`) with timings inside run-to-run variation.

## Sources

- Electron, [Performance](https://www.electronjs.org/docs/latest/tutorial/performance): load modules when they are needed, and do not make startup wait for work it does not need.
- Electron, [BaseWindow](https://www.electronjs.org/docs/latest/api/base-window): the example calls `loadURL` on a `WebContentsView` before `addChildView`.
- Svelte, [`$effect`](https://svelte.dev/docs/svelte/$effect): effects run after the DOM update; `$effect.pre` runs before the DOM updates scheduled after it.
- web.dev, [Avoid large, complex layouts and layout thrashing](https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing): reading geometry after a DOM write forces a synchronous layout.

## Validation

- `npm run check`: lint, formatting, zero TypeScript/Svelte errors or warnings, and 793 passing tests (789 at baseline). New tests cover chat snapshot reuse for streamed text, trimmed and added messages, changed tool results and part types, and reuse of the agent lists in the window state.
- `npm run test:runtime`: all runtime tests pass, including the Sites pane that now loads the suffix list on mount and the page save that loads `parse5` on use.
- `scripts/capture-ui.mjs --compare`: no computed style differences on any of the 30 captures (window in glass and opaque, every settings pane, internal pages, light and dark).
- A scripted run of the real application collapsed and expanded the sidebar and opened and closed the agent panel in both builds. The layout messages (14 per sidebar animation, 1 per agent panel toggle), their first and last values and the frame-by-frame grid columns are identical.
- Full-screen entry on a glass window was not automated; its wallpaper request is the unchanged `syncFullScreen` path.

## Reproduction

From `apps/browser` after `npm run build`:

```bash
node scripts/bench.mjs --scenario startup --runs 1 --adblock off --out /tmp/startup-after.jsonl
node scripts/bench-agent-chat.mjs --out /tmp/chat-after.json
node scripts/bench-interface.mjs --tabs 500 --out /tmp/interface-after.json
```

For comparisons, preserve the baseline's `dist/` next to its `package.json`, `resources/` and a resolvable `node_modules`, then pass `--app-dir /path/to/baseline` to `bench.mjs`, `--module-dir /path/to/baseline/dist/main` to `bench-agent-chat.mjs` and `--renderer-dir /path/to/baseline/dist/renderer` to `bench-interface.mjs`. Alternate the builds one run at a time; startup medians from fewer than ten rounds overlap too much to compare.
