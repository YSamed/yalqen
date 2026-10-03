import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { mainModule } from './main-module.mjs';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    'module-dir': { type: 'string', default: path.join(project, 'dist/main') },
    'baseline-dir': { type: 'string' },
    cache: { type: 'string', default: path.resolve(project, '../../bench/.cache/adblock-engine.bin') },
    runs: { type: 'string', default: '15' },
    out: { type: 'string' },
  },
});
const repetitions = Number(values.runs);
if (!Number.isInteger(repetitions) || repetitions < 1) throw new Error('--runs must be a positive integer');
const cache = path.resolve(values.cache);
if (!fs.existsSync(cache)) throw new Error(`Missing serialized engine cache: ${cache}`);
const builds = [
  ...(values['baseline-dir'] ? [{ variant: 'before', directory: values['baseline-dir'] }] : []),
  { variant: 'after', directory: values['module-dir'] },
].map(({ variant, directory }) => ({ variant, module: mainModule(directory, 'privacy/adblock.js') }));
for (const build of builds) {
  if (!fs.existsSync(build.module)) throw new Error(`Missing built module: ${build.module}`);
}

// Each sample uses a fresh Node process. This isolates module evaluation and cache loading;
// it excludes Electron startup, native session listeners, page loading and process-spawn time.
const source = `
  const { performance } = require('node:perf_hooks');
  globalThis.fetch = async () => { throw new Error('A valid engine cache is required; network is disabled'); };
  const warn = console.warn;
  console.warn = (...args) => { warn(...args); process.exitCode = 1; };
  const start = performance.now();
  const { AdBlocker } = require(process.argv[1]);
  const moduleMs = performance.now() - start;
  const blocker = new AdBlocker([], process.argv[2]);
  blocker.setEnabled(process.argv[3] === 'true');
  const startedMs = performance.now() - start;
  blocker.whenReady().then(() => {
    const readyMs = performance.now() - start;
    blocker.destroy();
    const ghosteryFiles = Object.keys(require.cache).filter(file => file.includes('/@ghostery/')).length;
    console.log(JSON.stringify({ moduleMs, startedMs, readyMs, ghosteryFiles }));
  });
`;
const samples = [];
for (let run = 0; run < repetitions; run++) {
  for (const enabled of [false, true]) {
    // Alternate build order to limit drift from warming the operating-system file cache.
    for (const build of run % 2 ? builds.toReversed() : builds) {
      const result = spawnSync(process.execPath, ['-e', source, build.module, cache, String(enabled)], {
        encoding: 'utf8',
        timeout: 10_000,
      });
      if (result.status !== 0) throw new Error(result.stderr || String(result.error));
      samples.push({ run, enabled, variant: build.variant, ...JSON.parse(result.stdout) });
    }
  }
}
const median = (numbers) => {
  const sorted = numbers.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const summary = [false, true].flatMap((enabled) =>
  builds.map(({ variant }) => {
    const group = samples.filter((sample) => sample.enabled === enabled && sample.variant === variant);
    return {
      enabled,
      variant,
      runs: group.length,
      moduleMs: median(group.map((sample) => sample.moduleMs)),
      startedMs: median(group.map((sample) => sample.startedMs)),
      readyMs: median(group.map((sample) => sample.readyMs)),
      ghosteryFiles: group[0].ghosteryFiles,
    };
  }),
);
console.table(summary);
if (values.out) {
  const out = path.resolve(values.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify({ summary, samples }, null, 2)}\n`);
}
