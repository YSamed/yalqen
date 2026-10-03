# Runtime resource audit — 2026-10-02

Baseline: `0824524` (Yalqen 0.2.21). This pass covers history import, tab lifecycle, translation requests, extension downloads and cookie classification. Renderer markup, styles, assets and design are unchanged.

## Findings and changes

| Area                                | Finding                                                                                                                                                 | Result                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chromium and Firefox history import | SQLite materialized every source row, then the parser allocated and sorted all valid visits before retaining 5,000.                                     | Iterate SQLite rows directly and retain at most 5,000 candidates in a heap. Sort only retained visits, preserving newest-first order and stable timestamp ties. Skip URL parsing for rows that cannot enter the result. |
| Tab disposal                        | Discarded views retained their listener disposal closure; events during close could still mutate tab state.                                             | Detach native and debugger listeners before closing the view and release the closure.                                                                                                                                   |
| Renderer crashes                    | A deferred crash callback could destroy a replacement view or a tab moved to another window.                                                            | Check both view identity and ownership before processing the deferred callback.                                                                                                                                         |
| Window disposal                     | An address-bar preconnect timer could run after its window closed.                                                                                      | Cancel pending preconnects as part of window cleanup.                                                                                                                                                                   |
| Translation                         | Repeated labels were sent repeatedly; cancellation or one worker failing did not stop other workers' fallback requests.                                 | Translate identical text once per run, map results to every original position, and stop retries and queued chunks after cancellation or failure.                                                                        |
| Extension downloads                 | The 128 MiB limit was checked only after the entire response had been buffered.                                                                         | Count bytes while streaming, reject and cancel oversized responses, and release the reader on completion or failure.                                                                                                    |
| Third-party cookies                 | Hosted tenants on private public suffixes were classified as the same site; a redirected request could retain tracking from an earlier third-party hop. | Use the PSL's private section and reset request tracking on each hop.                                                                                                                                                   |

The history source is still copied before opening SQLite. Existing malformed-row handling, Chromium journal recovery, Firefox WAL recovery and bookmark import behavior remain covered by tests. Retention is bounded during history selection, but SQLite still scans the source and the temporary copy still occupies disk space. Very large imports can still occupy the main thread; moving import processing to a worker needs a separate lifecycle design.

Translation deduplication is scoped to one page or selection. It does not retain page text across runs. Up to four requests already in flight can finish after cancellation or a failure; no subsequent chunks or fallback requests are started.

Valid extension packages are still buffered for ZIP extraction. Concatenation can temporarily retain both chunks and the final buffer, roughly twice the 128 MiB payload limit. The change bounds accepted payload buffering and stops oversized downloads; it does not make valid downloads constant-memory operations.

## Measurements

The history harness uses synthetic SQLite files and includes the temporary database copy and history parsing, with one warm-up and seven measured samples. Both builds use the same Node 22.23.3 runtime, source rows and harness. SHA-256 checksums of retained visits match for both fixture sizes.

| Operation                             |          Before |           After |
| ------------------------------------- | --------------: | --------------: |
| Import 5,000 SQLite rows, median ms   |     4.483–4.884 |     7.589–8.280 |
| Import 250,000 SQLite rows, median ms | 284.528–308.213 | 200.264–204.019 |
| Parse 5,000 in-memory rows, median ms |     1.339–1.451 |     1.581–1.665 |
| Benchmark process peak RSS, MiB       | 289.016–289.328 | 119.828–120.141 |

The table spans two sequential before/after pairs, reversing build order in the second pair. The large fixture is about 1.42–1.51× faster and peak benchmark RSS is about 58% lower. Small imports add a few milliseconds of iterator and bookkeeping overhead. Peak RSS includes synthetic fixture preparation and the whole benchmark process; it is not a per-import allocation measurement or whole-browser memory claim. These results do not establish lower startup latency, idle CPU or battery use.

A deterministic translation fixture containing 120 alternating `One`/`Two` labels produces identical 120 mapped translations. Successful batched requests fall from three to one, and submitted text from 477 to seven characters. This measures request volume, not a live translation service's latency.

## Validation

- `npm run check`: ESLint, formatting, TypeScript/Svelte checks and all 339 tests pass; the baseline had 322 tests.
- `npm run build`: main process, sandboxed preloads and production renderer build successfully.
- Four tab lifecycle regressions fail against the baseline and pass after the fix.
- A native Electron 44.4.5 smoke test with a temporary profile opens two local pages, discards the inactive tab, recreates it with its saved title/history, closes it and destroys the remaining views. Native and debugger listeners are released before close.
- The existing whole-application harness completes startup and title-churn scenarios before and after the changes, using ad blocking off, 5,000 seeded visits and temporary profiles. Startup restores 50 tabs with only one initially live. One run per scenario is a regression smoke check, not evidence of whole-browser performance gains.
- The existing backend operation harness produces the same result checksum (`23893350`) before and after the changes.
- Regression coverage includes streamed history ordering and ties at the cap, translation duplicate mapping and cancellation/failure, unknown or understated extension response lengths, stream errors, private PSL tenants and redirected cookie requests.

## Reproduction

From `apps/browser` after building:

```bash
node --expose-gc scripts/bench-history-import.mjs --out /tmp/history-import-after.json
node --expose-gc scripts/bench-history-import.mjs --module-dir /path/to/baseline/dist/main --out /tmp/history-import-before.json
```

Preserve the baseline's `dist/main` and `dist/shared` together with its dependencies resolvable. Run before and after sequentially with the same runtime and harness. The benchmark generates temporary fixtures and deletes them when finished; it does not open real user history databases.

## Remaining audit findings

- Initial navigation still does not await ad-block filter readiness. Awaiting an uncached network download at startup could introduce an unbounded startup delay, so a bounded initialization strategy needs separate work.
- Download history currently truncates its list at 200 entries, which can evict an older active download from the list. Retaining every active item while capping finished history needs a separate store policy change.
