import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineCache = path.join(project, 'bench/.cache/adblock-engine.bin');
const QUIT_TIMEOUT_MS = 15_000;

const BROWSERS = {
  'yalqen-adblock-on': {
    app: '/Applications/Yalqen.app',
    binary: 'Contents/MacOS/Yalqen',
    kind: 'yalqen',
    adBlocking: true,
  },
  'yalqen-adblock-off': {
    app: '/Applications/Yalqen.app',
    binary: 'Contents/MacOS/Yalqen',
    kind: 'yalqen',
    adBlocking: false,
  },
  chrome: { app: '/Applications/Google Chrome.app', binary: 'Contents/MacOS/Google Chrome', kind: 'chromium' },
};

const USAGE = `Usage: node scripts/bench-browsers.mjs [options]

Compares installed browsers from fresh profiles: memory (sum of phys_footprint over the
browser's process tree) after N tabs settle, and CPU time while idle.

  --browsers  ${Object.keys(BROWSERS).join(', ')}   (default: all installed)
  --tabs      tab counts                                   (default: 10,20,40)
  --runs      repetitions per browser and tab count       (default: 3)
  --settle    seconds to wait after opening the tabs      (default: 60)
  --idle      seconds of idle CPU sampling after settling (default: 120)
  --pages     page list, repeated up to the tab count     (default: bench/pages.txt)
  --out       JSONL output (default: bench/results/browsers-<date>.jsonl)

Close nothing of your own: each browser runs as a separate instance with a temporary profile.`;

function options() {
  const { values } = parseArgs({
    options: {
      browsers: { type: 'string' },
      tabs: { type: 'string', default: '10,20,40' },
      runs: { type: 'string', default: '3' },
      settle: { type: 'string', default: '60' },
      idle: { type: 'string', default: '120' },
      pages: { type: 'string', default: path.join(project, 'bench/pages.txt') },
      out: {
        type: 'string',
        default: path.join(project, `bench/results/browsers-${new Date().toISOString().slice(0, 10)}.jsonl`),
      },
      help: { type: 'boolean', default: false },
    },
  });
  const count = (value, name) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) throw new Error(`--${name} must be a non-negative integer`);
    return number;
  };
  const installed = Object.keys(BROWSERS).filter((name) => fs.existsSync(BROWSERS[name].app));
  const browsers = values.browsers ? values.browsers.split(',') : installed;
  for (const name of browsers) {
    if (!BROWSERS[name]) throw new Error(`unknown browser: ${name}`);
    if (!installed.includes(name)) throw new Error(`not installed: ${BROWSERS[name].app}`);
  }
  const pages = fs
    .readFileSync(path.resolve(values.pages), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
  return {
    help: values.help,
    browsers,
    tabCounts: values.tabs.split(',').map((value) => count(value, 'tabs')),
    runs: count(values.runs, 'runs'),
    settleMs: count(values.settle, 'settle') * 1000,
    idleMs: count(values.idle, 'idle') * 1000,
    pages,
    out: path.resolve(values.out),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function plistValue(app, key) {
  try {
    return execFileSync('defaults', ['read', path.join(app, 'Contents/Info.plist'), key], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function environment() {
  const sysctl = (name) => execFileSync('sysctl', ['-n', name], { encoding: 'utf8' }).trim();
  return {
    model: sysctl('hw.model'),
    chip: sysctl('machdep.cpu.brand_string'),
    memoryGB: Math.round(Number(sysctl('hw.memsize')) / 1024 ** 3),
    macos: execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim(),
  };
}

function processTree(root) {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,time='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .map(([pid, ppid, time]) => ({ pid: Number(pid), ppid: Number(ppid), cpuSeconds: cpuSeconds(time) }));
  const tree = new Map();
  const queue = [root];
  while (queue.length > 0) {
    const pid = queue.shift();
    const row = rows.find((candidate) => candidate.pid === pid);
    if (!row || tree.has(pid)) continue;
    tree.set(pid, row);
    for (const child of rows) if (child.ppid === pid) queue.push(child.pid);
  }
  return [...tree.values()];
}

function cpuSeconds(time) {
  const [clock, fraction = '0'] = time.split('.');
  const parts = clock.split(':').map(Number);
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds + Number(`0.${fraction}`);
}

function footprintMB(pids, scratch) {
  const file = path.join(scratch, 'footprint.json');
  execFileSync(
    'footprint',
    ['--noCategories', '-f', 'bytes', '-j', file, ...pids.flatMap((pid) => ['-p', String(pid)])],
    {
      stdio: 'ignore',
    },
  );
  const report = JSON.parse(fs.readFileSync(file, 'utf8'));
  const bytes = report.processes.reduce((total, process) => total + process.footprint, 0);
  return Math.round(bytes / 1024 ** 2);
}

// A brand-new Chrome profile spends its first minute downloading components, which a real user's profile
// has long finished; measuring from a copy of a profile that has already been opened once avoids counting that.
async function warmTemplate(name, browser, settings, scratch) {
  const template = fs.mkdtempSync(path.join(scratch, `${name}-template-`));
  const child = launch(browser, template, ['about:blank']);
  await sleep(settings.settleMs);
  await quit(child);
  return template;
}

function prepareProfile(browser, profile, template) {
  if (template) fs.cpSync(template, profile, { recursive: true });
  else fs.mkdirSync(profile, { recursive: true });
  if (browser.kind !== 'yalqen') return;
  fs.writeFileSync(
    path.join(profile, 'settings.json'),
    JSON.stringify({ version: 1, adBlocking: browser.adBlocking, welcomeCompleted: true, startupBehavior: 'restore' }),
  );
  if (browser.adBlocking) fs.copyFileSync(engineCache, path.join(profile, 'adblock-engine.bin'));
}

const running = new Set();

function spawnBrowser(binary, args, options) {
  const child = spawn(binary, args, { stdio: 'ignore', ...options });
  running.add(child);
  child.once('exit', () => running.delete(child));
  return child;
}

function launch(browser, profile, urls) {
  const binary = path.join(browser.app, browser.binary);
  if (browser.kind === 'yalqen') {
    return spawnBrowser(binary, urls, {
      env: { ...process.env, YALQEN_BENCH: path.join(profile, 'bench.jsonl'), YALQEN_BENCH_PROFILE: profile },
    });
  }
  return spawnBrowser(binary, [`--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', ...urls]);
}

async function quit(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  if ((await Promise.race([exited.then(() => true), sleep(QUIT_TIMEOUT_MS).then(() => false)])) === false) {
    child.kill('SIGKILL');
    await exited;
  }
}

async function measure(name, browser, tabs, settings, scratch, template) {
  const profile = fs.mkdtempSync(path.join(scratch, `${name}-`));
  prepareProfile(browser, profile, template);
  const urls = Array.from({ length: tabs }, (_, index) => settings.pages[index % settings.pages.length]);
  const child = launch(browser, profile, urls);
  try {
    await sleep(settings.settleMs);
    if (child.exitCode !== null) throw new Error(`${name} exited early with code ${child.exitCode}`);
    const settled = processTree(child.pid);
    const memoryMB = footprintMB(
      settled.map((process) => process.pid),
      scratch,
    );
    let idleCpuSeconds = null;
    if (settings.idleMs > 0) {
      await sleep(settings.idleMs);
      const after = processTree(child.pid);
      const before = new Map(settled.map((process) => [process.pid, process.cpuSeconds]));
      idleCpuSeconds = after.reduce((total, process) => total + process.cpuSeconds - (before.get(process.pid) ?? 0), 0);
      idleCpuSeconds = Math.round(idleCpuSeconds * 100) / 100;
    }
    return { processes: settled.length, memoryMB, idleCpuSeconds };
  } finally {
    await quit(child);
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 100) / 100;
};

function summarize(records) {
  const rows = [];
  for (const key of new Set(records.map((record) => `${record.browser}|${record.tabs}`))) {
    const [browser, tabs] = key.split('|');
    const group = records.filter((record) => record.browser === browser && String(record.tabs) === tabs);
    const memory = group.map((record) => record.memoryMB);
    const cpu = group.map((record) => record.idleCpuSeconds).filter((value) => value !== null);
    rows.push({
      browser,
      tabs: Number(tabs),
      memoryMB: `${median(memory)} (${Math.min(...memory)}–${Math.max(...memory)})`,
      idleCpuSeconds: cpu.length ? `${median(cpu)} (${Math.min(...cpu)}–${Math.max(...cpu)})` : '–',
    });
  }
  return rows;
}

async function main() {
  const settings = options();
  if (settings.help) {
    console.log(USAGE);
    return;
  }
  if (settings.browsers.some((name) => BROWSERS[name].adBlocking) && !fs.existsSync(engineCache)) {
    throw new Error(
      `missing ${engineCache}: run \`npm run bench\` once so ad blocking does not download its lists mid-run`,
    );
  }
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-bench-browsers-'));
  const interrupt = () => {
    for (const child of running) child.kill('SIGKILL');
    fs.rmSync(scratch, { recursive: true, force: true });
    process.exit(130);
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const session = new Date().toISOString();
  const env = environment();
  const versions = Object.fromEntries(
    settings.browsers.map((name) => [name, plistValue(BROWSERS[name].app, 'CFBundleShortVersionString')]),
  );
  fs.mkdirSync(path.dirname(settings.out), { recursive: true });
  const records = [];
  try {
    const templates = {};
    for (const name of settings.browsers) {
      if (BROWSERS[name].kind === 'chromium')
        templates[name] = await warmTemplate(name, BROWSERS[name], settings, scratch);
    }
    for (let run = 1; run <= settings.runs; run++) {
      for (const tabs of settings.tabCounts) {
        for (const name of settings.browsers) {
          const result = await measure(name, BROWSERS[name], tabs, settings, scratch, templates[name]);
          const record = {
            ts: new Date().toISOString(),
            session,
            ...env,
            browser: name,
            version: versions[name],
            tabs,
            run,
            settleMs: settings.settleMs,
            idleMs: settings.idleMs,
            ...result,
          };
          records.push(record);
          fs.appendFileSync(settings.out, `${JSON.stringify(record)}\n`);
          console.log(
            `run ${run} · ${tabs} tabs · ${name}: ${result.memoryMB} MB, idle CPU ${result.idleCpuSeconds} s`,
          );
        }
      }
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  console.log(`\n${env.model}, ${env.chip}, ${env.memoryGB} GB, macOS ${env.macos}`);
  console.log(
    Object.entries(versions)
      .map(([name, version]) => `${name} ${version}`)
      .join(', '),
  );
  console.table(summarize(records));
  console.log(`Records: ${settings.out}`);
}

await main();
