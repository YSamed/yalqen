import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { app, powerSaveBlocker, type WebContents } from 'electron';
import { roundMs, type Bench } from './bench.js';
import { ERR_ABORTED } from './error-page.js';
import { processUsage } from './process-metrics.js';
import type { YalqenWindow } from './window.js';

const LOAD_TIMEOUT_MS = 30_000;
const SETTLE_MS = 2_000;
const PAINT_TIMEOUT_MS = 5_000;
const COMMAND_BAR_GAP_MS = 500;
const TIMING_WORLD_ID = 1002;
const NAVIGATION_TIMING_SCRIPT = `(() => {
  const navigation = performance.getEntriesByType('navigation')[0];
  const paint = performance.getEntriesByName('first-contentful-paint')[0];
  if (!navigation) return null;
  return {
    redirectMs: navigation.redirectEnd - navigation.redirectStart,
    fetchStartMs: navigation.fetchStart,
    dnsMs: navigation.domainLookupEnd - navigation.domainLookupStart,
    connectMs: navigation.connectEnd - navigation.connectStart,
    requestStartMs: navigation.requestStart,
    serverWaitMs: navigation.responseStart - navigation.requestStart,
    ttfbMs: navigation.responseStart,
    domContentLoadedMs: navigation.domContentLoadedEventEnd,
    loadEventMs: navigation.loadEventEnd,
    fcpMs: paint ? paint.startTime : null,
  };
})()`;

type LoadOutcome = 'loaded' | 'failed' | 'timeout';

export interface BenchPlan {
  urls: string[];
  commandBar: boolean;
  idleMs: number;
  quitWhenDone: boolean;
}

export interface BenchHost {
  window(): YalqenWindow | null;
  adBlockerReady(): Promise<void>;
  commandBarPainted(): Promise<void>;
  closeCommandBar(window: YalqenWindow): void;
}

export function benchPlanFromEnv(env: NodeJS.ProcessEnv): BenchPlan {
  let urls: unknown = [];
  try {
    urls = JSON.parse(env.YALQEN_BENCH_URLS ?? '[]');
  } catch {}
  const idleMs = Number(env.YALQEN_BENCH_IDLE_MS);
  return {
    urls: Array.isArray(urls) ? urls.filter((url): url is string => typeof url === 'string') : [],
    commandBar: env.YALQEN_BENCH_COMMAND_BAR === '1',
    idleMs: Number.isFinite(idleMs) && idleMs > 0 ? idleMs : 0,
    quitWhenDone: Boolean(env.YALQEN_BENCH_SCENARIO),
  };
}

// Occluded windows stop painting and lose priority, which would skew timings while the user works elsewhere.
export function prepareBenchApp(): void {
  app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
}

function waitForLoad(contents: WebContents, timeoutMs = LOAD_TIMEOUT_MS): Promise<LoadOutcome> {
  return new Promise((resolve) => {
    const finish = (outcome: LoadOutcome) => {
      clearTimeout(timer);
      contents.off('did-finish-load', loaded);
      contents.off('did-fail-load', failed);
      resolve(outcome);
    };
    const loaded = () => finish('loaded');
    const failed = (_event: Electron.Event, code: number, _description: string, _url: string, isMainFrame: boolean) => {
      if (isMainFrame && code !== ERR_ABORTED) finish('failed');
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    contents.on('did-finish-load', loaded);
    contents.on('did-fail-load', failed);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | 'timeout'> {
  return Promise.race([promise, delay(timeoutMs, 'timeout' as const)]);
}

async function navigationTiming(contents: WebContents): Promise<Record<string, number | null>> {
  if (contents.isDestroyed()) return {};
  const timing: unknown = await contents
    .executeJavaScriptInIsolatedWorld(TIMING_WORLD_ID, [{ code: NAVIGATION_TIMING_SCRIPT }])
    .catch(() => null);
  if (!timing || typeof timing !== 'object') return {};
  return Object.fromEntries(
    Object.entries(timing).map(([key, value]) => [key, typeof value === 'number' ? roundMs(value) : null]),
  );
}

function memorySnapshot(): { totalMB: number; groupsMB: Record<string, number> } {
  const usage = processUsage();
  return {
    totalMB: usage.totalMB,
    groupsMB: Object.fromEntries(usage.groups.map((group) => [group.kind, group.memoryMB])),
  };
}

function processMemoryMB(pid: number): number | null {
  const metric = app.getAppMetrics().find((item) => item.pid === pid);
  return metric ? Math.round(metric.memory.workingSetSize / 1024) : null;
}

function cpuSeconds(): Map<number, number> {
  return new Map(app.getAppMetrics().map((metric) => [metric.pid, metric.cpu.cumulativeCPUUsage ?? 0]));
}

function resetWindow(bench: Bench): void {
  bench.takeLoopDelay();
  bench.takeWrites();
}

async function measureStartup(bench: Bench, window: YalqenWindow, host: BenchHost): Promise<void> {
  const uiLoaded = new Promise<void>((resolve) => window.uiContents.once('did-finish-load', () => resolve())).then(() =>
    bench.mark('ui-loaded'),
  );
  const shown = new Promise<void>((resolve) => window.window.once('show', () => resolve())).then(() =>
    bench.mark('window-shown'),
  );
  const first = window.tabs.activeContents();
  const outcome = first ? await waitForLoad(first) : 'failed';
  bench.mark('first-page-loaded', { outcome, url: first && !first.isDestroyed() ? first.getURL() : null });
  await withTimeout(Promise.all([uiLoaded, shown]), LOAD_TIMEOUT_MS);
  const loopDelay = bench.takeLoopDelay();
  const writes = bench.takeWrites();
  await host.adBlockerReady();
  await delay(SETTLE_MS);
  bench.record('startup-settled', {
    loopDelay,
    writes,
    tabs: window.tabs.count,
    liveTabs: window.tabs.liveCount,
    memory: memorySnapshot(),
  });
}

async function measurePage(bench: Bench, window: YalqenWindow, url: string): Promise<void> {
  resetWindow(bench);
  const started = performance.now();
  window.tabs.open(url);
  const contents = window.tabs.activeContents();
  if (!contents) return;
  const outcome = await waitForLoad(contents);
  const loadMs = roundMs(performance.now() - started);
  const loopDelay = bench.takeLoopDelay();
  const timing = await navigationTiming(contents);
  await delay(SETTLE_MS);
  bench.record('page-load', {
    url,
    finalUrl: contents.isDestroyed() ? null : contents.getURL(),
    outcome,
    loadMs,
    ...timing,
    loopDelay,
    tabMemoryMB: contents.isDestroyed() ? null : processMemoryMB(contents.getOSProcessId()),
    memory: memorySnapshot(),
  });
}

async function measureCommandBar(bench: Bench, window: YalqenWindow, host: BenchHost): Promise<void> {
  for (const phase of ['cold', 'warm'] as const) {
    const started = performance.now();
    window.openAddress();
    const painted = await withTimeout(host.commandBarPainted(), PAINT_TIMEOUT_MS);
    bench.record('command-bar', {
      phase,
      outcome: painted === 'timeout' ? 'timeout' : 'painted',
      ms: roundMs(performance.now() - started),
    });
    host.closeCommandBar(window);
    await delay(COMMAND_BAR_GAP_MS);
  }
}

async function measureIdle(bench: Bench, idleMs: number): Promise<void> {
  resetWindow(bench);
  const mainBefore = process.cpuUsage();
  const before = cpuSeconds();
  await delay(idleMs);
  const main = process.cpuUsage(mainBefore);
  let allCpuSeconds = 0;
  for (const [pid, seconds] of cpuSeconds()) allCpuSeconds += seconds - (before.get(pid) ?? seconds);
  bench.record('idle', {
    durationMs: idleMs,
    loopDelay: bench.takeLoopDelay(),
    writes: bench.takeWrites(),
    mainCpuMs: roundMs((main.user + main.system) / 1000),
    allCpuMs: roundMs(allCpuSeconds * 1000),
    memory: memorySnapshot(),
  });
}

export async function runBench(bench: Bench, host: BenchHost, plan: BenchPlan): Promise<void> {
  const blocker = powerSaveBlocker.start('prevent-app-suspension');
  bench.mark('windows-opened');
  try {
    const window = host.window();
    if (!window) throw new Error('no window to measure');
    await measureStartup(bench, window, host);
    for (const [index, url] of plan.urls.entries()) {
      await measurePage(bench, window, url);
      if (index === 0 && plan.commandBar) await measureCommandBar(bench, window, host);
      const id = window.tabs.activeTabId;
      if (id && window.tabs.count > 1) window.tabs.close(id);
    }
    if (plan.idleMs > 0) await measureIdle(bench, plan.idleMs);
    bench.record('done');
  } catch (error) {
    bench.record('error', { message: String(error) });
  } finally {
    powerSaveBlocker.stop(blocker);
    if (plan.quitWhenDone) app.quit();
  }
}
