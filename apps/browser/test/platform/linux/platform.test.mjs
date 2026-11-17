import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import { test } from 'node:test';
import i18n from '../../../dist/shared/i18n.js';
import { fakeShell, load, patchExec, patchFileSystem } from '../../helpers/platform.mjs';

test('platform constants reflect the import-time platform', () => {
  const linux = load({ platform: 'linux', bashOne: '/usr/bin/bash' }).module;
  assert.deepEqual([linux.IS_WIN, linux.IS_MAC, linux.IS_LINUX, linux.IS_POSIX], [false, false, true, true]);
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
  assert.deepEqual(fs.calls.existsSync, []);
});

test('ensureExecutable rejects a path that is not a regular file', async (t) => {
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const fs = patchFileSystem({ isFile: false });
  t.after(fs.restore);

  await assert.rejects(module.ensureExecutable('/opt'), { message: i18n.t('platform.fileNotFound') });
  assert.deepEqual(fs.calls.access, []);
});

test('ensureExecutable propagates a missing path', async (t) => {
  const missing = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const fs = patchFileSystem({ statError: missing });
  t.after(fs.restore);

  await assert.rejects(module.ensureExecutable('/opt/gone'), missing);
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

  assert.equal(await module.isExecutableScript('/opt/binary'), false);
});

test('isExecutableScript rejects a POSIX file with a truncated shebang', async (t) => {
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const fs = patchFileSystem({ firstBytes: '#' });
  t.after(fs.restore);

  assert.equal(await module.isExecutableScript('/opt/stub'), false);
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

test('openAsText launches the desktop text editor through the default shell on Linux', async (t) => {
  const { module, calls } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const shell = fakeShell();
  t.after(patchExec(shell.run));

  await module.openAsText('/tmp/notes.txt');

  assert.deepEqual(calls.open, []);
  assert.equal(shell.calls.length, 1);
  assert.equal(shell.calls[0].file, '/usr/bin/bash');
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
  assert.ok(!stdin.script.includes('/tmp/notes.txt'));
  assert.equal(stdin.ended, true);
});

test('openAsText propagates failures from the Linux shell', async (t) => {
  const failure = new Error('gio: command not found');
  const { module } = load({ platform: 'linux', bashOne: '/usr/bin/bash' });
  const shell = fakeShell({ fails: failure });
  t.after(patchExec(shell.run));

  await assert.rejects(module.openAsText('/tmp/notes.txt'), failure);
});
