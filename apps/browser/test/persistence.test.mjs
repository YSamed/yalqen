import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import persistence from '../dist/main/persistence.js';

const { SessionStore, pinnedOnly, trimHistory } = persistence;
const tab = (url) => ({ id: 'tab', url, title: url, faviconUrl: null, pinnedUrl: null, history: null });
const session = (url) => ({ version: 2, windows: [{ activeTabId: null, tabs: [tab(url)] }] });

test('frequent changes are coalesced into one background save', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-session-'));
  try {
    const store = new SessionStore(dir);
    let snapshots = 0;
    store.scheduleSave(() => {
      snapshots++;
      return session('first');
    }, 10);
    store.scheduleSave(() => {
      snapshots++;
      return session('latest');
    }, 10);
    await waitFor(() => fs.existsSync(path.join(dir, 'tabs.json')));
    assert.equal(snapshots, 1);
    assert.equal(store.load().windows[0].tabs[0].url, 'latest');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a pending background save cannot replace the final shutdown save', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-session-'));
  const writeFile = fs.promises.writeFile;
  let startWrite;
  let finishWrite;
  let noteWritten;
  const started = new Promise((resolve) => {
    startWrite = resolve;
  });
  const released = new Promise((resolve) => {
    finishWrite = resolve;
  });
  const written = new Promise((resolve) => {
    noteWritten = resolve;
  });
  fs.promises.writeFile = async (...args) => {
    startWrite();
    await released;
    await writeFile(...args);
    noteWritten();
  };
  try {
    const store = new SessionStore(dir);
    store.scheduleSave(() => session('old'), 0);
    await started;
    store.saveNow(session('final'));
    finishWrite();
    await written;
    await waitFor(() => fs.readdirSync(dir).every((file) => !file.endsWith('.tmp')));
    assert.equal(store.load().windows[0].tabs[0].url, 'final');
  } finally {
    finishWrite();
    fs.promises.writeFile = writeFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a single-window session from before windows is read as one window', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-session-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({ version: 1, activeTabId: 'tab', tabs: [tab('old')] }),
    );
    assert.deepEqual(new SessionStore(dir).load(), {
      version: 2,
      windows: [{ activeTabId: 'tab', tabs: [tab('old')] }],
    });
    fs.writeFileSync(
      path.join(dir, 'tabs.json'),
      JSON.stringify({ version: 2, windows: [{ activeTabId: null, tabs: [] }, { nope: 1 }] }),
    );
    assert.deepEqual(new SessionStore(dir).load().windows, [{ activeTabId: null, tabs: [] }]);
    fs.writeFileSync(path.join(dir, 'tabs.json'), JSON.stringify({ version: 3 }));
    assert.equal(new SessionStore(dir).load(), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the update restart flag survives one load and nothing else does', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-session-'));
  try {
    const store = new SessionStore(dir);
    store.saveNow({ ...session('resumed'), resume: true });
    assert.deepEqual(new SessionStore(dir).load(), { ...session('resumed'), resume: true });
    fs.writeFileSync(path.join(dir, 'tabs.json'), JSON.stringify({ ...session('plain'), resume: 'yes' }));
    assert.deepEqual(new SessionStore(dir).load(), session('plain'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function waitFor(condition) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for session save');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('saved navigation keeps a window of entries around the current page', () => {
  const entries = Array.from({ length: 30 }, (_, i) => ({
    url: `https://a.com/${i}`,
    title: String(i),
    pageState: '',
  }));
  const middle = trimHistory({ entries, index: 20 });
  assert.deepEqual(
    middle.entries.map((entry) => entry.title),
    ['14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26'],
  );
  assert.equal(middle.entries[middle.index].title, '20');
  const start = trimHistory({ entries, index: 2 });
  assert.equal(start.entries.length, 9);
  assert.equal(start.entries[start.index].title, '2');
  const end = trimHistory({ entries, index: 29 });
  assert.equal(end.entries.length, 7);
  assert.equal(end.entries[end.index].title, '29');
  const short = trimHistory({ entries: entries.slice(0, 3), index: 1 });
  assert.deepEqual(short, { entries: entries.slice(0, 3), index: 1 });
});

test('without session restore only pinned tabs are kept, reset to their pinned page', () => {
  const history = { entries: [{ url: 'https://mail.example/inbox', title: 'Inbox' }], index: 0 };
  const window = {
    activeTabId: 'pinned',
    tabs: [
      { ...tab('https://news.example/'), id: 'loose' },
      { ...tab('https://mail.example/inbox'), id: 'pinned', pinnedUrl: 'https://mail.example/', history },
      { ...tab('https://chat.example/'), id: 'legacy', keepAlive: true },
    ],
  };

  const kept = pinnedOnly(window);

  assert.equal(kept.activeTabId, null);
  assert.deepEqual(
    kept.tabs.map(({ id, url, pinnedUrl, history }) => ({ id, url, pinnedUrl, history })),
    [
      { id: 'pinned', url: 'https://mail.example/', pinnedUrl: 'https://mail.example/', history: null },
      { id: 'legacy', url: 'https://chat.example/', pinnedUrl: 'https://chat.example/', history: null },
    ],
  );
});
