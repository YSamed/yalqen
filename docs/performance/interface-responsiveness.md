# Interface responsiveness and adjustable glass — 2026-10-13

Baseline: `ed39cbb` (Yalqen 0.3.63), after the [startup and agent chat pass](startup-and-agent-chat.md). This pass asked what makes the interface feel slow, measured each common interaction in the real application, and changed the two that were above the 100 ms that reads as instant. It also makes the glass window adjustable.

## What was measured

The real application ran with a temporary profile, restored tabs on local pages and the glass material. Mouse and keyboard input was injected with `webContents.sendInputEvent`, and each process recorded its own timestamps on the shared wall clock.

| Interaction                                   | Before                                                     | Result             |
| --------------------------------------------- | ---------------------------------------------------------- | ------------------ |
| Switch tab with a 90 ms mouse press           | Page shown 96 ms after the press, sidebar highlight 106 ms | Changed, see below |
| New tab                                       | Row after 16 ms, page first paint after 134–137 ms         | Changed, see below |
| Open the address bar                          | First frame after 13–30 ms                                 | Left as it is      |
| Close tab                                     | Row gone after 20 ms                                       | Left as it is      |
| Agent panel, first open                       | Content after 54 ms                                        | Left as it is      |
| Scroll the tab list, 300 tabs                 | No frame over 17.6 ms in 205 frames                        | Left as it is      |
| Sweep the pointer over the tab list, 300 tabs | No frame over 17.6 ms in 272 frames                        | Left as it is      |
| Collapse and expand the sidebar, 300 tabs     | No frame over 17.2 ms                                      | Left as it is      |

## Changes

| Path           | Finding                                                                                                                                                                                                        | Change                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab switch     | Tabs were activated by `click`, which fires when the button is released. The switch itself took 5–14 ms; the rest of the wait was the press.                                                                   | Sidebar rows, pinned tiles and toolbar tabs activate on `pointerdown` with the primary button and no modifier. Shift and Command clicks, middle click, the context menu and keyboard activation are unchanged.                                                                                                                                                                                                                               |
| Drag and focus | Activating a tab gives its page the keyboard focus. During a press that blurs the interface, and the tab list ended a drag on blur.                                                                            | A press activates without giving the page focus (`activate-tab` with `pressed`) and hands the keyboard back to the interface, so Escape still cancels a drag. The click that follows sends `focus-page`. A blur no longer ends a drag; a pointer move without the button does, which covers a release in another app. A drag swallows the click, as before, so focus stays in the tab list after a drop.                                     |
| New renderer   | Every new tab, every restored tab on first use and every navigation to a new site waited for a renderer process to launch: 68 ms of the new tab's 87 ms to `domInteractive`.                                   | `--enable-features=SpareRendererForSitePerProcess` keeps one renderer warm. Electron stopped overriding this Chromium feature in 44.0.0.                                                                                                                                                                                                                                                                                                     |
| Glass          | The tint over the native glass was fixed at 22% in light mode and 32% in dark mode. In light mode the muted text can be hard to read over a dark desktop, and nothing but turning glass off could change that. | A **Glass tint** slider in Settings → Appearance sets `glassTint` (0–100, default 25). The interface exposes it as `--glass-tint`, and `--chrome-base` scales its alpha from it: 0–88% in light mode, 0–96% in dark mode. The default gives the previous 22% and 32% exactly. The slider changes the window chrome only: the full-screen backdrop, Increase Contrast, the address bar overlay and the settings page keep their fixed values. |

## Measurements

MacBook Air (Mac16,12, Apple M4, 16 GB), macOS 27.0.1, Electron 44.4.5. Before is a preserved build of `ed39cbb`; runs alternate between the builds.

### Tab switch

Five tabs, 15 switches per run, two runs per build. Milliseconds after the mouse button goes down, with the button held for 90 ms. Median, with the range of one run in brackets.

| Event                        | Before              | After            |
| ---------------------------- | ------------------- | ---------------- |
| Main process receives action | 92.1 [90.6–93.3]    | 0.9 [0.6–2.0]    |
| Page visible                 | 96.0 [94.5–97.5]    | 5.0 [4.1–7.0]    |
| Sidebar marks the tab active | 106.5 [103.9–110.5] | 13.0 [10.9–16.6] |

The saving is the length of the press, so it differs between people; the harness held the button for 90 ms. With a press of any length the page is now visible about 5 ms after the button goes down.

### New tab

Six new tabs per run, three alternating runs per build. Milliseconds after the action, median of each run.

| Event                  | Before      | After     |
| ---------------------- | ----------- | --------- |
| `domInteractive`       | 86.5–87.7   | 30.7–32.0 |
| Load event             | 97.7–99.4   | 43.2–46.9 |
| First contentful paint | 134.2–137.4 | 84.0–87.0 |

The spare renderer has a physical footprint of 14 MB (`footprint`), against 25 MB for a new tab page, and a working set of 63 MB as the process list reports it. It appears as one more page process in Settings → Performance and in the startup benchmark's memory total.

### Startup

`scripts/bench.mjs --scenario startup --adblock off`, twelve alternating rounds, 50 restored tabs. Median and range, milliseconds from spawn.

| Mark              | Before        | After           |
| ----------------- | ------------- | --------------- |
| Window shown      | 378 [363–394] | 378 [361–429]   |
| First page loaded | 351 [329–362] | 359.5 [341–414] |

Startup is unchanged within the noise of the runs.

### Glass tint

A settings update from the slider takes 0.6 ms (median of 60, 95th percentile 2.8 ms) from the settings page to the applied setting, so the window follows the slider while it moves. The window was captured with the desktop behind it at 0, 25, 60 and 100 in light and dark mode.

## Trade-offs

- **A press cannot be cancelled.** Moving the pointer off a tab before releasing no longer avoids the switch. The same is reported for Chrome and Firefox; the switch is not destructive and pressing the previous tab reverses it. WCAG 2.5.2 lists activation on the down-event as a failure for web content and exempts what is needed to operate the user agent; the tab list is the browser's own interface. Closing a tab, the toolbar buttons and every other control still act on release.
- **Dragging an inactive tab activates it first.**
- **The spare renderer costs about 14 MB** for the whole session.

## Measured and left unchanged

- **Address bar, tab close, agent panel.** All answer in under 60 ms.
- **Scrolling, hover and the sidebar animation.** No dropped frame with 300 tabs on glass.
- **Sidebar highlight after the page.** The highlight follows the page by about one frame, because it waits for the state from the main process. An optimistic highlight would save that frame and need a way to undo itself.
- **Native view switch.** Removing and adding the page views and moving focus take about 2.7 ms of main-thread time per switch.
- **A prerendered new tab page.** A hidden, ready page would paint at once, but the page is built from one-shot state (welcome, announcement and repository prompts) that a hidden copy would consume.
- **Native glass variants.** `electron-liquid-glass` sets the native tint only when the view is created, and its variant methods use private macOS APIs, so the adjustable part is the tint the interface draws.

## Sources

- web.dev, [Measure performance with the RAIL model](https://web.dev/articles/rail): a response within 100 ms of the input feels immediate.
- Electron, [#53116](https://releases.electronjs.org/pr/53116): the spare renderer, the `SpareRendererForSitePerProcess` opt-in, its conditions and its memory cost.
- W3C, [Understanding SC 2.5.2: Pointer Cancellation](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html).

## Validation

- `npm run check`: lint, formatting, zero TypeScript/Svelte errors or warnings, and 794 passing tests. A new test covers the glass tint's range and invalid values.
- `npm run test:runtime`: all pass, including pinning, tab selection and bulk tab actions.
- A scripted run drove injected input in both builds with the interface focused: click, drag of an inactive and of the active tab, Escape during a drag, Shift click, Command click, a click that clears the selection, Enter on a focused row, middle click and a press on a toolbar tab. Each gesture sends one activation at most, the drags reorder as before, and a toolbar press does not open the address bar on release. A second run dragged tabs that were never loaded, loaded inactive tabs and the active tab, sent a blur in the middle of a drag (the drag continued) and a move without the button (the drag ended without a reorder).
- Not verified: the run could not make its window the key window, and injected input does not move the system's first responder as a real mouse does. Four early runs lost focus during a press and did not reproduce later. A blur can no longer end a drag, but Escape during a drag in the foreground window and a drag with a real mouse still need one manual check.
- `scripts/capture-ui.mjs --compare`: no computed style difference on any window or page capture. The appearance pane gains the five elements of the new row.
- The slider was driven on the real settings page; the window's tint followed it.
- The sidebar and agent panel animations send the same first and last layouts as before.
