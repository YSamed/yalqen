import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'module-dir': { type: 'string', default: path.resolve(fileURLToPath(new URL('../dist/main/', import.meta.url))) },
    out: { type: 'string' },
  },
});
const { newRequestRule, pausedRequestCommand } = (
  await import(pathToFileURL(path.join(values['module-dir'], 'request-rules.js')))
).default;
const paused = {
  requestId: 'bench-request',
  request: { url: 'https://api.example/data', headers: { Accept: '*/*', Cookie: 'existing=1' } },
};
const rule = (fields) => ({ ...newRequestRule(), pattern: 'https://api.example/*', ...fields });
const mock64KiB = [rule({ action: 'mock', body: 'a'.repeat(64 * 1024) })];
const mock1MiB = [rule({ action: 'mock', body: 'a'.repeat(1024 * 1024) })];
const headers = [
  rule({
    action: 'headers',
    headers: Array.from({ length: 100 }, (_, index) => `X-Test-${index}: ${'x'.repeat(50)}`).join('\n'),
  }),
];
let checksum = 0;

function measure(name, iterations, run) {
  for (let index = 0; index < 100; index++) run();
  const samples = [];
  for (let repeat = 0; repeat < 7; repeat++) {
    const start = performance.now();
    for (let index = 0; index < iterations; index++) run();
    samples.push((performance.now() - start) / iterations);
  }
  samples.sort((a, b) => a - b);
  return { name, iterations, medianMs: Number(samples[3].toFixed(6)) };
}

const results = [
  measure('mock response, repeated 64 KiB body', 5000, () => {
    checksum += pausedRequestCommand(mock64KiB, paused).params.body.length;
  }),
  measure('mock response, repeated 1 MiB body', 1000, () => {
    checksum += pausedRequestCommand(mock1MiB, paused).params.body.length;
  }),
  measure('request headers, repeated 100 edits', 10000, () => {
    checksum += pausedRequestCommand(headers, paused).params.headers.length;
  }),
];
const record = { node: process.version, checksum, results };
if (values.out) fs.writeFileSync(values.out, `${JSON.stringify(record, null, 2)}\n`);
console.table(results);
