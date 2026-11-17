import assert from 'node:assert/strict';
import { test } from 'node:test';
import i18n from '../../dist/shared/i18n.js';
import { load, patchFileSystem } from '../helpers/platform.mjs';

test('an unrecognised platform imports but rejects once the shell is resolved', () => {
  const { module } = load({ platform: 'aix' });

  assert.deepEqual([module.IS_WIN, module.IS_MAC, module.IS_LINUX, module.IS_POSIX], [false, false, false, false]);
  assert.throws(() => module.defaultShell(), { message: i18n.t('platform.unsupported') });
  assert.throws(() => module.defaultShell(), { message: i18n.t('platform.unsupported') });
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

test('openAsText returns undefined on an unsupported platform', async () => {
  const { module } = load({ platform: 'aix' });

  assert.equal(await module.openAsText('/tmp/notes.txt'), undefined);
});
