# Benchmarks

> **Status: preliminary, one run.** The numbers below come from a single complete run on 2026-09-30. A second run was stopped after its first two measurements; both landed within 4% of the first run's memory numbers. Rerun with the default three runs before quoting these as final.

## Results

Memory is the sum of `phys_footprint` over the browser's whole process tree, 60 seconds after the tabs were opened. Idle CPU is the CPU time the process tree used during the following 120 seconds with nobody touching it.

### Memory

| Tabs | Yalqen, ad blocking on | Yalqen, ad blocking off | Chrome  |
| ---- | ---------------------- | ----------------------- | ------- |
| 10   | 920 MB                 | 1057 MB                 | 1583 MB |
| 20   | 1548 MB                | 1796 MB                 | 2819 MB |
| 40   | 2802 MB                | 3237 MB                 | 5312 MB |

### Idle CPU

| Tabs | Yalqen, ad blocking on | Yalqen, ad blocking off | Chrome |
| ---- | ---------------------- | ----------------------- | ------ |
| 10   | 1.9 s                  | 1.9 s                   | 17.6 s |
| 20   | 2.1 s                  | 3.4 s                   | 19.3 s |
| 40   | 4.5 s                  | 4.1 s                   | 26.1 s |

Second run, 10 tabs: Yalqen with ad blocking 887 MB / 2.8 s, without 1023 MB / 4.3 s.

### Reading the numbers

- **Memory:** with the same pages, Yalqen used 53–58% of Chrome's memory with ad blocking on, and 61–67% with it off. Ad blocking alone saved 13–14%, because blocked ads and trackers never load.
- **Idle CPU: treat with caution.** Chrome's idle CPU is 5–9 times Yalqen's, which is larger than expected. The Chrome profile had only been opened once, for 60 seconds, before the measurements; background work that a long-used profile has finished (component updates, indexing, model downloads) probably still ran. Do not quote this ratio until it is confirmed with a profile that has been in use for a while.
- **Process count:** at 40 tabs Yalqen ran 43–47 processes and Chrome 49, so the difference is not simply fewer processes.

### Where Yalqen may be worse, or where this says nothing

- **Not measured:** page load speed, startup time, scrolling and rendering performance (Speedometer, JetStream, MotionMark), battery drain with `powermetrics`, and long sessions. Nothing here shows Yalqen is faster.
- **Safari is not included.** Safari's web content processes are XPC services shared with other WebKit apps, not children of Safari, so their memory cannot be attributed to Safari reliably. Safari also cannot run with a separate profile, so measuring it would mix into the user's own session.
- **Arc is not included:** it was not installed on the test machine.
- **Yalqen's interface is a web page.** It is a fixed cost of roughly 120 MB (see [why-electron.md](decisions/why-electron.md)) that a native browser does not pay; it shows most with few tabs.
- **Bench mode differs slightly from normal use.** Yalqen runs with its benchmark switch, which keeps occluded windows painting (this can only raise Yalqen's CPU) and turns off the update check.
- **Live pages.** The pages are real sites (`apps/browser/bench/pages.txt`), repeated to reach the tab count. Their content, ads and experiments change between runs, and some (Google Docs, X) redirect to a sign-in page.

## Environment

| Item   | Value                                   |
| ------ | --------------------------------------- |
| Mac    | Mac16,12 (MacBook Air), Apple M4, 16 GB |
| macOS  | 27.0                                    |
| Yalqen | 0.2.11 (packaged, from /Applications)   |
| Chrome | 154.0.8037.58                           |
| Date   | 2026-09-30                              |

## Method

- Each browser runs as its own instance with a temporary profile, so the user's own Yalqen and Chrome keep running untouched.
- Yalqen starts with a fresh profile with the welcome screen completed and the ad blocking engine cache in place. Chrome starts from a copy of a profile that was opened once for 60 seconds, so its first-run component downloads are not counted, and runs with `--no-first-run --no-default-browser-check` and otherwise default settings.
- All tabs are passed on the command line at launch, so every browser opens and loads the same URLs in the same order.
- After 60 seconds the process tree is collected (the browser process and its descendants) and `footprint` sums `phys_footprint` for it. This is what Activity Monitor shows as "Memory"; RSS is not used because it counts shared pages once per process.
- CPU time comes from `ps` for the same tree at the start and end of the idle window.
- The browser is then quit with `SIGTERM` and its profile deleted.

## Reproducing

From `apps/browser`, with Yalqen installed in `/Applications`:

```bash
node scripts/bench-browsers.mjs
```

Defaults: 10, 20 and 40 tabs, 3 runs, 60 seconds to settle, 120 seconds of idle sampling (about 90 minutes in total). `--help` lists the options. Records are appended to `apps/browser/bench/results/browsers-<date>.jsonl` and a summary with medians and ranges is printed at the end. Browser windows open and close during the run; keep the Mac otherwise idle.

## Yalqen's own harness

`npm run bench` in `apps/browser` measures Yalqen alone: startup timings, per-page load and memory, and idle cost, with ad blocking on and off. See `npm run bench -- --help`. It catches regressions between Yalqen versions; it does not compare browsers.
