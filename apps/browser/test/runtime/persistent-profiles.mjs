import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import { registerBeforeQuit, registerWillQuit, removeDirectory } from '../helpers/cleanup-tasks.mjs';
import profiles from '../../dist/main/app/profiles.js';

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-persistent-profiles-'));
fs.mkdirSync(path.join(profile, 'test-parent'));
app.setPath('userData', path.join(profile, 'test-parent'));
const registry = new profiles.ProfileRegistry(profile, 'Personal');
const worker = path.resolve('test/runtime/fixtures/profile-worker.mjs');
const children = new Set();
const deadline = setTimeout(() => app.exit(1), 35_000);
function launch(id, mode, value) {
  const child = spawn(
    process.execPath,
    [worker, `--yalqen-profile=${id}`, `--test-root=${profile}`, `--test-mode=${mode}`, `--test-value=${value}`],
    { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } },
  );
  children.add(child);
  const completion = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      children.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`Profile worker exited ${code}`));
    });
  });
  return { child, completion };
}
async function eventually(predicate) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > 5000) throw new Error('Profile worker did not report readiness');
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
}
app
  .whenReady()
  .then(async () => {
    const work = registry.create('Work');
    await launch('default', 'write', 'personal').completion;
    await launch(work.id, 'write', 'work').completion;
    await Promise.all([launch('default', 'read', 'personal').completion, launch(work.id, 'read', 'work').completion]);
    const running = launch(work.id, 'stay', 'work');
    await eventually(() => fs.existsSync(path.join(profile, 'stay-work.json')));
    const blocked = registry.view('default').profiles.find(({ id }) => id === work.id);
    assert.equal(blocked.running, true);
    assert.throws(() => registry.remove(work.id, 'default'));
    await launch(work.id, 'duplicate', 'work').completion;
    await eventually(() => {
      try {
        return JSON.parse(fs.readFileSync(path.join(profile, 'stay-work.json'), 'utf8')).activated === true;
      } catch {
        // The file is rewritten by the second-instance handler; reading between the
        // create and the write is expected. Poll until the content settles.
        return false;
      }
    });
    assert.equal(JSON.parse(fs.readFileSync(path.join(profile, 'duplicate-work.json'), 'utf8')).primary, false);
    // A second profile remains usable while the first has its own live single-instance lock.
    await launch('default', 'read', 'personal').completion;
    await running.completion;
    registry.remove(work.id, 'default');
    assert.equal(fs.existsSync(path.join(profile, 'profiles', work.id)), false);
    assert.equal(registry.view('default').profiles.length, 1);
    console.log(
      'PASS: independent Electron profile locks, persistent cookie/bookmark/history/settings/encrypted password isolation across restart, existing-instance activation and live-profile deletion protection',
    );
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => app.quit());

registerBeforeQuit(async () => {
  clearTimeout(deadline);
  for (const child of children) child.kill('SIGKILL');
  registry.close();
});

registerWillQuit(async () => {
  await removeDirectory(profile);
});
