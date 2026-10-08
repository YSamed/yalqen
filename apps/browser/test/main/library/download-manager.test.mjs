import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import downloadManager from '../../../dist/main/library/download-manager.js';

const { DownloadManager } = downloadManager;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture(t, { askBefore = true, askLocation = false, responses = [], paths = [], checkFile } = {}) {
  const session = new EventEmitter();
  session.downloadURL = (url) => {
    session.retried = url;
  };
  const entries = new Map();
  const store = {
    add: (entry) => entries.set(entry.id, entry),
    get: (id) => entries.get(id),
    update: (id, patch) => Object.assign(entries.get(id), patch),
    remove: (id) => entries.delete(id),
  };
  const prompts = [];
  const saves = [];
  const dialogs = {
    showMessageBox: async (options) => {
      prompts.push(options);
      return { response: responses.shift() ?? 2 };
    },
    showSaveDialog: async (options) => {
      saves.push(options);
      const filePath = paths.shift();
      return { canceled: !filePath, filePath };
    },
  };
  const manager = new DownloadManager(
    {
      store,
      daily: session,
      privateBrowsing: new EventEmitter(),
      developer: new EventEmitter(),
      directory: () => '/downloads',
      askBeforeDownload: () => askBefore,
      askDownloadLocation: () => askLocation,
      parentOf: () => undefined,
      onStateChange: () => {},
      checkFile,
    },
    dialogs,
  );
  t.after(() => manager.destroy());
  const start = (name = 'report.pdf') => {
    const item = new EventEmitter();
    item.state = 'progressing';
    item.paused = false;
    item.getFilename = () => name;
    item.getURL = () => 'https://example.com/report.pdf';
    item.getURLChain = () => [item.getURL()];
    item.getState = () => item.state;
    item.getTotalBytes = () => 100;
    item.getReceivedBytes = () => 0;
    item.setSavePath = (file) => {
      item.savePath = file;
    };
    item.pause = () => {
      item.paused = true;
    };
    item.resume = () => {
      item.paused = false;
    };
    item.cancel = () => {
      item.state = 'cancelled';
    };
    session.emit('will-download', {}, item);
    return item;
  };
  return { manager, start, prompts, saves, entries, session };
}

test('automatic downloads use the configured directory and reserve unique paths', (t) => {
  const f = fixture(t, { askBefore: false });
  assert.equal(f.start().savePath, '/downloads/report.pdf');
  assert.equal(f.start().savePath, '/downloads/report (1).pdf');
  assert.equal(f.entries.size, 2);
  assert.deepEqual(f.prompts, []);
  assert.deepEqual(f.saves, []);
});

test('save as changes both the file name and folder before resuming', async (t) => {
  const f = fixture(t, { responses: [1], paths: ['/chosen/renamed.pdf'] });
  const item = f.start();
  assert.equal(item.paused, true);
  assert.equal(f.entries.size, 0);
  await tick();
  assert.equal(item.paused, false);
  assert.equal(item.savePath, '/chosen/renamed.pdf');
  const entry = [...f.entries.values()][0];
  assert.equal(entry.filename, 'renamed.pdf');
  assert.equal(entry.savePath, item.savePath);
  assert.equal(f.saves[0].defaultPath, '/downloads/report.pdf');
  assert.match(f.saves[0].message, /example.com/);
});

test('ask where to save opens the chooser even without the separate download confirmation', async (t) => {
  const f = fixture(t, { askBefore: false, askLocation: true, paths: ['/chosen/report.pdf'] });
  const item = f.start();
  await tick();
  assert.equal(item.savePath, '/chosen/report.pdf');
  assert.deepEqual(f.prompts, []);
  assert.equal(f.saves.length, 1);
});

test('cancelling either dialog cancels the download and releases its reserved name', async (t) => {
  for (const responses of [[2], [1]]) {
    const f = fixture(t, { responses });
    const item = f.start();
    await tick();
    assert.equal(item.state, 'cancelled');
    assert.equal(f.entries.size, 0);
    assert.equal(f.manager.reservedPaths.size, 0);
    assert.equal(f.start().savePath, '/downloads/report.pdf');
    await tick();
  }
});

test('a save chooser cannot overwrite a file reserved by an active download', async (t) => {
  const f = fixture(t, {
    askLocation: true,
    responses: [0],
    paths: ['/chosen/report.pdf', '/chosen/report.pdf', '/chosen/other.pdf'],
  });
  const first = f.start();
  await tick();
  const second = f.start();
  await tick();
  assert.equal(first.savePath, '/chosen/report.pdf');
  assert.equal(second.savePath, '/chosen/other.pdf');
  assert.equal(f.prompts.length, 1);
  assert.equal(f.entries.size, 2);
});

test('retry retains the selected folder and name without requesting approval again', async (t) => {
  const f = fixture(t, { askLocation: true, paths: ['/chosen/custom.pdf'] });
  const first = f.start();
  await tick();
  first.state = 'interrupted';
  first.emit('done', {}, 'interrupted');
  const id = [...f.entries.keys()][0];
  f.manager.actions(() => {}).retry(id);
  assert.equal(f.session.retried, first.getURL());
  const retry = f.start();
  assert.equal(retry.savePath, '/chosen/custom.pdf');
  assert.equal(f.saves.length, 1);
  assert.equal(f.entries.size, 1);
});

test('completed downloads remain unavailable until verification and known malicious files cannot open', async (t) => {
  let finish;
  const f = fixture(t, {
    askBefore: false,
    checkFile: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const item = f.start('fixture.bin');
  const id = [...f.entries.keys()][0];
  item.emit('done', {}, 'completed');
  assert.equal(f.entries.get(id).state, 'checking');
  f.manager.actions(() => {}).remove(id);
  assert.equal(f.entries.has(id), true);
  finish('test threat source');
  await tick();
  assert.equal(f.entries.get(id).state, 'blocked');
  assert.match(f.prompts[0].detail, /test threat source/);
  f.manager.actions(() => {}).open(id);
  assert.equal(f.entries.get(id).state, 'blocked');
});

test('verification failures never mark a file completed', async (t) => {
  const f = fixture(t, {
    askBefore: false,
    checkFile: async () => {
      throw new Error('file unavailable');
    },
  });
  const item = f.start();
  item.emit('done', {}, 'completed');
  await tick();
  assert.equal([...f.entries.values()][0].state, 'interrupted');
});
