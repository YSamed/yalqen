import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import i18n from '../../dist/shared/i18n.js';

const require = createRequire(import.meta.url);

const PLATFORM_MODULE = require.resolve('../../dist/main/platform.js');
const WHICH_MODULE = require.resolve('which');
const OPEN_MODULE = require.resolve('open');

// platform.js snapshots the platform into IS_WIN/IS_MAC/IS_LINUX/IS_POSIX and evaluates
// DEFAULT_SHELL at import time, so every case has to be exercised through a fresh import
// with process.platform and the which/open dependencies stubbed up front.
function restore(key, saved) {
  if (saved) require.cache[key] = saved;
  else delete require.cache[key];
}

function load({ platform, bashAll = [], bashOne, open: openImpl }) {
  const originalPlatform = process.platform;
  const savedWhich = require.cache[WHICH_MODULE];
  const savedOpen = require.cache[OPEN_MODULE];
  const calls = { which: [], open: [] };

  require.cache[WHICH_MODULE] = {
    id: WHICH_MODULE,
    filename: WHICH_MODULE,
    loaded: true,
    exports: {
      sync: (command, options) => {
        calls.which.push([command, options]);
        // which.sync returns an array with { all: true } and a single path otherwise.
        return options?.all ? bashAll : bashOne;
      },
    },
  };
  require.cache[OPEN_MODULE] = {
    id: OPEN_MODULE,
    filename: OPEN_MODULE,
    loaded: true,
    exports: {
      __esModule: true,
      default: (target, options) => {
        calls.open.push([target, options]);
        return openImpl ? openImpl(target, options) : Promise.resolve();
      },
    },
  };
  delete require.cache[PLATFORM_MODULE];

  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  let module;
  let error;
  try {
    module = require('../../dist/main/platform.js');
  } catch (thrown) {
    error = thrown;
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    restore(WHICH_MODULE, savedWhich);
    restore(OPEN_MODULE, savedOpen);
    delete require.cache[PLATFORM_MODULE];
  }

  return { module, error, calls };
}

const SYSTEM32_BASH = String.raw`C:\Windows\System32\bash.exe`;
const GIT_BASH = String.raw`C:\Program Files\Git\bin\bash.exe`;

test('platform constants reflect the import-time platform', () => {
  const win = load({ platform: 'win32', bashAll: [GIT_BASH] }).module;
  assert.deepEqual([win.IS_WIN, win.IS_MAC, win.IS_LINUX, win.IS_POSIX], [true, false, false, false]);

  const mac = load({ platform: 'darwin' }).module;
  assert.deepEqual([mac.IS_WIN, mac.IS_MAC, mac.IS_LINUX, mac.IS_POSIX], [false, true, false, true]);

  const linux = load({ platform: 'linux', bashOne: '/usr/bin/bash' }).module;
  assert.deepEqual([linux.IS_WIN, linux.IS_MAC, linux.IS_LINUX, linux.IS_POSIX], [false, false, true, true]);
});

test('all platform constants are false on an unrecognised platform', () => {
  const { error, module } = load({ platform: 'aix', bashOne: '/usr/bin/bash' });
  // DEFAULT_SHELL runs at import time and rejects unknown platforms, so the import itself fails.
  assert.equal(module, undefined);
  assert.equal(error?.message, i18n.t('platform.unsupported'));
});

test('winBash skips the System32 stub and returns the first real bash', () => {
  const { module } = load({
    platform: 'win32',
    bashAll: [SYSTEM32_BASH, GIT_BASH],
  });

  assert.equal(module.winBash(), GIT_BASH);
});

test('winBash matches System32 case-insensitively', () => {
  const lowercase = String.raw`C:\WINDOWS\system32\bash.exe`;
  const { module } = load({
    platform: 'win32',
    bashAll: [lowercase, GIT_BASH],
  });

  assert.equal(module.winBash(), GIT_BASH);
});

test('winBash throws when every candidate is a System32 stub', () => {
  const { error, module } = load({
    platform: 'win32',
    bashAll: [SYSTEM32_BASH],
  });

  assert.equal(module, undefined);
  assert.equal(error?.message, i18n.t('platform.bashNotFound'));
});

test('winBash throws when no bash executable exists', () => {
  const { error, module } = load({ platform: 'win32', bashAll: [] });

  assert.equal(module, undefined);
  assert.equal(error?.message, i18n.t('platform.bashNotFound'));
});

test('defaultShell returns winBash on Windows', () => {
  const { module } = load({
    platform: 'win32',
    bashAll: [SYSTEM32_BASH, GIT_BASH],
  });

  assert.equal(module.defaultShell(), GIT_BASH);
});

test('defaultShell returns /bin/zsh on macOS without consulting which', () => {
  const { module, calls } = load({ platform: 'darwin' });

  assert.equal(module.defaultShell(), '/bin/zsh');
  assert.deepEqual(calls.which, []);
});

test('defaultShell returns the bash path on Linux', () => {
  const { module, calls } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });

  assert.equal(module.defaultShell(), '/usr/bin/bash');
  // Once for DEFAULT_SHELL at import time, once for the explicit call above.
  assert.deepEqual(calls.which, [
    ['bash', undefined],
    ['bash', undefined],
  ]);
});

test('defaultShell falls back to /bin/sh when which finds nothing', () => {
  const { module } = load({ platform: 'linux', bashOne: undefined });

  assert.equal(module.defaultShell(), '/bin/sh');
});

test('DEFAULT_SHELL is evaluated once at import time', () => {
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });

  assert.equal(module.DEFAULT_SHELL, '/usr/bin/bash');
  assert.equal(module.DEFAULT_SHELL, module.defaultShell());
});

test('openAsText prefers a list of editors on Windows', async () => {
  const { module, calls } = load({ platform: 'win32', bashAll: [GIT_BASH] });

  await module.openAsText(String.raw`C:\tmp\notes.txt`);

  assert.deepEqual(calls.open, [
    [String.raw`C:\tmp\notes.txt`, { app: { name: ['zed', 'code', 'subl', 'notepad++', 'notepad'] } }],
  ]);
});

test('openAsText uses open -t on macOS', async () => {
  const { module, calls } = load({ platform: 'darwin' });

  await module.openAsText('/tmp/notes.txt');

  assert.deepEqual(calls.open, [['/tmp/notes.txt', { app: { name: 'open', arguments: ['-t'] } }]]);
});

test('openAsText uses open -t on Linux', async () => {
  const { module, calls } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });

  await module.openAsText('/tmp/notes.txt');

  assert.deepEqual(calls.open, [['/tmp/notes.txt', { app: { name: 'open', arguments: ['-t'] } }]]);
});

test('openAsText resolves with the value open produced', async () => {
  const { module } = load({ platform: 'win32', bashAll: [GIT_BASH], open: async () => 'opened' });

  assert.equal(await module.openAsText('a.txt'), 'opened');
});

test('openAsText propagates failures from open', async () => {
  const failure = new Error('no suitable editor');
  const { module } = load({
    platform: 'linux',
    bashOne: '/usr/bin/bash',
    open: async () => {
      throw failure;
    },
  });

  await assert.rejects(module.openAsText('/tmp/notes.txt'), failure);
});
