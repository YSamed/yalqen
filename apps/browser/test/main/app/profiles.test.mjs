import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { test } from 'node:test';
import profiles from '../../../dist/main/app/profiles.js';

const { ProfileRegistry, profileName, profileArguments, PROFILE_FLAG } = profiles;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-profiles-'));
  const registry = new ProfileRegistry(root, 'Personal');
  t.after(() => {
    registry.close();
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, registry };
}

test('repeated shutdown callbacks can close the registry safely', (t) => {
  const { registry } = fixture(t);
  registry.close();
  assert.doesNotThrow(() => registry.close());
});

test('the original profile retains its existing directory and new names never become paths', (t) => {
  const { root, registry } = fixture(t);
  fs.writeFileSync(path.join(root, 'bookmarks.json'), 'existing personal data');
  let received;
  const original = registry.activate([], (directory) => {
    received = directory;
    return true;
  });
  assert.equal(original.profile.id, 'default');
  assert.equal(received, root);
  const work = registry.create('../../ Work');
  assert.match(work.id, /^[a-f0-9-]{36}$/);
  assert.equal(registry.directory(work.id), path.join(root, 'profiles', work.id));
  assert.equal(fs.readFileSync(path.join(root, 'bookmarks.json'), 'utf8'), 'existing personal data');
  assert.throws(() => registry.directory('../outside'));
  assert.throws(() => registry.activate([`${PROFILE_FLAG}../outside`], () => assert.fail('must not acquire lock')));
});

test('names and default selection persist and relaunch arguments retain the current profile', (t) => {
  const { root, registry } = fixture(t);
  const work = registry.create('  İş   profili  ');
  registry.rename(work.id, 'Business');
  registry.makeDefault(work.id);
  const reopened = new ProfileRegistry(root, 'different default label');
  try {
    assert.equal(reopened.activate([], () => false).profile.id, work.id);
    assert.equal(reopened.view('default').profiles.find(({ id }) => id === work.id).name, 'Business');
    assert.equal(reopened.activate([`${PROFILE_FLAG}default`], () => false).profile.id, 'default');
    assert.deepEqual(profileArguments(['app', `${PROFILE_FLAG}default`, '--other'], work.id), [
      'app',
      '--other',
      `${PROFILE_FLAG}${work.id}`,
    ]);
    assert.throws(() => reopened.activate([`${PROFILE_FLAG}unknown`], () => false));
    assert.throws(() => reopened.activate([`${PROFILE_FLAG}default`, `${PROFILE_FLAG}${work.id}`], () => false));
  } finally {
    reopened.close();
  }
});

test('empty, overly long and control-character names are rejected', (t) => {
  const { registry } = fixture(t);
  for (const value of ['', '   ', 'x'.repeat(81), 'x\ny', 'x\0y', 5, null]) {
    assert.equal(profileName(value), null);
    assert.throws(() => registry.create(value));
  }
  assert.equal(profileName('  Work  '), 'Work');
  assert.equal(registry.view('default').profiles.length, 1);
});

test('current, original and live profiles cannot be removed; inactive data is deleted and default reset', (t) => {
  const { root, registry } = fixture(t);
  const work = registry.create('Work');
  fs.writeFileSync(path.join(registry.directory(work.id), 'cookies'), 'private data');
  assert.throws(() => registry.remove('default', work.id));
  assert.throws(() => registry.remove(work.id, work.id));
  registry.activate([`${PROFILE_FLAG}${work.id}`], () => true);
  assert.throws(() => registry.remove(work.id, 'default'));
  const other = new ProfileRegistry(root, 'Personal');
  try {
    other.activate([`${PROFILE_FLAG}${work.id}`], () => false);
    assert.equal(other.view('default').profiles.find(({ id }) => id === work.id).running, true);
    assert.throws(() => other.remove(work.id, 'default'));
  } finally {
    other.close();
  }
  registry.release();
  registry.makeDefault(work.id);
  registry.remove(work.id, 'default');
  assert.equal(fs.existsSync(path.join(root, 'profiles', work.id)), false);
  assert.equal(registry.activate([], () => false).profile.id, 'default');
});

test('profile directories cannot redirect operations through symbolic links', (t) => {
  const { root, registry } = fixture(t);
  const work = registry.create('Work');
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-outside-profile-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'sentinel'), 'keep');
  const folder = path.join(root, 'profiles', work.id);
  fs.rmSync(folder, { recursive: true });
  fs.symlinkSync(outside, folder);
  assert.throws(() => registry.activate([`${PROFILE_FLAG}${work.id}`], () => false));
  assert.throws(() => registry.remove(work.id, 'default'));
  assert.equal(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8'), 'keep');
});

test('independent processes create profiles concurrently without losing metadata', async (t) => {
  const { root, registry } = fixture(t);
  const modulePath = path.resolve('dist/main/app/profiles.js');
  await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      promisify(execFile)(process.execPath, [
        '-e',
        `
    const { ProfileRegistry } = require(process.argv[1]);
    const registry = new ProfileRegistry(process.argv[2], 'Personal');
    for (let n = 0; n < 4; n++) registry.create('Worker ' + process.argv[3] + '-' + n);
    registry.close();
  `,
        modulePath,
        root,
        String(index),
      ]),
    ),
  );
  const view = registry.view('default');
  assert.equal(view.profiles.length, 17);
  assert.equal(new Set(view.profiles.map(({ id }) => id)).size, 17);
});
