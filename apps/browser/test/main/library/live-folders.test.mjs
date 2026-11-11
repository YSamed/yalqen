import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import library from '../../../dist/main/library/live-folders.js';

const { LiveFolderStore, LiveFolderRefresher, fetchFeed, MAX_LIVE_FOLDERS } = library;
const URL_A = 'https://a.example/feed.xml';

function directory(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-live-folders-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const feedOf = (...ids) => ({
  title: 'Feed title',
  items: ids.map((id) => ({ id, title: `Item ${id}`, url: `https://a.example/${id}` })),
});

const xml = (...ids) =>
  `<rss><channel><title>T</title>${ids.map((id) => `<item><title>${id}</title><link>https://a.example/${id}</link></item>`).join('')}</channel></rss>`;

function stream(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
}

test('the first refresh sets a read baseline and later new items are unread', () => {
  const store = new LiveFolderStore(null);
  const id = store.add({ url: URL_A, name: '' });
  store.update(id, feedOf('1', '2'));
  assert.deepEqual(store.view()[0], {
    id,
    title: 'Feed title',
    collapsed: false,
    failed: false,
    unread: 0,
    items: [
      { id: '1', title: 'Item 1', unread: false },
      { id: '2', title: 'Item 2', unread: false },
    ],
  });
  store.update(id, feedOf('3', '2', '1'));
  assert.deepEqual(
    store.view()[0].items.map((item) => item.unread),
    [true, false, false],
  );
  assert.equal(store.open(id, '3'), 'https://a.example/3');
  assert.equal(store.view()[0].unread, 0);
  assert.equal(store.open(id, 'missing'), null);
});

test('a failed refresh keeps the items and flags the folder', () => {
  const store = new LiveFolderStore(null);
  const id = store.add({ url: URL_A, name: 'Mine' });
  store.update(id, feedOf('1'));
  store.update(id, null);
  assert.equal(store.view()[0].failed, true);
  assert.equal(store.view()[0].title, 'Mine');
  assert.equal(store.view()[0].items.length, 1);
  store.update(id, feedOf('1'));
  assert.equal(store.view()[0].failed, false);
});

test('adds one folder per address, caps the count and hides items of collapsed folders', () => {
  const store = new LiveFolderStore(null);
  const id = store.add({ url: URL_A, name: '' });
  assert.equal(store.add({ url: URL_A, name: '' }), id);
  store.update(id, feedOf('1'));
  assert.equal(store.toggle(id), true);
  assert.deepEqual(store.view()[0].items, []);
  for (let i = 1; i < MAX_LIVE_FOLDERS; i++) assert.ok(store.add({ url: `https://a.example/${i}`, name: '' }));
  assert.equal(store.add({ url: 'https://over.example/', name: '' }), null);
  assert.equal(store.remove(id), true);
  assert.equal(store.remove(id), false);
});

test('keeps folders, items and unread marks across restarts', (t) => {
  const dir = directory(t);
  const store = new LiveFolderStore(dir);
  const id = store.add({ url: URL_A, name: '' });
  store.update(id, feedOf('1'));
  store.update(id, feedOf('2', '1'));
  store.toggle(id);
  store.saveNow();
  assert.deepEqual(fs.readdirSync(dir), ['live-folders.json']);
  const restored = new LiveFolderStore(dir);
  assert.equal(restored.view()[0].unread, 1);
  assert.equal(restored.view()[0].collapsed, true);
  assert.equal(restored.toggle(id), true);
  assert.deepEqual(
    restored.view()[0].items.map((item) => item.id),
    ['2', '1'],
  );
});

test('ignores corrupt, oversized and invalid saved data', (t) => {
  const dir = directory(t);
  const file = path.join(dir, 'live-folders.json');
  fs.writeFileSync(file, '{not json');
  assert.deepEqual(new LiveFolderStore(dir).view(), []);
  fs.writeFileSync(file, JSON.stringify({ version: 1, folders: [], pad: 'x'.repeat(2 * 1024 * 1024) }));
  assert.deepEqual(new LiveFolderStore(dir).view(), []);
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      folders: [
        { id: 'http', url: 'http://a.example/feed.xml', items: [] },
        { id: 'script', url: 'javascript:alert(1)', items: [] },
        {
          id: 'good',
          url: URL_A,
          name: 'Good',
          items: [
            { id: 'bad', title: 'x', url: 'javascript:alert(1)', unread: true },
            { id: 'ok', title: 'x', url: 'https://a.example/ok', unread: true },
          ],
        },
        { id: 'good', url: 'https://b.example/', items: [] },
      ],
    }),
  );
  const view = new LiveFolderStore(dir).view();
  assert.deepEqual(
    view.map((folder) => [folder.id, folder.unread]),
    [['good', 1]],
  );
});

test('fetchFeed parses a response and rejects failures, http redirects and oversized bodies', async () => {
  const respond = (init) => async () => ({ ok: true, url: URL_A, body: stream([xml('1')]), ...init });
  assert.equal((await fetchFeed(respond({}), URL_A)).items.length, 1);
  assert.equal(await fetchFeed(respond({ ok: false }), URL_A), null);
  assert.equal(await fetchFeed(respond({ url: 'http://a.example/feed.xml' }), URL_A), null);
  assert.equal(await fetchFeed(respond({ body: null }), URL_A), null);
  assert.equal(await fetchFeed(respond({ body: stream(['<rss>', 'x'.repeat(3 * 1024 * 1024)]) }), URL_A), null);
  assert.equal(await fetchFeed(respond({ body: stream(['<html></html>']) }), URL_A), null);
  assert.equal(
    await fetchFeed(async () => {
      throw new Error('offline');
    }, URL_A),
    null,
  );
});

test('fetchFeed omits credentials and sets a timeout signal', async () => {
  let seen;
  await fetchFeed(async (url, init) => {
    seen = { url, init };
    return { ok: true, url, body: stream([xml('1')]) };
  }, URL_A);
  assert.equal(seen.url, URL_A);
  assert.equal(seen.init.credentials, 'omit');
  assert.ok(seen.init.signal instanceof AbortSignal);
});

test('the refresher updates every folder once at a time and reports changes', async () => {
  const store = new LiveFolderStore(null);
  const a = store.add({ url: URL_A, name: '' });
  const b = store.add({ url: 'https://b.example/feed.xml', name: '' });
  let calls = 0;
  let changes = 0;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const refresher = new LiveFolderRefresher({
    store,
    changed: () => changes++,
    fetch: async (url) => {
      calls++;
      await gate;
      return { ok: true, url, body: stream([xml(url.includes('b.') ? 'b1' : 'a1')]) };
    },
  });
  const first = refresher.refresh();
  const second = refresher.refresh([a]);
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 2);
  assert.equal(changes, 2);
  assert.deepEqual(
    store.view().map((folder) => folder.items[0].id),
    ['https://a.example/a1', 'https://a.example/b1'],
  );
  assert.ok(b);
});
