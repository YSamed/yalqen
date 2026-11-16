import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { test } from 'node:test';
import i18n from '../../dist/shared/i18n.js';

const require = createRequire(import.meta.url);

const PLATFORM_MODULE = require.resolve('../../dist/main/platform.js');
const WHICH_MODULE = require.resolve('which');
const OPEN_MODULE = require.resolve('open');

// platform.js snapshots the platform into IS_WIN/IS_MAC/IS_LINUX/IS_POSIX at import time, so every
// case has to be exercised through a fresh import with process.platform and the which/open
// dependencies stubbed up front. defaultShell() resolves lazily on its first call, so the import
// itself never reaches which.
function restore(key, saved) {
  if (saved) require.cache[key] = saved;
  else delete require.cache[key];
}

function load({ platform, bashAll = [], bashOne, open: openImpl }) {
  const originalPlatform = process.platform;
  const savedWhich = require.cache[WHICH_MODULE];
  const savedOpen = require.cache[OPEN_MODULE];
  const calls = { which: [], open: [] };
  // Mutable so a test can change what which reports after the shell has already been cached.
  const state = { bashAll, bashOne };

  require.cache[WHICH_MODULE] = {
    id: WHICH_MODULE,
    filename: WHICH_MODULE,
    loaded: true,
    exports: {
      sync: (command, options) => {
        calls.which.push([command, options]);
        // which.sync returns an array with { all: true } and a single path otherwise; with
        // { nothrow: true } it returns null when nothing matches.
        return options?.all ? state.bashAll : state.bashOne;
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

  return { module, error, calls, state };
}

// openAsText on Linux pipes a script into the shell via promisify(execFile)(shell, ['-s']). The
// compiled module reads execFile off the shared node:child_process object at call time, so
// replacing the property is enough — but the stub has to expose promisify.custom, since that is
// the form the module actually invokes.
function patchExec(run) {
  const original = childProcess.execFile;
  const stub = () => {
    throw new Error('execFile was called in its callback form');
  };
  stub[promisify.custom] = run;
  childProcess.execFile = stub;
  return () => {
    childProcess.execFile = original;
  };
}

function fakeShell({ fails } = {}) {
  const calls = [];
  return {
    calls,
    run: (file, args, options) => {
      const stdin = {
        script: '',
        ended: false,
        write(chunk) {
          this.script += chunk;
          return true;
        },
        end() {
          this.ended = true;
        },
      };
      calls.push({ file, args, options, stdin });
      const settled = fails ? Promise.reject(fails) : Promise.resolve({ stdout: '', stderr: '' });
      return Object.assign(settled, { child: { stdin } });
    },
  };
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

test('an unrecognised platform imports but rejects once the shell is resolved', () => {
  const { error, module } = load({ platform: 'aix' });

  assert.equal(error, undefined);
  assert.deepEqual([module.IS_WIN, module.IS_MAC, module.IS_LINUX, module.IS_POSIX], [false, false, false, false]);
  // defaultShell() resolves lazily, so the failure surfaces on first use rather than at import.
  assert.throws(() => module.defaultShell(), { message: i18n.t('platform.unsupported') });
  // A failed resolution is not cached, so a second call reports the same error.
  assert.throws(() => module.defaultShell(), { message: i18n.t('platform.unsupported') });
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
  // which returns null rather than [] when { all: true, nothrow: true } matches nothing.
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

test('defaultShell returns /bin/zsh on macOS without consulting which', () => {
  const { module, calls } = load({ platform: 'darwin' });

  assert.equal(module.defaultShell(), '/bin/zsh');
  assert.deepEqual(calls.which, []);
});

test('defaultShell returns the bash path on Linux', () => {
  const { module, calls } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });

  assert.equal(module.defaultShell(), '/usr/bin/bash');
  assert.deepEqual(calls.which, [['bash', { nothrow: true }]]);
});

test('defaultShell falls back to /bin/sh when which finds nothing', () => {
  const { module } = load({ platform: 'linux', bashOne: null });

  assert.equal(module.defaultShell(), '/bin/sh');
});

test('defaultShell resolves lazily and consults which only once', () => {
  const { module, calls } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });

  // Importing the module resolves no shell.
  assert.deepEqual(calls.which, []);
  assert.equal(module.defaultShell(), '/usr/bin/bash');
  assert.equal(module.defaultShell(), '/usr/bin/bash');
  assert.deepEqual(calls.which, [['bash', { nothrow: true }]]);
});

test('defaultShell caches the first resolution', () => {
  const { module, state } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });

  assert.equal(module.defaultShell(), '/usr/bin/bash');
  state.bashOne = '/opt/homebrew/bin/bash';
  assert.equal(module.defaultShell(), '/usr/bin/bash');
});

test('openAsText prefers a list of editors on Windows', async () => {
  const { module, calls } = load({ platform: 'win32', bashAll: [GIT_BASH] });

  await module.openAsText(String.raw`C:\tmp\notes.txt`);

  assert.deepEqual(calls.open, [
    [String.raw`C:\tmp\notes.txt`, { app: { name: ['zed', 'code', 'subl', 'notepad++', 'notepad'] } }],
  ]);
});

test('openAsText uses the absolute /usr/bin/open -t on macOS', async () => {
  const { module, calls } = load({ platform: 'darwin' });

  await module.openAsText('/tmp/notes.txt');

  assert.deepEqual(calls.open, [['/tmp/notes.txt', { app: { name: '/usr/bin/open', arguments: ['-t'] } }]]);
});

test('openAsText launches the desktop text editor through the default shell on Linux', async (t) => {
  const { module, calls } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const shell = fakeShell();
  t.after(patchExec(shell.run));

  await module.openAsText('/tmp/notes.txt');

  // Linux never goes through the open package — it cannot pick a text editor and forwards -t only.
  assert.deepEqual(calls.open, []);
  assert.equal(shell.calls.length, 1);
  assert.equal(shell.calls[0].file, '/usr/bin/bash');
  assert.deepEqual(shell.calls[0].args, ['-s']);
});

test('openAsText pipes a script that hands the file to the default text editor', async (t) => {
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const shell = fakeShell();
  t.after(patchExec(shell.run));

  await module.openAsText('/tmp/notes.txt');

  const { stdin } = shell.calls[0];
  assert.match(stdin.script, /^DESKTOP_FILE=\$\(xdg-mime query default text\/plain\)/);
  assert.ok(stdin.script.includes('gio launch "$dir/applications/$DESKTOP_FILE" "/tmp/notes.txt"'));
  assert.equal(stdin.ended, true);
});

test('openAsText resolves with the value open produced', async () => {
  const { module } = load({ platform: 'win32', bashAll: [GIT_BASH], open: async () => 'opened' });

  assert.equal(await module.openAsText('a.txt'), 'opened');
});

test('openAsText returns undefined on an unsupported platform', async () => {
  const { module } = load({ platform: 'aix' });

  assert.equal(await module.openAsText('/tmp/notes.txt'), undefined);
});

test('openAsText propagates failures from open', async () => {
  const failure = new Error('no suitable editor');
  const { module } = load({
    platform: 'darwin',
    open: async () => {
      throw failure;
    },
  });

  await assert.rejects(module.openAsText('/tmp/notes.txt'), failure);
});

test('openAsText propagates failures from the Linux shell', async (t) => {
  const failure = new Error('gio: command not found');
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const shell = fakeShell({ fails: failure });
  t.after(patchExec(shell.run));

  await assert.rejects(module.openAsText('/tmp/notes.txt'), failure);
});
