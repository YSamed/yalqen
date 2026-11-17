import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fakeShell, load, patchExec, patchFileSystem } from '../../helpers/platform.mjs';

test('platform constants reflect the import-time platform', () => {
  const mac = load({ platform: 'darwin' }).module;
  assert.deepEqual([mac.IS_WIN, mac.IS_MAC, mac.IS_LINUX, mac.IS_POSIX], [false, true, false, true]);
});

test('defaultShell returns /bin/zsh on macOS without consulting which', () => {
  const { module, calls } = load({ platform: 'darwin' });

  assert.equal(module.defaultShell(), '/bin/zsh');
  assert.deepEqual(calls.which, []);
});

test('ensureExecutable propagates a denied execute bit', async (t) => {
  const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  const { module } = load({ platform: 'darwin' });
  const fs = patchFileSystem({ accessError: denied });
  t.after(fs.restore);

  await assert.rejects(module.ensureExecutable('/opt/tool'), denied);
});

test('isExecutableScript rejects a POSIX file without the execute bit', async (t) => {
  const denied = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
  const { module } = load({ platform: 'darwin' });
  const fs = patchFileSystem({ accessError: denied });
  t.after(fs.restore);

  assert.equal(await module.isExecutableScript('/opt/tool'), false);
  assert.deepEqual(fs.calls.open, []);
});

test('openAsText uses the absolute /usr/bin/open -t on macOS', async (t) => {
  const { module, calls } = load({ platform: 'darwin' });
  const shell = fakeShell();
  t.after(patchExec(shell.run));

  await module.openAsText('/tmp/notes.txt');

  assert.deepEqual(calls.open, []);
  assert.deepEqual(
    shell.calls.map(({ file, args }) => [file, args]),
    [['/usr/bin/open', ['-t', '/tmp/notes.txt']]],
  );
});
