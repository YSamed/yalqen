# Benchmarks

> **Status: methodology only, results pending.** Nothing below is a measurement yet. Numbers will be added after the first full run, including the ones where Yalqen loses.

## What is measured

| Metric                    | How                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| Memory with 10/20/40 tabs | Sum of `phys_footprint` over the browser's whole process tree, after the tabs settle for 60 seconds |
| Idle CPU time             | CPU seconds used by the process tree during a 5-minute idle window with 20 tabs open (energy proxy) |
| Energy (optional)         | `sudo powermetrics --samplers tasks --show-process-energy` over the same idle window                |

`phys_footprint` is what Activity Monitor shows as "Memory". It is used instead of RSS because RSS counts shared pages once per process and overstates multi-process browsers.

## Browsers

Yalqen (latest release, packaged app), Google Chrome, Safari, and Arc when installed. Every browser starts from a fresh profile with no extensions, default settings, and the same page list ([`bench/pages.txt`](../bench/pages.txt)), repeated until the tab count is reached.

Yalqen blocks ads by default and the others do not. Runs are reported both ways for Yalqen (ad blocking on and off), so the comparison is fair.

## Environment

Recorded with every run: Mac model, chip, RAM, macOS version, and each browser's exact version.

<!-- TODO: fill after the run -->

## Results

<!-- TODO: fill after the run — median of 3 runs per cell, with min–max. -->

## Yalqen's own harness

`npm run bench` in `apps/browser` measures Yalqen alone: startup timings, per-page load and memory, and idle cost, with ad blocking on and off. See `npm run bench -- --help` for options. It is used to catch regressions between Yalqen versions, not to compare browsers.

## Reproducing

<!-- TODO: exact commands once the comparison script lands. -->
