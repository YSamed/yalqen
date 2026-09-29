import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const electron = require('electron');
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(project, '../..');
const engineCache = path.join(repo, 'bench/.cache/adblock-engine.bin');
const RUN_TIMEOUT_MS = 5 * 60_000;
const TICKER_INTERVAL_MS = 1000;
const STARTUP_IDLE_MS = 5000;
const SCENARIOS = ['startup', 'pages', 'title'];
const STARTUP_MARKS = [
  'modules-loaded',
  'app-ready',
  'stores-loaded',
  'extensions-loaded',
  'windows-opened',
  'ui-loaded',
  'window-shown',
  'first-page-loaded',
];

const USAGE = `Usage: npm run bench -- [options]

  --scenario  startup | pages | title | all            (default: all)
  --runs      repetitions per scenario and variant     (default: 3)
  --adblock   on | off | both                          (default: both)
  --tabs      tabs restored by the startup scenario    (default: 50; the active one is a local static page)
  --history   visits seeded into each profile          (default: 5000)
  --idle      idle window of the title scenario, ms    (default: 15000)
  --pages     page list                                (default: bench/pages.txt)
  --out       JSONL output                             (default: bench/results/bench-<date>.jsonl)

Every run starts from a fresh temporary profile; the ad blocking engine is cached in bench/.cache.`;

function options() {
  const { values } = parseArgs({
    options: {
      scenario: { type: 'string', default: 'all' },
      runs: { type: 'string', default: '3' },
      adblock: { type: 'string', default: 'both' },
      tabs: { type: 'string', default: '50' },
      history: { type: 'string', default: '5000' },
      idle: { type: 'string', default: '15000' },
      pages: { type: 'string', default: path.join(repo, 'bench/pages.txt') },
      out: {
        type: 'string',
        default: path.join(repo, `bench/results/bench-${new Date().toISOString().slice(0, 10)}.jsonl`),
      },
      help: { type: 'boolean', default: false },
    },
  });
  const count = (name) => {
    const value = Number(values[name]);
    if (!Number.isInteger(value) || value < 0) throw new Error(`--${name} must be a non-negative integer`);
    return value;
  };
  const scenarios = values.scenario === 'all' ? SCENARIOS : values.scenario.split(',');
  for (const scenario of scenarios) {
    if (!SCENARIOS.includes(scenario)) throw new Error(`unknown scenario: ${scenario}`);
  }
  const variants = { on: [true], off: [false], both: [true, false] }[values.adblock];
  if (!variants) throw new Error('--adblock must be on, off or both');
  const pages = fs
    .readFileSync(path.resolve(values.pages), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  return {
    help: values.help,
    scenarios,
    variants,
    runs: Math.max(1, count('runs')),
    tabs: count('tabs'),
    history: count('history'),
    idleMs: count('idle'),
    pages,
    out: path.resolve(values.out),
  };
}

function seedHistory(count, now = Date.now()) {
  return Array.from({ length: count }, (_, index) => {
    const site = index % 400;
    return {
      id: randomUUID(),
      url: `https://site${site}.example/articles/${index}`,
      title: `Article ${index} – Site ${site}`,
      visitedAt: now - index * 60_000,
      faviconUrl: `https://site${site}.example/favicon.ico`,
    };
  });
}

function seedSession(urls) {
  const tabs = urls.map((url) => ({
    id: randomUUID(),
    url,
    title: url,
    faviconUrl: null,
    pinnedUrl: null,
    history: null,
  }));
  return { version: 2, windows: [{ activeTabId: tabs[0]?.id ?? null, tabs }] };
}

function writeProfile(profile, { adBlocking, history, sessionUrls }) {
  const write = (name, data) => fs.writeFileSync(path.join(profile, name), JSON.stringify(data));
  write('settings.json', { version: 1, adBlocking, welcomeCompleted: true, startupBehavior: 'restore' });
  write('history.json', seedHistory(history));
  if (sessionUrls.length > 0) write('tabs.json', seedSession(sessionUrls));
  if (adBlocking && fs.existsSync(engineCache)) fs.copyFileSync(engineCache, path.join(profile, 'adblock-engine.bin'));
}

function launch(env) {
  return new Promise((resolve) => {
    const output = [];
    const child = spawn(electron, [project], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, ...env, YALQEN_BENCH_SPAWNED_AT: String(Date.now()) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const keep = (chunk) => output.push(...chunk.toString().split('\n').filter(Boolean));
    child.stdout.on('data', keep);
    child.stderr.on('data', keep);
    const timer = setTimeout(() => child.kill('SIGKILL'), RUN_TIMEOUT_MS);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, output: output.slice(-40) });
    });
  });
}

function readRecords(file, session) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((record) => record.session === session);
}

async function run({ out, session, scenario, variant, runIndex, adBlocking, history, sessionUrls, plan }) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-bench-'));
  try {
    writeProfile(profile, { adBlocking, history, sessionUrls });
    const result = await launch({
      YALQEN_BENCH: out,
      YALQEN_BENCH_PROFILE: profile,
      YALQEN_BENCH_SESSION: session,
      YALQEN_BENCH_SCENARIO: scenario,
      YALQEN_BENCH_VARIANT: variant,
      YALQEN_BENCH_RUN: String(runIndex),
      YALQEN_BENCH_URLS: JSON.stringify(plan.urls ?? []),
      YALQEN_BENCH_IDLE_MS: String(plan.idleMs ?? 0),
      YALQEN_BENCH_COMMAND_BAR: plan.commandBar ? '1' : '0',
    });
    const engine = path.join(profile, 'adblock-engine.bin');
    if (adBlocking && !fs.existsSync(engineCache) && fs.existsSync(engine)) {
      fs.mkdirSync(path.dirname(engineCache), { recursive: true });
      fs.copyFileSync(engine, engineCache);
    }
    const records = readRecords(out, session).filter(
      (record) => record.scenario === scenario && record.variant === variant && record.run === runIndex,
    );
    const failure = records.find((record) => record.event === 'error');
    if (failure || !records.some((record) => record.event === 'done')) {
      console.warn(`  ${scenario} ${variant} #${runIndex} did not finish (exit ${result.code ?? result.signal})`);
      if (failure) console.warn(`  ${failure.message}`);
      for (const line of result.output) console.warn(`    ${line}`);
    }
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

// Startup and idle numbers come from local pages, so network latency and page animations
// (example.com cycles its text) stay out of them.
const LOCAL_PAGES = {
  '/static': '<!doctype html><meta charset="utf-8"><title>Yalqen bench</title><p>A static page without scripts.</p>',
  '/ticker': `<!doctype html><meta charset="utf-8"><title>Sayaç 0</title><p>Yalqen bench</p>
<script>let n = 0; setInterval(() => { document.title = 'Sayaç ' + ++n; }, ${TICKER_INTERVAL_MS});</script>`,
};

function startLocalServer() {
  const server = http.createServer((request, response) => {
    const page = LOCAL_PAGES[new URL(request.url, 'http://localhost').pathname];
    response.writeHead(page ? 200 : 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(page ?? '');
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function median(values) {
  const sorted = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function format(value) {
  if (value === null || value === undefined) return '–';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function printTable(title, header, rows) {
  if (rows.length === 0) return;
  const table = [header, ...rows.map(([label, ...cells]) => [label, ...cells.map(format)])];
  const widths = header.map((_, column) => Math.max(...table.map((row) => String(row[column]).length)));
  console.log(`\n${title}`);
  for (const [index, row] of table.entries()) {
    console.log(
      row.map((cell, column) => String(cell)[column === 0 ? 'padEnd' : 'padStart'](widths[column])).join('   '),
    );
    if (index === 0) console.log(widths.map((width) => '-'.repeat(width)).join('   '));
  }
}

function hostOf(url) {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function summarize(records, variants, scenarios) {
  const pick = (scenario, event) => (variant) =>
    records.filter((record) => record.scenario === scenario && record.event === event && record.variant === variant);
  const column = (select, value) => variants.map((variant) => median(select(variant).map(value)));
  const header = ['', ...variants];
  const writeRows = (select, labels) =>
    labels.flatMap((label) => [
      [`${label} writes`, ...column(select, (record) => record.writes?.[label]?.count ?? 0)],
      [`${label} KB written`, ...column(select, (record) => (record.writes?.[label]?.bytes ?? 0) / 1024)],
      [`${label} serialize ms`, ...column(select, (record) => record.writes?.[label]?.serializeMs ?? 0)],
    ]);

  const startupIdle = pick('startup', 'idle');
  if (scenarios.includes('startup')) {
    printTable('startup: ms since spawn (median)', header, [
      ...STARTUP_MARKS.map((mark) => [mark, ...column(pick('startup', mark), (record) => record.sinceSpawnMs)]),
      ['memory total MB', ...column(pick('startup', 'startup-settled'), (record) => record.memory?.totalMB)],
      ['startup loop p99 ms', ...column(pick('startup', 'startup-settled'), (record) => record.loopDelay?.p99Ms)],
      ['idle main CPU ms', ...column(startupIdle, (record) => record.mainCpuMs)],
      ['idle all CPU ms', ...column(startupIdle, (record) => record.allCpuMs)],
      ['idle loop max ms', ...column(startupIdle, (record) => record.loopDelay?.maxMs)],
      ...writeRows(startupIdle, ['session', 'history']),
    ]);
  }

  if (scenarios.includes('pages')) summarizePages(records, variants, pick, column, header);
  if (scenarios.includes('title')) summarizeTitle(pick('title', 'idle'), column, header, writeRows);
}

function summarizePages(records, variants, pick, column, header) {
  const pageLoads = pick('pages', 'page-load');
  const urls = [...new Set(records.filter((record) => record.event === 'page-load').map((record) => record.url))];
  const metrics = [
    ['load', (record) => record.loadMs],
    ['fcp', (record) => record.fcpMs],
    ['tab MB', (record) => record.tabMemoryMB],
    ['loop p99', (record) => record.loopDelay?.p99Ms],
  ];
  printTable(
    'pages: median per page (ms unless noted)',
    ['', ...metrics.flatMap(([name]) => variants.map((variant) => `${name} ${variant}`))],
    [
      ...urls.map((url) => [
        hostOf(url),
        ...metrics.flatMap(([, value]) =>
          column((variant) => pageLoads(variant).filter((record) => record.url === url), value),
        ),
      ]),
      ['all pages', ...metrics.flatMap(([, value]) => column(pageLoads, value))],
    ],
  );
  printTable(
    'command bar: open to painted frame, ms (median)',
    header,
    ['cold', 'warm'].map((phase) => [
      phase,
      ...column(
        (variant) => pick('pages', 'command-bar')(variant).filter((record) => record.phase === phase),
        (record) => record.ms,
      ),
    ]),
  );
}

function summarizeTitle(titleIdle, column, header, writeRows) {
  printTable(`title: page retitling itself every ${TICKER_INTERVAL_MS} ms (median per idle window)`, header, [
    ['window ms', ...column(titleIdle, (record) => record.durationMs)],
    ...writeRows(titleIdle, ['history', 'session']),
    ['loop p99 ms', ...column(titleIdle, (record) => record.loopDelay?.p99Ms)],
    ['loop max ms', ...column(titleIdle, (record) => record.loopDelay?.maxMs)],
    ['main CPU ms', ...column(titleIdle, (record) => record.mainCpuMs)],
    ['all CPU ms', ...column(titleIdle, (record) => record.allCpuMs)],
  ]);
}

async function main() {
  const settings = options();
  if (settings.help) {
    console.log(USAGE);
    return;
  }
  fs.mkdirSync(path.dirname(settings.out), { recursive: true });
  const session = `${new Date().toISOString()}-${randomUUID().slice(0, 8)}`;
  const variantName = (adBlocking) => (adBlocking ? 'adblock-on' : 'adblock-off');

  if (settings.variants.includes(true) && !fs.existsSync(engineCache)) {
    console.log('Priming the ad blocking engine cache (downloads the filter lists once)…');
    const prime = path.join(os.tmpdir(), `yalqen-bench-prime-${process.pid}.jsonl`);
    await run({
      out: prime,
      session,
      scenario: 'prime',
      variant: 'adblock-on',
      runIndex: 0,
      adBlocking: true,
      history: 0,
      sessionUrls: [],
      plan: {},
    });
    fs.rmSync(prime, { force: true });
  }

  const server = await startLocalServer();
  const local = (pathname) => `http://127.0.0.1:${server.address().port}${pathname}`;
  const plans = {
    startup: {
      sessionUrls: Array.from({ length: settings.tabs }, (_, i) =>
        i === 0 ? local('/static') : settings.pages[i % settings.pages.length],
      ),
      plan: { idleMs: STARTUP_IDLE_MS },
    },
    pages: { sessionUrls: [], plan: { urls: settings.pages, commandBar: true } },
    title: { sessionUrls: [local('/ticker')], plan: { idleMs: settings.idleMs } },
  };
  try {
    for (const scenario of settings.scenarios) {
      for (let runIndex = 1; runIndex <= settings.runs; runIndex++) {
        for (const adBlocking of settings.variants) {
          const variant = variantName(adBlocking);
          console.log(`${scenario} ${variant} run ${runIndex}/${settings.runs}`);
          await run({
            out: settings.out,
            session,
            scenario,
            variant,
            runIndex,
            adBlocking,
            history: settings.history,
            ...plans[scenario],
          });
        }
      }
    }
  } finally {
    server.close();
  }

  summarize(readRecords(settings.out, session), settings.variants.map(variantName), settings.scenarios);
  console.log(`\nRecords: ${settings.out} (session ${session})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
