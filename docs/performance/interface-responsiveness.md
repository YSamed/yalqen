# Interface responsiveness and adjustable glass — 2026-10-13

Baseline: `ed39cbb` (Yalqen 0.3.63), after the [startup and agent chat pass](startup-and-agent-chat.md). This pass asked what makes the interface feel slow, measured each common interaction in the real application, and changed the two that were above the 100 ms that reads as instant. It also makes the glass window adjustable. One of the two changes, switching tabs on the press, broke tab dragging with a real mouse and was withdrawn; see [Tab switch on press, withdrawn](#tab-switch-on-press-withdrawn).

## What was measured

The real application ran with a temporary profile, restored tabs on local pages and the glass material. Mouse and keyboard input was injected with `webContents.sendInputEvent`, and each process recorded its own timestamps on the shared wall clock.

| Interaction                                   | Before                                                     | Result             |
| --------------------------------------------- | ---------------------------------------------------------- | ------------------ |
| Switch tab with a 90 ms mouse press           | Page shown 96 ms after the press, sidebar highlight 106 ms | Withdrawn          |
| New tab                                       | Row after 16 ms, page first paint after 134–137 ms         | Changed, see below |
| Open the address bar                          | First frame after 13–30 ms                                 | Left as it is      |
| Close tab                                     | Row gone after 20 ms                                       | Left as it is      |
| Agent panel, first open                       | Content after 54 ms                                        | Left as it is      |
| Scroll the tab list, 300 tabs                 | No frame over 17.6 ms in 205 frames                        | Left as it is      |
| Sweep the pointer over the tab list, 300 tabs | No frame over 17.6 ms in 272 frames                        | Left as it is      |
| Collapse and expand the sidebar, 300 tabs     | No frame over 17.2 ms                                      | Left as it is      |

## Changes

| Path         | Finding                                                                                                                                                                                                        | Change                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab switch   | Tabs are activated by `click`, which fires when the button is released. The switch itself takes 5–14 ms; the rest of the wait is the press.                                                                    | Activation on `pointerdown` shipped in 0.3.65 and was withdrawn: see below. Tabs activate on `click` again.                                                                                                                                                                                                                                                                                                                                  |
| New renderer | Every new tab, every restored tab on first use and every navigation to a new site waited for a renderer process to launch: 68 ms of the new tab's 87 ms to `domInteractive`.                                   | `--enable-features=SpareRendererForSitePerProcess` keeps one renderer warm. Electron stopped overriding this Chromium feature in 44.0.0.                                                                                                                                                                                                                                                                                                     |
| Glass        | The tint over the native glass was fixed at 22% in light mode and 32% in dark mode. In light mode the muted text can be hard to read over a dark desktop, and nothing but turning glass off could change that. | A **Glass tint** slider in Settings → Appearance sets `glassTint` (0–100, default 25). The interface exposes it as `--glass-tint`, and `--chrome-base` scales its alpha from it: 0–88% in light mode, 0–96% in dark mode. The default gives the previous 22% and 32% exactly. The slider changes the window chrome only: the full-screen backdrop, Increase Contrast, the address bar overlay and the settings page keep their fixed values. |

## Measurements

MacBook Air (Mac16,12, Apple M4, 16 GB), macOS 27.0.1, Electron 44.4.5. Before is a preserved build of `ed39cbb`; runs alternate between the builds.

### Tab switch on press, withdrawn

Five tabs, 15 switches per run, two runs per build. Milliseconds after the mouse button goes down, with the button held for 90 ms. Median, with the range of one run in brackets.

| Event                        | On click            | On press (withdrawn) |
| ---------------------------- | ------------------- | -------------------- |
| Main process receives action | 92.1 [90.6–93.3]    | 0.9 [0.6–2.0]        |
| Page visible                 | 96.0 [94.5–97.5]    | 5.0 [4.1–7.0]        |
| Sidebar marks the tab active | 106.5 [103.9–110.5] | 13.0 [10.9–16.6]     |

Activating on the press made the page visible about 5 ms after the button went down. It also switched the native page views and moved the keyboard focus while the button was still down. With injected input every drag still worked, but injected input does not go through the system's mouse tracking, and with a real mouse tabs could no longer be dragged to a new place (reported on 0.3.66). In a window that holds the focus, the interface logged a blur, a focus and two more blurs during one press.

The tab list, the toolbar tabs and `TabManager.activate` are back to the code before the change: activation on `click`, a drag that ends on blur, and no `pressed` or `focus-page` action. A later attempt needs a test with real mouse input, which the injected-input harness cannot give, and a way to switch the page without changing the native view hierarchy or the focus while a button is down.

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

## First frame of the window

Added on 2026-10-13 after a report of a dark flash when a glass window opens. The window was shown as soon as the interface sent its layout, but a page in a hidden window does not draw, so the first frames showed the bare glass over the desktop: dark in light mode over a dark wallpaper, bright in dark mode. A recording of only the application's windows shows the empty glass for the first four to five frames.

`YalqenWindow` now turns background throttling off for the interface when the first layout arrives, waits for the page's first paint entry or 200 ms, shows the window and turns throttling back on. The one-second fallback remains.

Three alternating runs with 20 restored tabs, milliseconds from process start:

| Event                             | Before        | After       |
| --------------------------------- | ------------- | ----------- |
| `window.show()`                   | 262–294       | 320–369     |
| Interface first contentful paint  | 502–552       | 319–357     |
| Paint relative to `window.show()` | 238–258 after | 1–12 before |

The window is shown 46–62 ms after the layout instead of at once, and it is complete when it appears. The startup benchmark's `window-shown` mark moves later by the same amount; that shift is intended and is not a regression against the 367.5 ms of the [startup pass](startup-and-agent-chat.md). The runs took place while another app was full screen, so the system also switched Spaces; without that switch the earlier pass measured about 76 ms between the shown window and its first paint.

## Trade-offs

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
- W3C, [Understanding SC 2.5.2: Pointer Cancellation](https://www.w3.org/WAI/WCAG22/Understanding/pointer-cancellation.html), read for the withdrawn activation on the press.

## Validation

- `npm run check`: lint, formatting, zero TypeScript/Svelte errors or warnings, and 794 passing tests. A new test covers the glass tint's range and invalid values.
- `npm run test:runtime`: all pass, including pinning, tab selection and bulk tab actions.
- After the withdrawal, a drag in a window that holds the focus reorders the tab and sends only `move-tab`; the interface keeps the focus.
- `scripts/capture-ui.mjs --compare`: no computed style difference on any window or page capture. The appearance pane gains the five elements of the new row.
- The slider was driven on the real settings page; the window's tint followed it.
- The sidebar and agent panel animations send the same first and last layouts as before.
