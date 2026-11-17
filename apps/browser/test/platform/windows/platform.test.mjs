import assert from 'node:assert/strict';
import { test } from 'node:test';
import i18n from '../../../dist/shared/i18n.js';
import { load, patchFileSystem } from '../../helpers/platform.mjs';

const SYSTEM32_BASH = String.raw`C:\Windows\System32\bash.exe`;
const GIT_BASH = String.raw`C:\Program Files\Git\bin\bash.exe`;

test('platform constants reflect the import-time platform', () => {
  const win = load({ platform: 'win32', bashAll: [GIT_BASH] }).module;
  assert.deepEqual([win.IS_WIN, win.IS_MAC, win.IS_LINUX, win.IS_POSIX], [true, false, false, false]);
});

test('WIN_PATHEXT lowercases every PATHEXT entry', () => {
  const { module } = load({ platform: 'win32', env: { PATHEXT: '.COM;.EXE;.BAT' } });

  assert.deepEqual(module.WIN_PATHEXT, ['.com', '.exe', '.bat']);
});

test('WIN_PATHEXT falls back to a usable list when PATHEXT is unset', () => {
  const { module } = load({ platform: 'win32', env: { PATHEXT: undefined } });

  assert.ok(module.WIN_PATHEXT.length > 0);
  assert.ok(module.WIN_PATHEXT.every((ext) => ext.startsWith('.') && ext === ext.toLowerCase()));
  assert.ok(module.WIN_PATHEXT.includes('.exe'));
});

test('winBash skips the System32 stub and returns the first real bash', () => {
  const { module } = load({
    platform: 'win32',
    bashAll: [SYSTEM32_BASH, GIT_BASH],
  });

  assert.equal(module.winBash(), GIT_BASH);
});

test('winBash asks which for every match without throwing', () => {
  const { module, calls } = load({ platform: 'win32', bashAll: [GIT_BASH] });

  assert.equal(module.winBash(), GIT_BASH);
  assert.deepEqual(calls.which, [['bash', { all: true, nothrow: true }]]);
});

test('winBash matches System32 case-insensitively', () => {
  const lowercase = String.raw`C:\WINDOWS\system32\bash.exe`;
  const { module } = load({
    platform: 'win32',
    bashAll: [lowercase, GIT_BASH],
  });

  assert.equal(module.winBash(), GIT_BASH);
});

test('winBash reports and returns undefined when every candidate is a System32 stub', (t) => {
  const debug = t.mock.method(console, 'debug');
  const { module } = load({
    platform: 'win32',
    bashAll: [SYSTEM32_BASH],
  });

  assert.equal(module.winBash(), undefined);
  assert.deepEqual(
    debug.mock.calls.map((call) => call.arguments),
    [[i18n.t('platform.bashNotFound')]],
  );
});

test('winBash reports and returns undefined when which finds no bash', (t) => {
  const debug = t.mock.method(console, 'debug');
  const { module } = load({ platform: 'win32', bashAll: null });

  assert.equal(module.winBash(), undefined);
  assert.deepEqual(
    debug.mock.calls.map((call) => call.arguments),
    [[i18n.t('platform.bashNotFound')]],
  );
});

test('defaultShell returns winBash on Windows', () => {
  const { module } = load({
    platform: 'win32',
    bashAll: [SYSTEM32_BASH, GIT_BASH],
  });

  assert.equal(module.defaultShell(), GIT_BASH);
});

test('defaultShell falls back to the Git install path when winBash finds nothing', (t) => {
  t.mock.method(console, 'debug');
  const { module } = load({ platform: 'win32', bashAll: null });

  assert.equal(module.defaultShell(), GIT_BASH);
});

test('ensureExecutable normalises the path before probing it on Windows', async (t) => {
  const { module, calls } = load({ platform: 'win32', env: { PATHEXT: '.EXE' } });
  const fs = patchFileSystem({ present: (path) => path.endsWith('.exe') });
  t.after(fs.restore);

  await module.ensureExecutable('/c/tools/tool');

  assert.deepEqual(calls.toWindows, ['/c/tools/tool']);
  assert.deepEqual(fs.calls.stat, [String.raw`C:\tools\tool.exe`]);
});

test('ensureExecutable appends WIN_PATHEXT in order and takes the first candidate that exists', async (t) => {
  const { module } = load({ platform: 'win32', env: { PATHEXT: '.COM;.EXE;.BAT' } });
  const fs = patchFileSystem({ present: (path) => path.endsWith('.exe') });
  t.after(fs.restore);

  await module.ensureExecutable('/c/tools/tool');

  assert.deepEqual(fs.calls.existsSync, [String.raw`C:\tools\tool.com`, String.raw`C:\tools\tool.exe`]);
  assert.deepEqual(fs.calls.stat, [String.raw`C:\tools\tool.exe`]);
});

test('ensureExecutable rejects a Windows path with no executable extension', async (t) => {
  const { module } = load({ platform: 'win32', env: { PATHEXT: '.COM;.EXE' } });
  const fs = patchFileSystem({ present: () => false });
  t.after(fs.restore);

  await assert.rejects(module.ensureExecutable('/c/tools/tool'), {
    message: i18n.t('platform.fileNotExecutable'),
  });
  assert.deepEqual(fs.calls.stat, [String.raw`C:\tools\tool`]);
});

test('ensureExecutable accepts a Windows extension listed in WIN_PATHEXT', async (t) => {
  const { module } = load({ platform: 'win32', env: { PATHEXT: '.CUSTOM' } });
  const fs = patchFileSystem({ present: () => false });
  t.after(fs.restore);

  await module.ensureExecutable(String.raw`C:\tools\tool.CUSTOM`);

  assert.deepEqual(fs.calls.stat, [String.raw`C:\tools\tool.CUSTOM`]);
});

test('ensureExecutable rejects a Windows file whose extension is outside WIN_PATHEXT', async (t) => {
  const { module } = load({ platform: 'win32', env: { PATHEXT: '.CUSTOM' } });
  const fs = patchFileSystem({ present: () => false });
  t.after(fs.restore);

  await assert.rejects(module.ensureExecutable(String.raw`C:\tools\notes.txt`), {
    message: i18n.t('platform.fileNotExecutable'),
  });
  await assert.rejects(module.ensureExecutable(String.raw`C:\tools\tool.EXE`), {
    message: i18n.t('platform.fileNotExecutable'),
  });
  assert.deepEqual(fs.calls.stat, [String.raw`C:\tools\notes.txt`, String.raw`C:\tools\tool.EXE`]);
});

test('isExecutableScript matches a Windows extension listed in WIN_PATHEXT', async (t) => {
  const { module } = load({ platform: 'win32', env: { PATHEXT: '.CUSTOM;.BAT' } });
  const fs = patchFileSystem();
  t.after(fs.restore);

  assert.equal(await module.isExecutableScript(String.raw`C:\tools\tool.CUSTOM`), true);
  assert.deepEqual(fs.calls.access, []);
  assert.deepEqual(fs.calls.open, []);
});

test('isExecutableScript rejects a Windows extension outside WIN_PATHEXT', async (t) => {
  const { module } = load({ platform: 'win32', env: { PATHEXT: '.CUSTOM;.BAT' } });
  const fs = patchFileSystem();
  t.after(fs.restore);

  assert.equal(await module.isExecutableScript(String.raw`C:\tools\tool.EXE`), false);
  assert.equal(await module.isExecutableScript(String.raw`C:\tools\notes.txt`), false);
});

test('openAsText hands the exported Windows editor list to open', async () => {
  const { module, calls } = load({ platform: 'win32', bashAll: [GIT_BASH] });

  await module.openAsText(String.raw`C:\tmp\notes.txt`);

  assert.deepEqual(calls.open, [[String.raw`C:\tmp\notes.txt`, { app: { name: module.WIN_EDITORS } }]]);
});

test('WIN_EDITORS is a non-empty, duplicate-free list of editor names', () => {
  const { module } = load({ platform: 'win32' });

  assert.ok(module.WIN_EDITORS.length > 0);
  assert.deepEqual(module.WIN_EDITORS, [...new Set(module.WIN_EDITORS)]);
  assert.ok(module.WIN_EDITORS.every((editor) => typeof editor === 'string' && editor !== ''));
});

test('openAsText resolves with the value open produced', async () => {
  const { module } = load({ platform: 'win32', bashAll: [GIT_BASH], open: async () => 'opened' });

  assert.equal(await module.openAsText('a.txt'), 'opened');
});

test('openAsText propagates failures from open', async () => {
  const failure = new Error('no suitable editor');
  const { module } = load({
    platform: 'win32',
    bashAll: [GIT_BASH],
    open: async () => {
      throw failure;
    },
  });

  await assert.rejects(module.openAsText('/tmp/notes.txt'), failure);
});
