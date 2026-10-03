# Main-process preparation performance — 2026-10-01

Baseline: `b1a5774` (Yalqen 0.2.16), after the [backend](backend-performance.md) and [interface](interface-performance.md) passes. This pass focuses on repeated preparation work in the Electron main process.

## Changes

| Path                   | Change                                                                                                                                                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bookmark suggestions   | Reuse frozen title/URL snapshots and weakly cached normalized search text instead of cloning and normalizing every bookmark per keystroke. The command bar and new-tab suggestions use the same snapshots.                                              |
| Bookmark search        | Cache Turkish-normalized title/URL text, checking the original fields before reuse. Public list and lookup methods still return defensive copies.                                                                                                       |
| Bookmark folders       | Group items once for menus and page sections instead of scanning every bookmark for each folder. Folder and item order are preserved.                                                                                                                   |
| Mock request responses | Reuse Base64 bodies and parsed header edits while their source strings remain unchanged. Each response still receives fresh mutable header objects.                                                                                                     |
| Tab menus              | Request one tab's current snapshot for developer, site-info, tab and context menus. Previously these operations prepared all tab snapshots, ordering, device and zoom state.                                                                            |
| Disabled ad blocking   | Load Ghostery and its filter-engine module only when blocking is requested. Enabled loading starts synchronously before the existing cache I/O await, preserving initialization order. Filter lists, cache refresh and scriptlet scoping are preserved. |

Tab suggestion records are recreated for each input, so they retain direct normalization. The benchmark includes this production-shaped case to verify that the bookmark cache does not add overhead to tab suggestions.

The frozen bookmark snapshots contain only title and URL. Mutations invalidate them; previous snapshots remain unchanged. Weak caches release removed source objects. No user queries or query results are retained.

Encoded mock bodies have a total cache budget of 8,388,608 characters. Crossing it resets the weak cache; oversized raw bodies are prepared without retention. This bounds the added encoded-string storage even when many large rules are used. The counter can conservatively reset early after garbage collection. Header caches retain at most the configured rule data, and do not retain completed requests.

## Operation measurements

Each before/after pair uses the same fixture, harness and runtime. Repeated operations warm their inputs and report the median of seven batches. The measurements isolate preparation work; they do not include complete page rendering, network latency or IPC transfer of mock response bodies.

### Bookmarks and suggestions

Node 24.19.0, 5,000 bookmarks and history visits, 250 bookmark folders. The suggestion benchmark rotates a broad match, a host match and a miss and includes the history source. The fresh-tab fixture creates 500 new suggestion records on every input. The complete harness produces checksum `23891850` in both versions.

| Operation                             | Before, ms | After, ms |               Speedup |
| ------------------------------------- | ---------: | --------: | --------------------: |
| Bookmark search                       |   1.272060 |  0.211664 |                  6.0× |
| Bookmark suggestions                  |   3.178032 |  0.559526 |                  5.7× |
| Bookmark menu, 250 folders            |   3.991575 |  0.120916 |                 33.0× |
| Suggestions, 500 fresh tabs per input |   0.296542 |  0.294154 | Effectively unchanged |

Other existing history, request matching, tab ordering and cookie benchmarks are retained as regression checks. Small shifts between runs do not establish additional improvements. Bookmark page generation still includes a folder selector per row; the size of that HTML remains proportional to bookmarks multiplied by folders.

### Request response preparation

Node 22.23.3. The harness invokes `pausedRequestCommand` with a repeated rule and produces the same output checksum before and after. The body fixtures contain ASCII text; Unicode bodies and header edits are covered by regressions.

| Operation                  | Before, ms | After, ms |
| -------------------------- | ---------: | --------: |
| Mock response, 64 KiB body |   0.008905 |  0.000136 |
| Mock response, 1 MiB body  |   0.829070 |  0.000229 |
| Request headers, 100 edits |   0.011283 |  0.002248 |

The first request and changed rules still prepare their data. CDP still transfers the full encoded body for each response, so these timings are not full response latencies.

### Native tab queries

Electron 44.4.5, 500 tab records and 20 real live `WebContentsView` instances. Seven batches of 500 reads select the last tab. The fixture navigates a real page three times, goes back and verifies both native navigation flags and equality with the full snapshot. Both versions produce checksum `35000`.

| Operation                       | Before, ms | After, ms | Speedup |
| ------------------------------- | ---------: | --------: | ------: |
| Prepare selected tab for a menu |   0.102180 |  0.004036 |   25.3× |

The window's complete IPC state still uses full snapshots. This improvement applies to the four menu preparation paths; it does not reduce every background state push.

### Ad-block module preparation

Node 22.23.3, 15 fresh processes per build and enabled state, alternating build order, with the same serialized engine cache. Timing starts immediately before importing the controller and ends after readiness. Process launch and native Electron startup are excluded.

| State                  | Before, ms | After, ms |
| ---------------------- | ---------: | --------: |
| Disabled               |     18.304 |     2.082 |
| Enabled, cached engine |     25.772 |    25.784 |

Disabled preparation avoids evaluating 57 Ghostery module files. Enabled preparation remains effectively unchanged.

### Complete application regression check

Three repetitions of each startup/title scenario used fresh profiles, 50 restored tabs, 5,000 history visits and the same local pages, with cached ad blocking enabled and disabled. Every run completed, loaded its first page and kept only one restored tab live. Median values:

| Metric                                     | Before on / off | After on / off |
| ------------------------------------------ | --------------: | -------------: |
| Modules loaded, ms from spawn              |       128 / 126 |      116 / 117 |
| First page loaded, ms from spawn           |       332 / 318 |      319 / 311 |
| Interface loaded, ms from spawn            |       345 / 330 |      330 / 322 |
| Window shown, ms from spawn                |       538 / 517 |      527 / 497 |
| Reported total working-set memory, MB      |       653 / 646 |      654 / 644 |
| Startup idle main CPU, ms over 5 seconds   |     81.2 / 72.4 |   77.1 / 110.7 |
| Title scenario main CPU, ms over 6 seconds |   105.3 / 100.9 |  107.0 / 108.3 |
| Title scenario history / session writes    |           1 / 1 |          1 / 1 |

Startup readings moved slightly earlier, but three short sequential samples do not establish a whole-browser startup gain. Memory was effectively unchanged. Idle CPU varied, including a higher disabled-after startup sample; this pass does not claim reduced idle CPU, battery consumption or total memory. Longer paired idle profiling remains necessary for those claims. The operation benchmarks are the evidence for the preparation improvements.

## Alternatives investigated

- Deferred module loading follows Electron's [performance guidance](https://www.electronjs.org/docs/latest/tutorial/performance). The measured changes remove repeated work within the existing architecture.
- [Utility processes](https://www.electronjs.org/docs/latest/api/utility-process) or workers can move heavy filter parsing away from the main thread. This needs a separate profile of uncached startup and refresh, plus serialization and lifecycle handling; the warmed operation results here do not justify that larger change.
- Moving cookie cleanup to `onHeadersReceived` needs coordination with Ghostery: [Electron uses only the last listener attached to each web-request event](https://www.electronjs.org/docs/latest/api/web-request), and the installed blocker already handles that event.
- Incremental IPC snapshots could reduce complete-state transfer for large live tab sets. They require versioning and recovery after renderer reloads; targeted menu reads preserve the current contract.

The existing first-navigation race during asynchronous initial filter loading remains a separate correctness issue: opening initial windows does not await filter readiness. This pass preserves that behavior and adds no network wait to startup. The enabled smoke test awaits readiness before requesting test resources.

## Validation and reproduction

- `npm run check`: lint, formatting, zero TypeScript/Svelte errors or warnings, and 283 passing tests.
- `npm run build`: main, preload and production renderer build successfully.
- Regressions cover Turkish search edits, immutable suggestion snapshots, public mutation isolation, removal, folder order, request body/header changes, response mutation isolation, and targeted live/discarded/missing tab state.
- Request regressions also cover Unicode-driven cache eviction, mutations after reset and oversized body bypass.
- A temporary-profile Electron smoke tested personal and private ad-block sessions through enabled, disabled and reenabled loads. Only disabled loads reached the blocked resource; normal resources and JavaScript loaded every time. Cosmetic filtering followed the setting.

Run from `apps/browser` after building:

```bash
node scripts/bench-backend.mjs --out /tmp/backend-after.json
node scripts/bench-request-mocks.mjs --out /tmp/requests-after.json
node scripts/bench-tab-snapshots.mjs --out /tmp/tabs-after.json
node scripts/bench-adblock-module.mjs --out /tmp/adblock-after.json
```

For before/after comparisons, preserve the baseline's `dist/main` and `dist/shared` together, keeping its `node_modules` resolvable. The first three scripts accept `--module-dir /path/to/baseline/main`; the module benchmark accepts `--baseline-dir /path/to/baseline/main` for alternating paired runs. Its `--cache` must reference a valid serialized filter engine; it forbids network downloads.

The complete application regression check uses fresh profiles, 50 restored tabs, 5,000 history visits, cached ad blocking on and off, and three repetitions:

```bash
node scripts/bench.mjs --scenario startup,title --runs 3 --adblock both --idle 6000 --out /tmp/app-after.jsonl
```
