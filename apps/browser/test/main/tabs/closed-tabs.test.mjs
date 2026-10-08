import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import closed from '../../../dist/main/tabs/closed-tabs.js';
import tabs from '../../../dist/main/tabs/tabs.js';
const record = (id, closedAt = 100) => ({
  id,
  url: `https://example.com/${id}`,
  title: id,
  faviconUrl: null,
  history: {
    entries: [
      { url: 'https://example.com/back', title: 'Back', pageState: 'saved state' },
      { url: `https://example.com/${id}`, title: id },
    ],
    index: 1,
  },
  closedAt,
});
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-closed-tabs-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, store: new closed.ClosedTabStore(directory) };
}
test('closed tabs survive restart in order with history and consumed entries stay consumed', (t) => {
  const { directory, store } = fixture(t);
  store.tabs.push(record('first'), record('last'));
  store.changed();
  store.saveNow();
  const restarted = new closed.ClosedTabStore(directory);
  assert.deepEqual(
    restarted.tabs.map(({ id }) => id),
    ['first', 'last'],
  );
  assert.equal(restarted.tabs.at(-1).history.entries[0].pageState, 'saved state');
  const manager = new tabs.TabManager({ closed: restarted.tabs, onClosedChanged: () => restarted.changed() });
  manager.tabs.push(manager.createRecord(record('last')));
  manager.activate = (id) => {
    manager.activeId = id;
  };
  manager.reopenClosed();
  assert.equal(manager.tabs.length, 2);
  assert.notEqual(manager.tabs[1].id, 'last');
  assert.equal(manager.tabs[1].url, 'https://example.com/last');
  restarted.saveNow();
  assert.deepEqual(
    new closed.ClosedTabStore(directory).tabs.map(({ id }) => id),
    ['first'],
  );
});
test('the persisted list stays bounded and history clearing removes the selected time range immediately', (t) => {
  const { directory, store } = fixture(t);
  store.tabs.push(...Array.from({ length: 30 }, (_, i) => record(String(i), i)));
  store.changed();
  store.saveNow();
  assert.equal(new closed.ClosedTabStore(directory).tabs.length, 20);
  const array = store.tabs;
  store.clearSince(20);
  assert.equal(store.tabs, array);
  assert.ok(store.tabs.every(({ closedAt }) => closedAt < 20));
  assert.ok(new closed.ClosedTabStore(directory).tabs.every(({ closedAt }) => closedAt < 20));
  store.clearSince(0);
  assert.deepEqual(new closed.ClosedTabStore(directory).tabs, []);
});
test('malformed, executable and private records are excluded and invalid history cannot reach Chromium', (t) => {
  const { directory, store } = fixture(t);
  fs.writeFileSync(
    store.file,
    JSON.stringify({
      version: 1,
      tabs: [
        null,
        {},
        { ...record('private'), isPrivate: true },
        { ...record('script'), url: 'javascript:alert(1)' },
        { ...record('bad-date'), closedAt: '100' },
        {
          ...record('bad-history'),
          history: { entries: [{ url: 'https://example.com/', title: 'Bad', pageState: {} }], index: 0 },
        },
      ],
    }),
  );
  const loaded = new closed.ClosedTabStore(directory);
  assert.equal(loaded.tabs.length, 1);
  assert.equal(loaded.tabs[0].history, null);
  fs.writeFileSync(store.file, 'broken');
  assert.deepEqual(new closed.ClosedTabStore(directory).tabs, []);
});
test('private and developer windows cannot consume normal closed-tab history', (t) => {
  const { store } = fixture(t);
  store.tabs.push(record('normal'));
  const manager = new tabs.TabManager({ closed: store.tabs, privateWindow: true });
  manager.reopenClosed();
  assert.equal(store.tabs.length, 1);
  assert.equal(manager.count, 0);
});
