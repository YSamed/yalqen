import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import clearData from '../dist/main/library/clear-data.js';
import downloads from '../dist/main/library/downloads.js';
import history from '../dist/main/library/history.js';

const { clearSince, sanitizeClearRequest } = clearData;
const HOUR = 60 * 60 * 1000;

function withDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-clear-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('ranges start at the right time', () => {
  const now = 1_000 * HOUR;
  assert.equal(clearSince('hour', now), now - HOUR);
  assert.equal(clearSince('day', now), now - 24 * HOUR);
  assert.equal(clearSince('week', now), now - 7 * 24 * HOUR);
  assert.equal(clearSince('month', now), now - 28 * 24 * HOUR);
  assert.equal(clearSince('all', now), 0);
});

test('requests must name a range and at least one kind of data', () => {
  assert.deepEqual(sanitizeClearRequest({ range: 'day', history: true, cache: 'yes' }), {
    range: 'day',
    history: true,
    downloads: false,
    siteData: false,
    cache: false,
  });
  assert.equal(sanitizeClearRequest({ range: 'day' }), null);
  assert.equal(sanitizeClearRequest({ range: 'year', history: true }), null);
  assert.equal(sanitizeClearRequest(null), null);
});

test('history and finished downloads are cleared from a point in time', () => {
  withDir((dir) => {
    fs.writeFileSync(
      path.join(dir, 'history.json'),
      JSON.stringify([
        { id: 'n', url: 'https://new.com/', title: 'New', visitedAt: 20 },
        { id: 'o', url: 'https://old.com/', title: 'Old', visitedAt: 10 },
      ]),
    );
    const visits = new history.HistoryStore(dir);
    visits.clearSince(15);
    assert.deepEqual(
      visits.list().map((entry) => entry.id),
      ['o'],
    );
    assert.deepEqual(
      new history.HistoryStore(dir).list().map((entry) => entry.id),
      ['o'],
    );
    visits.clearSince(0);
    assert.deepEqual(new history.HistoryStore(dir).list(), []);

    const list = new downloads.DownloadStore(dir);
    const base = { url: 'https://a.com/f', savePath: '/tmp/f', receivedBytes: 1, totalBytes: 1 };
    list.add({ ...base, id: 'old', filename: 'old', state: 'completed', startedAt: 10 });
    list.add({ ...base, id: 'new', filename: 'new', state: 'completed', startedAt: 20 });
    list.add({ ...base, id: 'running', filename: 'running', state: 'progressing', startedAt: 30 });
    list.removeSince(15);
    assert.deepEqual(
      list.list().map((entry) => entry.id),
      ['running', 'old'],
    );
    assert.deepEqual(
      new downloads.DownloadStore(dir).list().map((entry) => entry.id),
      ['running', 'old'],
    );
    list.removeSince(0);
    assert.deepEqual(
      list.list().map((entry) => entry.id),
      ['running'],
    );
  });
});
