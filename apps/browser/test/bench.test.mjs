import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import benchModule from '../dist/main/bench.js';

const { Bench, benchFromEnv, loopDelayMs } = benchModule;

function tempFile() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-bench-test-'));
  return path.join(directory, 'nested', 'records.jsonl');
}

function readLines(file) {
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('benchmarking stays off unless an output file is given', () => {
  assert.equal(benchFromEnv({}), null);
});

test('the environment names the run and the profile', () => {
  const file = tempFile();
  const bench = benchFromEnv({
    YALQEN_BENCH: file,
    YALQEN_BENCH_PROFILE: '/tmp/profile',
    YALQEN_BENCH_SESSION: 's1',
    YALQEN_BENCH_SCENARIO: 'pages',
    YALQEN_BENCH_VARIANT: 'adblock-on',
    YALQEN_BENCH_RUN: '2',
    YALQEN_BENCH_SPAWNED_AT: 'not a number',
  });
  assert.equal(bench.profile, path.resolve('/tmp/profile'));
  bench.record('done');
  const [record] = readLines(file);
  assert.equal(record.event, 'done');
  assert.equal(record.session, 's1');
  assert.equal(record.scenario, 'pages');
  assert.equal(record.variant, 'adblock-on');
  assert.equal(record.run, 2);
  assert.equal(bench.takeLoopDelay().p99Ms >= 0, true);
});

test('each mark is recorded once with the time since spawn', () => {
  const file = tempFile();
  let now = 1_000;
  const bench = new Bench({ file, fields: { session: 's' }, spawnedAt: 400, profile: null, now: () => now });
  bench.mark('window-shown', { url: 'yalqen://newtab/' });
  now = 2_000;
  bench.mark('window-shown');
  const records = readLines(file);
  assert.equal(records.length, 1);
  assert.equal(records[0].event, 'window-shown');
  assert.equal(records[0].sinceSpawnMs, 600);
  assert.equal(records[0].url, 'yalqen://newtab/');
  assert.equal(typeof records[0].sinceStartMs, 'number');
});

test('file writes are totalled per label until taken', () => {
  const bench = new Bench({ file: tempFile(), fields: {}, spawnedAt: null, profile: null });
  bench.countWrite('history', 1000, 1.24);
  bench.countWrite('history', 500, 2.03);
  bench.countWrite('session', 10, 0.1);
  assert.deepEqual(bench.takeWrites(), {
    history: { count: 2, bytes: 1500, serializeMs: 3.3 },
    session: { count: 1, bytes: 10, serializeMs: 0.1 },
  });
  assert.deepEqual(bench.takeWrites(), {});
});

test('an idle event loop reads as no delay', () => {
  assert.equal(loopDelayMs(10_000_000), 0);
  assert.equal(loopDelayMs(9_000_000), 0);
  assert.equal(loopDelayMs(62_500_000), 52.5);
});
