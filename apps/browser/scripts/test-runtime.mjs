import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const executable = require('electron');
const directory = new URL('../test/runtime/', import.meta.url);
const tests = readdirSync(directory, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith('.mjs'))
  .map((entry) => entry.name)
  .sort();
if (!tests.length) throw new Error('No Electron runtime tests found');
const jobs = Math.max(1, Number(process.env.RUNTIME_TEST_JOBS) || Math.min(4, availableParallelism()));

function run(test) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(executable, [fileURLToPath(new URL(test, directory))], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    });
    const output = [];
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.stderr.on('data', (chunk) => output.push(chunk));
    const timer = setTimeout(() => child.kill('SIGKILL'), 45_000);
    child.once('error', (error) => output.push(Buffer.from(`${error.stack}\n`)));
    child.once('close', (code) => {
      clearTimeout(timer);
      // Buffered so parallel files do not interleave their logs.
      process.stdout.write(Buffer.concat(output));
      resolve({ ok: code === 0, seconds: (Date.now() - started) / 1000 });
    });
  });
}

const results = new Map();
const queue = [...tests];
const failedFirst = () => [...results.values()].filter((result) => !result.ok).length;
async function worker() {
  // A broken build fails every file; stop early so it does not burn macOS CI minutes.
  while (queue.length && failedFirst() < 3) {
    const test = queue.shift();
    results.set(test, await run(test));
  }
}
await Promise.all(Array.from({ length: jobs }, worker));

const summary = [];
for (const test of tests) {
  const first = results.get(test);
  if (!first) {
    summary.push({ test, seconds: 0, status: 'SKIP ' });
    continue;
  }
  if (first.ok) {
    summary.push({ test, seconds: first.seconds, status: 'ok   ' });
    continue;
  }
  // Retried alone: a file that only fails next to others is a contention flake, not a bug.
  console.warn(`RETRY: ${test} failed in parallel; running it again alone`);
  const second = await run(test);
  summary.push({ test, seconds: first.seconds + second.seconds, status: second.ok ? 'RETRY' : 'FAIL ' });
}

for (const { test, seconds, status } of summary.toSorted((a, b) => b.seconds - a.seconds)) {
  console.log(`${status} ${seconds.toFixed(1).padStart(5)}s  ${test}`);
}
const failures = summary.filter(({ status }) => status === 'FAIL ').map(({ test }) => test);
if (summary.some(({ status }) => status === 'SKIP ')) {
  console.error('Stopped after 3 failed files; the SKIP files did not run.');
  process.exitCode = 1;
}
if (failures.length) {
  console.error(`${failures.length} runtime test file(s) failed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
