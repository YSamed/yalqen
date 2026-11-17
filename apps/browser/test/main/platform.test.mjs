import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import nodeFs from 'node:fs';
import fsPromises from 'node:fs/promises';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { test } from 'node:test';
import i18n from '../../dist/shared/i18n.js';

const require = createRequire(import.meta.url);

const PLATFORM_MODULE = require.resolve('../../dist/main/platform.js');
const WHICH_MODULE = require.resolve('which');
const OPEN_MODULE = require.resolve('open');
const CYGPATH_MODULE = require.resolve('cygpath');

// Captured before any load() installs a stub, so path conversion stays faithful to production.
const realCygpath = require(CYGPATH_MODULE);

// platform.js snapshots the platform into IS_WIN/IS_MAC/IS_LINUX/IS_POSIX at import time, so every
// case has to be exercised through a fresh import with process.platform and the which/open
// dependencies stubbed up front. defaultShell() resolves lazily on its first call, so the import
// itself never reaches which. `env` only has to survive the import — WIN_PATHEXT is snapshotted
// there.
function restore(key, saved) {
  if (saved) require.cache[key] = saved;
  else delete require.cache[key];
}

function load({ platform, bashAll = [], bashOne, open: openImpl, env = {} }) {
  const originalPlatform = process.platform;
  const savedWhich = require.cache[WHICH_MODULE];
  const savedOpen = require.cache[OPEN_MODULE];
  const savedCygpath = require.cache[CYGPATH_MODULE];
  const calls = { which: [], open: [], toWindows: [] };
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
  require.cache[CYGPATH_MODULE] = {
    id: CYGPATH_MODULE,
    filename: CYGPATH_MODULE,
    loaded: true,
    exports: {
      // Real conversion, recorded so a test can assert the path was normalised before probing.
      toWindows: (target) => {
        calls.toWindows.push(target);
        return realCygpath.toWindows(target);
      },
    },
  };
  delete require.cache[PLATFORM_MODULE];

  const savedEnv = new Map();
  for (const [key, value] of Object.entries(env)) {
    savedEnv.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  let module;
  let error;
  try {
    module = require('../../dist/main/platform.js');
  } catch (thrown) {
    error = thrown;
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    restore(WHICH_MODULE, savedWhich);
    restore(OPEN_MODULE, savedOpen);
    restore(CYGPATH_MODULE, savedCygpath);
    delete require.cache[PLATFORM_MODULE];
  }

  return { module, error, calls, state };
}

// Builtins are not reachable through require.cache, so the compiled module's calls into
// node:child_process, node:fs and node:fs/promises are redirected by swapping properties on the
// shared exports objects it dereferences at call time. Each helper returns its own restorer.
function replaceProperties(target, values) {
  const originals = new Map();
  for (const [key, value] of Object.entries(values)) {
    originals.set(key, target[key]);
    target[key] = value;
  }
  return () => {
    for (const [key, value] of originals) target[key] = value;
  };
}

// execFile is reached through promisify, which prefers the function's promisify.custom symbol over
// wrapping the callback form — a stub without it would never be called.
function patchExec(run) {
  const stub = () => {
    throw new Error('execFile was called in its callback form');
  };
  stub[promisify.custom] = run;
  return replaceProperties(childProcess, { execFile: stub });
}

function patchFileSystem({ isFile = true, statError, accessError, present = () => false, firstBytes = '' } = {}) {
  const calls = { stat: [], access: [], existsSync: [], open: [], close: [] };
  const restorePromises = replaceProperties(fsPromises, {
    stat: (target) => {
      calls.stat.push(target);
      return statError ? Promise.reject(statError) : Promise.resolve({ isFile: () => isFile });
    },
    access: (target, mode) => {
      calls.access.push([target, mode]);
      return accessError ? Promise.reject(accessError) : Promise.resolve();
    },
    open: async (target, flags) => {
      calls.open.push([target, flags]);
      return {
        read: async (buffer, offset, length) => {
          const bytes = Buffer.from(firstBytes);
          const read = Math.min(bytes.length, length);
          buffer.set(bytes.subarray(0, read), offset);
          return { bytesRead: read };
        },
        close: async () => {
          calls.close.push(target);
        },
      };
    },
  });
  const restoreExists = replaceProperties(nodeFs, {
    existsSync: (target) => {
      calls.existsSync.push(target);
      return present(target);
    },
  });

  return {
    calls,
    restore: () => {
      restorePromises();
      restoreExists();
    },
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

test('WIN_PATHEXT lowercases every PATHEXT entry', () => {
  const { module } = load({ platform: 'win32', env: { PATHEXT: '.COM;.EXE;.BAT' } });

  assert.deepEqual(module.WIN_PATHEXT, ['.com', '.exe', '.bat']);
});

test('WIN_PATHEXT falls back to a usable list when PATHEXT is unset', () => {
  const { module } = load({ platform: 'win32', env: { PATHEXT: undefined } });

  // The membership is the module's own call, so the assertion stays off the source literal: what
  // callers rely on is a non-empty, lowercase, dot-prefixed lookup table that can name a .exe.
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

test('ensureExecutable resolves once the execute bit is confirmed', async (t) => {
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const fs = patchFileSystem();
  t.after(fs.restore);

  await module.ensureExecutable('/opt/tool');

  assert.deepEqual(fs.calls.stat, ['/opt/tool']);
  assert.deepEqual(fs.calls.access, [['/opt/tool', fsPromises.constants.X_OK]]);
  // existsSync only serves the Windows candidate probe.
  assert.deepEqual(fs.calls.existsSync, []);
});

test('ensureExecutable rejects a path that is not a regular file', async (t) => {
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const fs = patchFileSystem({ isFile: false });
  t.after(fs.restore);

  await assert.rejects(module.ensureExecutable('/opt'), { message: i18n.t('platform.fileNotFound') });
  // A directory never reaches the execute-bit probe.
  assert.deepEqual(fs.calls.access, []);
});

test('ensureExecutable propagates a missing path', async (t) => {
  const missing = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const fs = patchFileSystem({ statError: missing });
  t.after(fs.restore);

  await assert.rejects(module.ensureExecutable('/opt/gone'), missing);
});

test('ensureExecutable propagates a denied execute bit', async (t) => {
  const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  const { module } = load({ platform: 'darwin' });
  const fs = patchFileSystem({ accessError: denied });
  t.after(fs.restore);

  await assert.rejects(module.ensureExecutable('/opt/tool'), denied);
});

test('ensureExecutable normalises the path before probing it on Windows', async (t) => {
  const { module, calls } = load({ platform: 'win32', env: { PATHEXT: '.EXE' } });
  const fs = patchFileSystem({ present: (path) => path.endsWith('.exe') });
  t.after(fs.restore);

  await module.ensureExecutable('/c/tools/tool');

  // A Cygwin-style path is converted before any candidate is built from it.
  assert.deepEqual(calls.toWindows, ['/c/tools/tool']);
  assert.deepEqual(fs.calls.stat, [String.raw`C:\tools\tool.exe`]);
});

test('ensureExecutable appends WIN_PATHEXT in order and takes the first candidate that exists', async (t) => {
  const { module } = load({ platform: 'win32', env: { PATHEXT: '.COM;.EXE;.BAT' } });
  const fs = patchFileSystem({ present: (path) => path.endsWith('.exe') });
  t.after(fs.restore);

  await module.ensureExecutable('/c/tools/tool');

  // .com is probed first and the search continues past the miss, ending on .exe.
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
  // With no candidate on disk the bare normalised path is what gets inspected.
  assert.deepEqual(fs.calls.stat, [String.raw`C:\tools\tool`]);
});

// PATHEXT here omits every standard extension: the module has to accept what its own snapshot
// lists, so a name that re-inlined the usual four would reject this and pass the .exe case below.
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

test('ensureExecutable checks nothing beyond existence on an unsupported platform', async (t) => {
  const { module } = load({ platform: 'aix' });
  const fs = patchFileSystem();
  t.after(fs.restore);

  await module.ensureExecutable('/opt/tool');

  assert.deepEqual(fs.calls.stat, ['/opt/tool']);
  assert.deepEqual(fs.calls.access, []);
  assert.deepEqual(fs.calls.existsSync, []);
});

test('isExecutableScript accepts a POSIX file that opens with a shebang', async (t) => {
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const fs = patchFileSystem({ firstBytes: '#!' });
  t.after(fs.restore);

  assert.equal(await module.isExecutableScript('/opt/tool'), true);
  assert.deepEqual(fs.calls.access, [['/opt/tool', fsPromises.constants.X_OK]]);
  assert.equal(fs.calls.close.length, 1);
});

test('isExecutableScript rejects a POSIX file without a shebang', async (t) => {
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const fs = patchFileSystem({ firstBytes: 'no' });
  t.after(fs.restore);

  // An executable binary is not a script, so claude-setup must not feed it to the shell.
  assert.equal(await module.isExecutableScript('/opt/binary'), false);
});

test('isExecutableScript rejects a POSIX file with a truncated shebang', async (t) => {
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const fs = patchFileSystem({ firstBytes: '#' });
  t.after(fs.restore);

  assert.equal(await module.isExecutableScript('/opt/stub'), false);
});

test('isExecutableScript rejects a POSIX file without the execute bit', async (t) => {
  const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  const { module } = load({ platform: 'darwin' });
  const fs = patchFileSystem({ accessError: denied });
  t.after(fs.restore);

  assert.equal(await module.isExecutableScript('/opt/tool'), false);
  // The read is skipped once the execute bit fails.
  assert.deepEqual(fs.calls.open, []);
});

test('isExecutableScript rejects a path that is not a regular file', async (t) => {
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const fs = patchFileSystem({ isFile: false });
  t.after(fs.restore);

  assert.equal(await module.isExecutableScript('/opt'), false);
});

test('isExecutableScript reports a missing path as not executable', async (t) => {
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const fs = patchFileSystem({ statError: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) });
  t.after(fs.restore);

  assert.equal(await module.isExecutableScript('/opt/gone'), false);
});

// PATHEXT below is deliberately not the default list: the module must read its own WIN_PATHEXT
// snapshot, and a fixture that matched the fallback literal would pass even if it re-inlined one.
test('isExecutableScript matches a Windows extension listed in WIN_PATHEXT', async (t) => {
  const { module } = load({ platform: 'win32', env: { PATHEXT: '.CUSTOM;.BAT' } });
  const fs = patchFileSystem();
  t.after(fs.restore);

  assert.equal(await module.isExecutableScript(String.raw`C:\tools\tool.CUSTOM`), true);
  // Windows decides on the extension alone, so nothing is read or permission-checked.
  assert.deepEqual(fs.calls.access, []);
  assert.deepEqual(fs.calls.open, []);
});

test('isExecutableScript rejects a Windows extension outside WIN_PATHEXT', async (t) => {
  const { module } = load({ platform: 'win32', env: { PATHEXT: '.CUSTOM;.BAT' } });
  const fs = patchFileSystem();
  t.after(fs.restore);

  // .exe is absent from this PATHEXT, so a name that re-inlined the standard list would pass it.
  assert.equal(await module.isExecutableScript(String.raw`C:\tools\tool.EXE`), false);
  assert.equal(await module.isExecutableScript(String.raw`C:\tools\notes.txt`), false);
});

test('openAsText hands the exported Windows editor list to open', async () => {
  const { module, calls } = load({ platform: 'win32', bashAll: [GIT_BASH] });

  await module.openAsText(String.raw`C:\tmp\notes.txt`);

  // Asserting against the exported list keeps the test off a second copy of the editor names.
  assert.deepEqual(calls.open, [[String.raw`C:\tmp\notes.txt`, { app: { name: module.WIN_EDITORS } }]]);
});

test('WIN_EDITORS is a non-empty, duplicate-free list of editor names', () => {
  const { module } = load({ platform: 'win32' });

  assert.ok(module.WIN_EDITORS.length > 0);
  assert.deepEqual(module.WIN_EDITORS, [...new Set(module.WIN_EDITORS)]);
  assert.ok(module.WIN_EDITORS.every((editor) => typeof editor === 'string' && editor !== ''));
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
  // The file travels as a positional argument, after the -- that ends shell option parsing.
  assert.deepEqual(shell.calls[0].args, ['-s', '--', '/tmp/notes.txt']);
});

test('openAsText keeps the Linux path out of the piped script body', async (t) => {
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const shell = fakeShell();
  t.after(patchExec(shell.run));

  await module.openAsText('/tmp/notes.txt');

  const { stdin } = shell.calls[0];
  assert.match(stdin.script, /^DESKTOP_FILE=\$\(xdg-mime query default text\/plain\)/);
  assert.ok(stdin.script.includes('gio launch "$dir/applications/$DESKTOP_FILE" "$1"'));
  // Interpolating the path would let a filename with a quote break out of the quoted argument.
  assert.ok(!stdin.script.includes('/tmp/notes.txt'));
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
