import assert from 'node:assert/strict';
import { test } from 'node:test';
import changeFeed from '../dist/main/change-feed.js';

const { ChangeFeed } = changeFeed;

test('a stale version is answered at once', async () => {
  const feed = new ChangeFeed();
  feed.notify();
  assert.equal(await feed.next(0), 1);
});

test('waiters wake on the next change', async () => {
  const feed = new ChangeFeed();
  const first = feed.next(0);
  const second = feed.next(0);
  feed.notify();
  assert.deepEqual(await Promise.all([first, second]), [1, 1]);
});

test('waiting ends with the same version when nothing changes', async () => {
  const feed = new ChangeFeed();
  assert.equal(await feed.next(0, 5), 0);
  feed.notify();
  assert.equal(feed.version, 1);
});

test('aborting a closed page releases its wait without waiting for a change', async () => {
  const feed = new ChangeFeed();
  const controller = new AbortController();
  const waiting = feed.next(0, 1000, controller.signal);
  controller.abort();
  assert.equal(await waiting, 0);
  assert.equal(await feed.next(0, 1000, controller.signal), 0);
  const active = feed.next(0);
  feed.notify();
  assert.equal(await active, 1);
});
