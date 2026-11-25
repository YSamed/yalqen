import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import downloadManager from '../../../dist/main/library/download-manager.js';
import path from 'node:path';

const { DownloadManager } = downloadManager;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const downloads = path.join('downloads');

function fixture(t, { askBefore = true, responses = [], paths = [], checkFile, ignore, chooseName } = {}) {
  const session = new EventEmitter();
  const privateSession = new EventEmitter();
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
      privateBrowsing: privateSession,
      developer: new EventEmitter(),
      directory: () => downloads,
      askBeforeDownload: () => askBefore,
      parentOf: () => undefined,
      ignore,
      onStateChange: () => {},
      checkFile,
      chooseName,
    },
    dialogs,
  );
  t.after(() => manager.destroy());
  const start = (name = 'report.pdf', contents, browsing = session) => {
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
    browsing.emit('will-download', {}, item, contents);
    return item;
  };
  return { manager, start, prompts, saves, entries, session, privateSession };
}

test('automatic downloads use the configured directory and reserve unique paths', (t) => {
  const f = fixture(t, { askBefore: false });
  assert.equal(f.start().savePath, path.join(downloads, 'report.pdf'));
  assert.equal(f.start().savePath, path.join(downloads, 'report (1).pdf'));
  assert.equal(f.entries.size, 2);
  assert.deepEqual(f.prompts, []);
  assert.deepEqual(f.saves, []);
});

test('save as changes both the file name and folder before resuming', async (t) => {
  const chosen_renamed = path.join('', 'chosen', 'renamed.pdf');
  const f = fixture(t, { responses: [1], paths: [chosen_renamed] });
  const item = f.start();
  assert.equal(item.paused, true);
  assert.equal(f.entries.size, 0);
  await tick();
  assert.equal(item.paused, false);
  assert.equal(item.savePath, chosen_renamed);
  const entry = [...f.entries.values()][0];
  assert.equal(entry.filename, 'renamed.pdf');
  assert.equal(entry.savePath, item.savePath);
  assert.equal(f.saves[0].defaultPath, path.join(downloads, 'report.pdf'));
  assert.match(f.saves[0].message, /example.com/);
});

test('cancelling either dialog cancels the download and releases its reserved name', async (t) => {
  for (const responses of [[2], [1]]) {
    const f = fixture(t, { responses });
    const item = f.start();
    await tick();
    assert.equal(item.state, 'cancelled');
    assert.equal(f.entries.size, 0);
    assert.equal(f.manager.reservedPaths.size, 0);
    assert.equal(f.start().savePath, path.join(downloads, 'report.pdf'));
    await tick();
  }
});

test('a save chooser cannot overwrite a file reserved by an active download', async (t) => {
  const chosen_report = path.join('', 'chosen', 'report.pdf');
  const chosen_other = path.join('', 'chosen', 'other.pdf');
  const f = fixture(t, {
    responses: [1, 1, 0],
    paths: [chosen_report, chosen_report, chosen_other],
  });
  const first = f.start();
  await tick();
  const second = f.start();
  await tick();
  assert.equal(first.savePath, chosen_report);
  assert.equal(second.savePath, chosen_other);
  assert.equal(f.prompts.length, 3);
  assert.equal(f.entries.size, 2);
});

test('retry retains the selected folder and name without requesting approval again', async (t) => {
  const chosen_custom = path.join('', 'chosen', 'custom.pdf');
  const f = fixture(t, { responses: [1], paths: [chosen_custom] });
  const first = f.start();
  await tick();
  first.state = 'interrupted';
  first.emit('done', {}, 'interrupted');
  const id = [...f.entries.keys()][0];
  f.manager.actions(() => {}).retry(id);
  assert.equal(f.session.retried, first.getURL());
  const retry = f.start();
  assert.equal(retry.savePath, chosen_custom);
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

test('extension downloads resolve with their entry and keep the download prompt', async (t) => {
  const f = fixture(t, { askBefore: false });
  const started = f.manager.download('https://example.com/report.pdf', 'notes/named.pdf');
  assert.equal(f.session.retried, 'https://example.com/report.pdf');
  const item = f.start();
  assert.equal(item.savePath, path.join(downloads, 'named.pdf'));
  assert.equal(f.entries.get(await started).savePath, item.savePath);

  const asked = fixture(t, { responses: [2] });
  const refused = asked.manager.download('https://example.com/report.pdf', null);
  asked.start();
  assert.equal(await refused, null);
  assert.equal(asked.prompts.length, 1);
});

test('extension downloads that never start resolve null and a late will-download still works', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, { askBefore: false });
  const started = f.manager.download('https://example.com/report.pdf', 'named.pdf');
  t.mock.timers.tick(30_000);
  assert.equal(await started, null);
  assert.equal(f.manager.waiters.size, 0);
  assert.equal(f.manager.suggestedNames.size, 0);
  const item = f.start();
  assert.equal(item.savePath, path.join(downloads, 'report.pdf'));
  assert.equal(f.entries.size, 1);
});

test('ignored sources are cancelled without a prompt or an entry', async (t) => {
  const hidden = {};
  const f = fixture(t, { ignore: (contents) => contents === hidden });
  const ignored = f.start('hidden.bin', hidden);
  assert.equal(ignored.state, 'cancelled');
  assert.equal(ignored.paused, false);
  assert.equal(ignored.savePath, undefined);
  await tick();
  assert.deepEqual(f.prompts, []);
  assert.equal(f.entries.size, 0);
  assert.equal(f.start('shown.bin', {}).paused, true);
});

test('a name hook renames the file before the download prompt', async (t) => {
  const asked = [];
  let answer;
  const f = fixture(t, {
    responses: [0],
    chooseName: (entry) => {
      asked.push(entry);
      return new Promise((resolve) => {
        answer = resolve;
      });
    },
  });
  const item = f.start();
  assert.equal(item.paused, true);
  assert.equal(asked[0].url, 'https://example.com/report.pdf');
  assert.equal(asked[0].savePath, path.join(downloads, 'report.pdf'));
  assert.deepEqual(f.prompts, []);
  answer('renamed.pdf');
  await tick();
  await tick();
  assert.equal(f.prompts.length, 1);
  assert.equal(item.paused, false);
  assert.equal(item.savePath, path.join(downloads, 'renamed.pdf'));
  const [entry] = f.entries.values();
  assert.equal(entry.id, asked[0].id);
  assert.equal(entry.filename, 'renamed.pdf');
  assert.equal(f.start().savePath, path.join(downloads, 'report.pdf'));
});

test('a name hook that never answers falls back to the original name', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t, { askBefore: false, chooseName: () => new Promise(() => {}) });
  const item = f.start();
  assert.equal(item.paused, true);
  assert.equal(f.entries.size, 0);
  t.mock.timers.tick(5_000);
  await tick();
  assert.equal(item.paused, false);
  assert.equal(item.savePath, path.join(downloads, 'report.pdf'));
  assert.equal(f.entries.size, 1);
});

test('ignored and private downloads skip the name hook, and no listener keeps the start synchronous', (t) => {
  const asked = [];
  const hidden = {};
  const f = fixture(t, {
    askBefore: false,
    ignore: (contents) => contents === hidden,
    chooseName: (entry) => {
      asked.push(entry);
      return null;
    },
  });
  assert.equal(f.start('hidden.bin', hidden).state, 'cancelled');
  const privateItem = f.start('private.bin', undefined, f.privateSession);
  assert.equal(privateItem.paused, false);
  assert.equal(asked.length, 0);
  const item = f.start();
  assert.equal(asked.length, 1);
  assert.equal(item.paused, false);
  assert.equal(f.entries.size, 2);
});
