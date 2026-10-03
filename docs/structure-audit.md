# Structure and rendering audit — 2026-10-03

Baseline: `9d38139` (Yalqen 0.2.30). This pass read every module, regrouped the source into domains, removed dead code and fixed the costs and bugs found on the way. The resulting layout is described in [Architecture](architecture.md).

## Findings and changes

| Area             | Finding                                                                                                                                                                                                                                                               | Result                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Internal pages   | Page templates filled their slots with `String.prototype.replace`, which expands `$&`, `` $` `` and `$'` in the inserted text. A history, bookmark or pinned-site title containing these patterns inserted the slot marker or the surrounding template into the page. | Slots are filled through a replacement function. A regression test covers the history, bookmarks and new tab pages.                                                                                                                                                                                                                                                                                            |
| Bookmarks page   | Every bookmark row rendered a `<select>` listing every folder, so the page grew with bookmarks × folders and was rebuilt after each edit.                                                                                                                             | Each row lists only its current folder; `bookmarks.js` copies the full list from one `<template>` when the row's editor opens. The page's CSP now allows same-origin scripts, as on the downloads page.                                                                                                                                                                                                        |
| History page     | Each of up to 5,000 rows formatted its day and translated its labels.                                                                                                                                                                                                 | The day is formatted only at local day boundaries and row labels are translated once per page.                                                                                                                                                                                                                                                                                                                 |
| Window interface | Child components received `browser.tabs` and similar members, which subscribed them to the whole state, so every push re-filtered and re-keyed all tab rows. `TabPanel` also found each row's index with `indexOf`, quadratic in tabs.                                | `App.svelte` gives each field its own derived signal. The panel uses an id-to-index map and computes each row's label once.                                                                                                                                                                                                                                                                                    |
| Page gestures    | The swipe listener read computed styles and scroll widths along the event path on every horizontal wheel event.                                                                                                                                                       | Chromium keeps a wheel gesture on one scroller, so the check runs once per gesture.                                                                                                                                                                                                                                                                                                                            |
| Dead code        | The recently-closed section was removed from the new tab page in #119, but `recentlyClosed()`, `recentPages()`, `forgetClosed()` and the `yalqen://newtab/forget` command remained, as did `frozenCount`, `discardBackground()` and six unused translations.          | Removed.                                                                                                                                                                                                                                                                                                                                                                                                       |
| Structure        | 69 main-process modules shared one folder. `tabs.ts` (1,471 lines), `window.ts` (1,035), `main.ts` (688) and `Settings.svelte` (794) each mixed several responsibilities.                                                                                             | Modules are grouped into domain folders. `TabManager` delegates tab records, freezing, auto reload, translation, page placement and DevTools overrides to their own modules. Window menus, page capture, import dialogs, session setup, settings and extension IPC, the application menu, external links and the memory saver moved out of `window.ts` and `main.ts`. Each settings pane is its own component. |
| Duplication      | The DevTools protocol version and attach logic existed in three places; the zoom and memory-saver choices were listed separately in the main process and the settings page.                                                                                           | One debugger helper; the choices live in `shared/types.ts`.                                                                                                                                                                                                                                                                                                                                                    |
| Tooling          | `bench-interface.mjs` asserted on the removed sidebar download card and failed.                                                                                                                                                                                       | It checks the toolbar progress ring. Benchmarks resolve modules through `scripts/main-module.mjs`, so baselines from before the move still load.                                                                                                                                                                                                                                                               |

## Measurements

### Internal page generation

Node 22.23.3, `scripts/bench-internal-pages.mjs`, median of seven batches, two alternating before/after runs. The main process, and with it every window, is blocked while a page is generated.

| Page                            |  Before, ms | After, ms | Before HTML | After HTML |
| ------------------------------- | ----------: | --------: | ----------: | ---------: |
| History, 5,000 visits           |  9.90–10.01 | 6.11–6.14 |   2,589 KiB |  2,589 KiB |
| Bookmarks, 5,000 in 250 folders | 177.7–178.7 | 7.33–7.58 |  58,980 KiB |  4,060 KiB |
| Bookmark search, 500 results    | 17.15–17.46 |      0.63 |   5,884 KiB |    402 KiB |
| Downloads, 200 entries          |   0.30–0.31 |      0.30 |      79 KiB |     79 KiB |

With 2,000 bookmarks in 50 folders the page shrank from 8.3 MB with 102,000 `<option>` elements to 1.7 MB with 2,051. A temporary Electron run loaded a page with 300 bookmarks and 40 folders: closed rows contain one option, opening a row's editor shows all 41 with the current folder selected, titles containing `$&` render literally, and the console stays free of errors.

### Window interface updates

Electron 44.4.5, `scripts/bench-interface.mjs`, 200 samples after 20 warm-up updates in a hidden window. Rows with ranges come from two alternating runs; the active-only rows from one.

| Tabs                     | Scenario          | Before median / p95, ms | After median / p95, ms |
| ------------------------ | ----------------- | ----------------------: | ---------------------: |
| 200                      | Background title  |       1.3–1.4 / 1.5–1.6 |          1.2 / 1.3–1.4 |
| 200                      | Download progress |       1.0–1.1 / 1.1–1.3 |              0.7 / 0.8 |
| 500                      | Background title  |       3.5–3.7 / 4.0–4.1 |          3.0 / 3.2–3.3 |
| 500                      | Download progress |       2.6–2.7 / 2.9–3.2 |          1.7 / 1.8–1.9 |
| 200, active-only toolbar | Background title  |               1.2 / 1.4 |              1.0 / 1.1 |
| 200, active-only toolbar | Download progress |               1.0 / 1.2 |              0.7 / 0.8 |

A page that only receives the 500-tab state took 1.2 ms per update, so most of the remaining time at that size is the context bridge copying the state.

### Paths measured and left unchanged

- `TabManager.state()` with 500 tabs, 20 of them live, takes 0.085 ms, or 0.18 ms including the JSON comparison in `pushState`; full-state pushes are not a main-process bottleneck at that size.
- Recreating the toolbar's resize observer on tab changes made no measurable difference, so it was kept.
- Extracting a 12 MB, 291-file extension package blocks the main thread for about 26 ms. Installation is rare and user-initiated, so extraction stays synchronous.
- The native tab snapshot and backend operation benchmarks produce the baseline checksums (`35000` and `23893350`) with timings within run-to-run variation.

## Validation

- `npm run check`: lint, formatting, zero TypeScript/Svelte errors or warnings, and 346 passing tests (341 at baseline). New tests cover replacement patterns in titles, the bookmarks folder template and script, local-day history headings and one scroller check per gesture. The replacement-pattern and gesture tests fail against the baseline.
- Offscreen Electron captures of all seven settings panes and six window interface states (expanded, collapsed, right panel, active-only toolbar, hidden sidebar, emulated device) match the baseline pixel for pixel. The only difference, 164 pixels in one state after a panel animation, also appears between two baseline runs.
- The startup and title scenarios of `npm run bench` complete with the new layout: startup restores 50 tabs with one live, and the window is shown by the interface's first layout rather than the fallback timer.

## Remaining findings

- **Scroll-blocking wheel listener.** `page-preload.ts` registers a non-passive `wheel` listener on every page so that Control + wheel can zoom instead of scrolling. Chromium then waits for the page's main thread before it starts each wheel scroll, so scrolling a busy page starts later than in Chrome. Installing that listener only while Control is held would restore threaded scrolling; trackpad pinches and pages without keyboard focus need testing with real input devices first.
- **Full-state IPC.** Each push still copies every tab across the context bridge. An incremental protocol would remove most of the remaining cost for hundreds of tabs; it needs versioning and recovery after a renderer reload.
- **Main-thread imports.** History import queries SQLite synchronously. Moving it and extension extraction to a worker would remove both blocks.
- **TypeScript 7.** The native compiler is released, but `typescript-eslint` and `svelte-check` still require TypeScript below 6.1. Builds already take about a second, so the switch can wait for those tools.
- **Dependencies.** Electron 44.5.1, Vite 8.3.2, ESLint 10.12, typescript-eslint 8.71 and tldts 7.4.16 are available within the current version ranges; Dependabot covers them.

## Reproduction

From `apps/browser` after `npm run build`:

```bash
node scripts/bench-internal-pages.mjs --out /tmp/pages-after.json
node scripts/bench-interface.mjs --tabs 500 --out /tmp/interface-after.json
node scripts/bench-tab-snapshots.mjs
node scripts/bench-backend.mjs
```

For comparisons, preserve the baseline's `dist/` with its dependencies resolvable and pass `--module-dir /path/to/baseline/dist/main` or `--renderer-dir /path/to/baseline/dist/renderer`.
