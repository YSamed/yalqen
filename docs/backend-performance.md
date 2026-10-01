# Backend performance audit — 2026-10-01

Baseline: `fafd3f7` (Yalqen 0.2.14). This pass starts with the Electron main process and includes the renderer work directly connected to its state and download updates.

## Architecture and findings

The backend is Electron's main process, rather than an HTTP server. `main.ts` owns the personal, private and developer sessions, JSON stores, permission handlers and window lifecycle. Each window has a Svelte interface and a `TabManager` managing native `WebContentsView` instances. Internal pages are served through the `yalqen://` protocol; the command bar receives local suggestions through IPC.

Several protections already work well: restored background tabs stay unloaded, history is capped at 5,000 visits, title churn stops rewriting history after five title changes, state pushes are coalesced and deduplicated, and JSON writes are debounced with a maximum wait. Those mechanisms remain in place.

| Path                       | Previous cost                                                                               | Change                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| History search             | Lowercase and concatenate every visit on every query                                        | Cache normalized text by visit, checking the title and URL before reuse                                                                                                                  |
| Suggestion index rebuild   | Normalize URLs, titles and words again after visit/title/favicon changes                    | Reuse normalized visit text and host names through weak references                                                                                                                       |
| Suggestion selection       | Collect every matching history page and sort the entire result set to return six items      | Maintain only the requested highest ranked items, preserving match quality, source priority, frequency and recency                                                                       |
| Request interception       | Escape patterns and construct a regular expression for each rule on each paused request     | Cache matchers by rule, rebuilding when its pattern changes; still check enabled state and redirect validity on every request                                                            |
| Session persistence        | Transfer all native navigation entries and then keep six on either side of the active entry | Read only the entries that will be saved, using Electron's [indexed navigation API](https://www.electronjs.org/docs/latest/api/navigation-history#navigationhistorygetentryatindexindex) |
| Opened pinned tab ordering | Repeatedly scan all tabs and copy each anchor's growing group                               | Index pins once and append to each group; the ordering pass is linear                                                                                                                    |
| Sidebar ordering           | Find each ordered tab by scanning the full tab array                                        | Build a reactive ID map once per tab array update                                                                                                                                        |
| Idle download pages        | Render and transmit the full download list on every unchanged long poll timeout             | Send only the version until the list changes; keep the initial DOM on identical updates                                                                                                  |
| Cancelled download polls   | Keep the waiter and timer until a change or timeout                                         | Release them when the protocol request's abort signal fires                                                                                                                              |

The caches use weak keys for visit and rule objects. Deleted or replaced objects are eligible for collection; query results are not kept in an unbounded cache. Title, URL and pattern edits refresh the derived data. Private suggestions continue to use the empty history index.

Session capture preserves the same trimmed entries, active index and page states as before. Discarding and reopening a tab still retain its full in-memory navigation history; only persistence reads use the bounded capture.

## Measurements

### Main-process operations

Measured locally with Node 22.23.3. The benchmark warms each operation and reports the median milliseconds per operation over seven batches, using identical fixtures and the same runtime before and after. The history fixture has 5,000 distinct URLs across 400 hosts. Search rotates through a broad match, a host match and a miss. The rule fixture matches the last of 100 active rules. Both versions produced the same result checksum.

| Operation                                     | Before, ms | After, ms | Speedup |
| --------------------------------------------- | ---------: | --------: | ------: |
| Repeated history search, 5,000 visits         |     1.3127 |    0.1666 |    7.9× |
| Index rebuild with existing visit objects     |     4.9089 |    0.5523 |    8.9× |
| Six suggestions from a broad 5,000-page match |     0.3594 |    0.0937 |    3.8× |
| Last matching request rule out of 100         |     0.0435 |    0.0018 |   24.2× |
| Ordering 500 tabs with 250 opened pins        |     0.1374 |    0.0286 |    4.8× |

A separate Electron run visited 50 local pages, moved to the middle of the native navigation history, and compared both capture methods. Across two runs, the previous method took 0.113–0.115 ms per capture; bounded capture took 0.0296–0.0299 ms, about 3.8× faster. Captured entries were deeply equal to the previous trimmed snapshot. A new browser process restored the snapshot successfully and navigated backward and forward.

These are operation timings with warm caches, not whole-browser speedup claims. First queries still build their caches, and cache data adds memory while visits remain alive. Web rendering, network latency and battery use were not measured by this microbenchmark.

### Whole-application regression check

The existing Electron harness ran three repetitions per scenario with ad blocking off, 5,000 seeded visits, 50 restored tabs for startup, and a local page changing its title every second for the title scenario. Startup idle sampling lasted 5 seconds; title idle sampling lasted 6 seconds.

| Median                                     | Before | After |
| ------------------------------------------ | -----: | ----: |
| First page loaded, ms from spawn           |    330 |   330 |
| Interface loaded, ms from spawn            |    342 |   343 |
| Window shown, ms from spawn                |    406 |   408 |
| Reported total working-set memory, MB      |    645 |   645 |
| Startup idle main CPU, ms over 5 seconds   |   55.1 |  68.9 |
| Title scenario main CPU, ms over 6 seconds |   84.2 | 102.7 |
| Title scenario history/session writes      |  1 / 1 | 1 / 1 |

Startup and memory were effectively unchanged in these runs. Idle CPU was higher in the after sample; these short windows do not establish an idle CPU improvement. A longer repeated idle measurement is needed before making a CPU or battery claim. The focused operation measurements are the evidence for this pass's gains.

## Validation

- `npm run check`: lint and formatting pass, Svelte/TypeScript report zero errors or warnings, and all 264 tests pass.
- `npm run build`: main process, preloads and renderer build successfully.
- Added regressions cover Turkish case matching after title edits, history eviction and clearing, suggestion ordering and deduplication, matcher edits/replacement, bounded navigation reads and page states, pinned tab ordering, poll cancellation, omitted unchanged HTML, and preservation of the download DOM.
- A temporary-profile Electron smoke run restored 60 tabs with only one initially live, selected a tab through its rendered button, opened a pin in the list, toggled pinning and fetched six local history suggestions. Captured interface output was inspected.
- A second process restored real captured navigation state and verified back/forward navigation. Synthetic navigation entries without real page states were excluded from that check.

## Reproducing the operation benchmark

Run from `apps/browser`:

```bash
npm run bench:backend
node scripts/bench-backend.mjs --out /tmp/yalqen-backend-after.json
```

For a before/after comparison, preserve the baseline's built `dist/main` and `dist/shared` directories together, then point the same script at the preserved main directory:

```bash
node scripts/bench-backend.mjs --module-dir /tmp/yalqen-perf-baseline/main --out /tmp/yalqen-backend-before.json
```

The Electron regression measurement used:

```bash
node scripts/bench.mjs --scenario startup,title --runs 3 --adblock off --idle 6000 --out /tmp/yalqen-perf-after.jsonl
```

## Remaining profiling priorities

The [second performance pass](interface-performance.md) measures full renderer updates, adds bounded session-scoped cookie classification caches, and checks startup with ad blocking both enabled and disabled.

1. Measure cold startup with the ad blocker enabled, separating module loading, filter deserialization and the first page. Deferred loading needs to preserve blocking on early requests.
2. Profile full state snapshots and IPC serialization during sustained events with hundreds of live tabs before considering incremental state delivery.
3. Measure long-session memory and idle CPU with repeated runs and warmed operating-system services. This pass does not claim reduced total browser memory or battery drain.
4. Profile cookie cache misses, native request overhead and diverse-host retention on real request-heavy pages.
