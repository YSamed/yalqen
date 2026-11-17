import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const executable = require('electron');
const results = [];
const directory = new URL('../test/runtime/', import.meta.url);
const tests = readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
  .map((entry) => entry.name)
  .sort();
if (!tests.length) throw new Error('No Electron runtime tests found');
for (const test of tests) {
  if (results.filter((result) => result.failed).length >= 3) {
    results.push({ test, seconds: 0, retried: false, failed: false, skipped: true });
    continue;
  }
  const run = () =>
    spawnSync(executable, [fileURLToPath(new URL(test, directory))], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
      timeout: 45_000,
      killSignal: 'SIGKILL',
    });
  const started = Date.now();
  let result = run();
  const retried = Boolean(result.error || result.status !== 0);
  if (retried) {
    console.warn(`RETRY: ${test} failed once; running it again`);
    result = run();
  }
  const failed = Boolean(result.error || result.status !== 0);
  if (result.error) console.error(result.error);
  results.push({ test, seconds: (Date.now() - started) / 1000, retried, failed });
}

for (const { test, seconds, retried, failed, skipped } of results.toSorted((a, b) => b.seconds - a.seconds)) {
  const status = skipped ? 'SKIP ' : failed ? 'FAIL ' : retried ? 'RETRY' : 'ok   ';
  console.log(`${status} ${seconds.toFixed(1).padStart(5)}s  ${test}`);
}
const failures = results.filter((result) => result.failed).map((result) => result.test);
if (failures.length) {
  if (results.some((result) => result.skipped))
    console.error('Stopped after 3 failed files; the SKIP files did not run.');
  console.error(`${failures.length} runtime test file(s) failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
