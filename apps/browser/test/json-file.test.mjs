import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import jsonFile from '../dist/main/json-file.js';

const { JsonFile } = jsonFile;

async function withFile(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-json-'));
  try {
    await run(path.join(directory, 'data.json'));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

async function waitFor(check, timeoutMs = 2000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await delay(5);
  }
}

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

test('a change that may wait does not hold back a save that is due sooner', async () => {
  await withFile(async (file) => {
    const json = new JsonFile(file, 'test', 10_000);
    json.schedule(() => 'visit', 10);
    json.schedule(() => 'title', 5_000);
    await waitFor(() => fs.existsSync(file), 500);
    assert.equal(read(file), 'title');
  });
});

test('a change that is due sooner pulls a waiting save forward', async () => {
  await withFile(async (file) => {
    const json = new JsonFile(file, 'test', 10_000);
    json.schedule(() => 'title', 5_000);
    json.schedule(() => 'visit', 10);
    await waitFor(() => fs.existsSync(file), 500);
    assert.equal(read(file), 'visit');
  });
});

test('changes that never pause are still saved within the maximum wait', async () => {
  await withFile(async (file) => {
    const json = new JsonFile(file, 'test', 60);
    let saves = 0;
    const started = Date.now();
    while (Date.now() - started < 300) {
      json.schedule(() => ++saves, 40);
      await delay(10);
    }
    assert.ok(saves >= 2, `saved ${saves} times`);
    json.flush();
  });
});
