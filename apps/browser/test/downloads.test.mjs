import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import downloads from '../dist/main/downloads.js';

const {
  DownloadStore,
  downloadStatus,
  downloadsMenuTemplate,
  downloadsSummary,
  formatBytes,
  renderDownloads,
  uniquePath,
} = downloads;

const entry = (overrides = {}) => ({
  id: 'a',
  url: 'https://files.example.com/report.pdf',
  filename: 'report.pdf',
  savePath: '/tmp/report.pdf',
  state: 'completed',
  receivedBytes: 2048,
  totalBytes: 2048,
  startedAt: 1,
  ...overrides,
});

function withDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-downloads-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('taken names are numbered and paths cannot leave the folder', () => {
  const taken = new Set(['/d/a.zip', '/d/a (1).zip']);
  assert.equal(
    uniquePath('/d', 'a.zip', (file) => taken.has(file)),
    '/d/a (2).zip',
  );
  assert.equal(
    uniquePath('/d', 'b.zip', (file) => taken.has(file)),
    '/d/b.zip',
  );
  assert.equal(
    uniquePath('/d', '../../etc/passwd', () => false),
    '/d/passwd',
  );
  assert.equal(
    uniquePath('/d', '.hidden', () => false),
    '/d/hidden',
  );
  assert.equal(
    uniquePath('/d', '', () => false),
    '/d/indirme',
  );
});

test('sizes and states read naturally', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1,5 KB');
  assert.equal(formatBytes(5 * 1024 * 1024), '5 MB');
  assert.equal(
    downloadStatus(entry({ state: 'progressing', receivedBytes: 512, totalBytes: 2048 })),
    '%25 · 512 B / 2 KB',
  );
  assert.equal(downloadStatus(entry({ state: 'progressing', receivedBytes: 512, totalBytes: 0 })), '512 B');
  assert.equal(downloadStatus(entry({ state: 'paused', receivedBytes: 512 })), 'Duraklatıldı · 512 B / 2 KB');
  assert.equal(downloadStatus(entry()), 'Tamamlandı · 2 KB');
  assert.equal(downloadStatus(entry({ state: 'interrupted' })), 'Başarısız');
});

test('the toolbar summary counts running downloads', () => {
  assert.deepEqual(downloadsSummary([entry()]), { active: 0, progress: null });
  assert.deepEqual(
    downloadsSummary([
      entry({ state: 'progressing', receivedBytes: 100, totalBytes: 400 }),
      entry({ state: 'paused', receivedBytes: 100, totalBytes: 400 }),
    ]),
    { active: 2, progress: 0.25 },
  );
  assert.deepEqual(downloadsSummary([entry({ state: 'progressing', totalBytes: 0 })]), { active: 1, progress: null });
});

test('the store counts every download that starts', () => {
  withDir((dir) => {
    const store = new DownloadStore(dir);
    assert.equal(store.summary().started, 0);
    store.add(entry({ id: 'a' }));
    store.add(entry({ id: 'b' }));
    store.remove('a');
    assert.equal(store.summary().started, 2);
    assert.equal(new DownloadStore(dir).summary().started, 0);
  });
});

test('the list persists and running downloads come back as failed', () => {
  withDir((dir) => {
    const store = new DownloadStore(dir);
    store.add(entry({ id: 'done' }));
    store.add(entry({ id: 'running', state: 'progressing', receivedBytes: 10 }));
    store.update('running', { receivedBytes: 20 });
    assert.equal(store.get('running').receivedBytes, 20);
    assert.deepEqual(
      store.list().map((item) => item.id),
      ['running', 'done'],
    );
    store.saveNow();

    const reloaded = new DownloadStore(dir);
    assert.deepEqual(
      reloaded.list().map((item) => [item.id, item.state]),
      [
        ['running', 'interrupted'],
        ['done', 'completed'],
      ],
    );
    reloaded.remove('done');
    reloaded.clearFinished();
    reloaded.saveNow();
    assert.deepEqual(new DownloadStore(dir).list(), []);
  });
});

test('the menu offers commands that fit each download', () => {
  const calls = [];
  const record = (name) => (id) => calls.push([name, id]);
  const actions = {
    open: record('open'),
    show: record('show'),
    pause: record('pause'),
    resume: record('resume'),
    cancel: record('cancel'),
    retry: record('retry'),
    remove: record('remove'),
    showAll: () => calls.push(['all']),
    openFolder: () => calls.push(['folder']),
  };
  const items = downloadsMenuTemplate(
    [
      entry({ id: 'r', filename: 'a.zip', state: 'progressing', receivedBytes: 1024, totalBytes: 2048 }),
      entry({ id: 'c' }),
    ],
    actions,
  );
  assert.deepEqual(
    items.map((item) => item.label ?? '-'),
    [
      'a.zip — %50 · 1 KB / 2 KB',
      'report.pdf — Tamamlandı · 2 KB',
      '-',
      'Tüm indirilenler',
      'İndirilenler klasörünü aç',
    ],
  );
  assert.deepEqual(
    items[0].submenu.map((item) => item.label),
    ['Duraklat', 'İptal et'],
  );
  assert.deepEqual(
    items[1].submenu.map((item) => item.label),
    ['Aç', 'Klasörde göster', 'Listeden kaldır'],
  );
  items[0].submenu[0].click();
  items[1].submenu[1].click();
  items[3].click();
  assert.deepEqual(calls, [['pause', 'r'], ['show', 'c'], ['all']]);
  assert.equal(downloadsMenuTemplate([], actions)[0].label, 'Henüz indirme yok');
});

test('the downloads page escapes names and links to its commands', () => {
  const html = renderDownloads([entry({ id: 'x y', filename: '<b>.pdf' })]);
  assert.ok(!html.includes('<b>.pdf'));
  assert.ok(html.includes('yalqen://downloads/open?id=x%20y'));
  assert.ok(html.includes('yalqen://downloads/clear'));
  assert.match(renderDownloads([]), /Henüz indirilen bir dosya yok/);
});

test('downloads of private tabs are listed but never saved', () => {
  withDir((dir) => {
    const store = new DownloadStore(dir);
    store.add(entry({ id: 'normal' }));
    store.add(entry({ id: 'secret', private: true }));
    assert.deepEqual(
      store.list().map((item) => item.id),
      ['secret', 'normal'],
    );
    store.saveNow();
    assert.deepEqual(
      new DownloadStore(dir).list().map((item) => item.id),
      ['normal'],
    );
    store.removePrivate();
    assert.deepEqual(
      store.list().map((item) => item.id),
      ['normal'],
    );
  });
});
