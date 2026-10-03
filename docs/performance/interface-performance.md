# Interface and request performance — 2026-10-01

Baseline: `0b8c978` (Yalqen 0.2.15), after the [first backend pass](backend-performance.md).

## Findings and changes

Main-process state pushes are coalesced and deduplicated, but Electron IPC still clones the entire snapshot on each push. A background title change or a download progress event therefore replaced every tab, nested setting and array in the Svelte interface. Keyed rows retained their DOM, but derived values and component inputs still changed unnecessarily.

`reuseBrowserState` now compares incoming values with the previous immutable snapshot. Unchanged tabs are reused by ID, including across reordering. Unchanged overrides, translation state, device frames, download summaries, update status and ordered arrays retain their references. Changed values are replaced; neither input is mutated. No separate long-lived cache is introduced. The active-only toolbar also derives its array from stable tab and mode signals rather than filtering on every window state change.

This fits Svelte's replacement-based [`$state.raw`](https://svelte.dev/docs/svelte/$state#state.raw) and the identity checks of [`$derived`](https://svelte.dev/docs/svelte/$derived#Update-propagation). The IPC contract and full main-process snapshots remain compatible.

Third-party cookie blocking previously parsed both the request URL and its page URL and resolved both public suffixes on every request. Its listeners now keep:

- A weak page cache keyed by `WebContents`, checked against the current URL on every request. Navigation refreshes the stored site.
- A FIFO cache of at most 256 host-to-site results, scoped to the enabled session's listeners. Request protocols are checked before looking up a host.

Disabling blocking removes the listeners and releases their caches. Separate sessions do not share data. Missing, destroyed and blank contents, internal pages, unsupported protocols, cookie stripping, response cleanup and failed-request cleanup preserve their prior behavior. Main-frame requests bypass classification.

## Measurements

### Production interface updates

Measured on macOS arm64 with Electron 44.4.5 / Chromium 152.0.7977.130. The same harness loaded the preserved baseline and current production renderer, sent complete snapshots through Electron IPC and measured the renderer callback, context bridge transfer and Svelte update microtasks. Each scenario warms 20 updates, then samples 200. The last background tab changes its title, or a download's progress changes. Final rendered title and percentage are asserted.

The window is hidden. These timings exclude main-process snapshot creation, IPC transport, layout, rasterization and presentation; they are not complete frame or page-load timings. Chromium's timer resolution is approximately 0.1 ms in these runs.

| Tabs / toolbar mode            | Scenario          | Before median, ms | After median, ms | Before p95, ms | After p95, ms |
| ------------------------------ | ----------------- | ----------------: | ---------------: | -------------: | ------------: |
| 200, all tabs; two paired runs | Background title  |           1.5–1.9 |              1.2 |        2.0–2.4 |           1.3 |
| 200, all tabs; two paired runs | Download progress |           1.5–1.6 |              1.1 |        2.0–2.2 |       1.4–1.5 |
| 500, all tabs                  | Background title  |               4.3 |              3.0 |            5.6 |           3.5 |
| 500, all tabs                  | Download progress |               4.1 |              2.9 |            5.1 |           3.7 |
| 10, all tabs                   | Background title  |               0.2 |              0.1 |            0.3 |           0.2 |
| 10, all tabs                   | Download progress |               0.2 |              0.1 |            0.2 |           0.2 |
| 200, active-only toolbar       | Background title  |               1.1 |              1.0 |            1.3 |           1.2 |
| 200, active-only toolbar       | Download progress |               1.0 |              1.0 |            1.3 |           1.1 |

The 200-tab updates took 20–37% less time, and the 500-tab updates about 30% less time. At ten tabs the readings are too close to timer resolution for a useful speedup claim. The active-only mode showed little change, so the measured benefit is strongest with a populated toolbar and sidebar.

### Cookie request listener

The backend harness invokes the actual before-headers and completion listeners, using a fixed page, 16 repeated hosts, equal first-party and third-party traffic, and an existing cookie header. Both versions produced checksum `20824434` across the full benchmark. Node 22.23.3, seven warmed batches of 20,000 requests:

| Operation                                 | Before, µs/request | After, µs/request | Speedup |
| ----------------------------------------- | -----------------: | ----------------: | ------: |
| Cookie classification and request cleanup |              0.769 |             0.377 |    2.0× |

This isolates JavaScript listener work. It does not measure native `getURL` IPC costs, network latency, real cookie storage, whole-page speed or battery use. New hosts and navigation still require classification; the cache benefit applies to repeated hosts and pages.

### Whole-application startup check

Three repetitions per ad-blocking variant used fresh profiles, 50 restored tabs, 5,000 history visits and the same local static page. The ad-block engine was cached. Every run loaded its first page, kept only one restored tab live and completed. Median timings:

| Metric                                | Before on / off | After on / off |
| ------------------------------------- | --------------: | -------------: |
| Modules loaded, ms from spawn         |       163 / 109 |      126 / 152 |
| Interface loaded, ms from spawn       |       359 / 303 |      332 / 380 |
| First page loaded, ms from spawn      |       353 / 292 |      321 / 366 |
| Window shown, ms from spawn           |       505 / 482 |      401 / 438 |
| Total reported working-set memory, MB |       654 / 647 |      654 / 644 |
| Idle main CPU, ms over 5 seconds      |     58.2 / 56.3 |    57.8 / 54.6 |
| Idle history / session writes         |           0 / 0 |          0 / 0 |

Module timing moved in opposite directions across variants even though the module-loading path was unchanged. These samples do not establish a startup, total memory, idle CPU or battery improvement. Ad-block initialization was kept intact; deferring it needs separate profiling and early-request blocking validation.

## Validation and reproduction

- `npm run check`: lint, formatting, zero Svelte/TypeScript errors or warnings, and 272 passing tests.
- `npm run build`: main process, preloads and production renderer build successfully.
- Regressions cover every snapshot field, nested changes, immutable inputs, tab insertion/removal/reordering, nullable devices and update states, cookie classification after navigation, cache eviction, separate sessions, toggling, header stripping and request cleanup.
- A temporary-profile full-application smoke restored 40 tabs with one initially live, clicked a rendered tab, checked its active DOM title, toggled mute and bookmarking, pinned it, opened and closed tabs, and opened the private profile through its rendered button. Rendered button states and the private snapshot were verified; captured chrome was inspected.

Run from `apps/browser`:

```bash
npm run bench:interface
node scripts/bench-interface.mjs --tabs 500 --out /tmp/interface-after.json
node scripts/bench-interface.mjs --active-only --out /tmp/interface-active-only.json
npm run bench:backend
node scripts/bench.mjs --scenario startup --runs 3 --adblock both --out /tmp/startup-after.jsonl
```

For comparisons, preserve the baseline's built renderer and point the same interface script at it with `--renderer-dir /path/to/baseline/renderer`. Preserve `dist/main` and `dist/shared` together for `bench-backend.mjs --module-dir /path/to/baseline/main`; its dependencies must remain resolvable from that location.

The next profiling priorities are main-process snapshot/native-query costs, IPC transfer size during sustained tab events, and repeated long-session CPU and memory measurements. Incremental state delivery needs a separate compatible protocol and recovery strategy before implementation.

The [next main-process pass](main-process-performance.md) measures bookmark and request preparation, targeted native tab reads, and disabled ad-block module loading.
