import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import updaterModule from '../dist/main/updater.js';

const { Updater } = updaterModule;

class FakeBackend extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  logger = console;
  checks = 0;
  installs = 0;

  async checkForUpdates() {
    this.checks++;
    return null;
  }

  quitAndInstall() {
    this.installs++;
  }
}

function setup({ automatic = false } = {}) {
  const backend = new FakeBackend();
  const events = [];
  let loads = 0;
  const updater = new Updater({
    load: () => {
      loads++;
      return backend;
    },
    automatic: () => automatic,
    onChange: () => events.push(updater.status()),
    beforeInstall: () => events.push('before-install'),
  });
  return { backend, events, updater, loads: () => loads };
}

test('without a backend nothing is checked or installed', () => {
  const changes = [];
  const updater = new Updater({
    load: null,
    automatic: () => true,
    onChange: () => changes.push(updater.status()),
    beforeInstall: () => changes.push('before-install'),
  });
  updater.check();
  updater.install();
  assert.deepEqual(updater.status(), { state: 'unavailable' });
  assert.equal(updater.readyVersion(), null);
  assert.deepEqual(changes, []);
});

test('the backend loads on the first check and quietly downloads in the background', () => {
  const { backend, updater, loads } = setup();
  assert.equal(loads(), 0);
  updater.check();
  assert.equal(loads(), 1);
  assert.equal(backend.checks, 1);
  assert.equal(backend.autoDownload, true);
  assert.equal(backend.autoInstallOnAppQuit, true);
  assert.equal(backend.logger, null);
  backend.emit('update-not-available');
  updater.check();
  assert.equal(loads(), 1);
  assert.equal(backend.checks, 2);
});

test('backend events become statuses and a ready update can be installed', () => {
  const { backend, events, updater } = setup();
  updater.check();
  backend.emit('checking-for-update');
  backend.emit('update-available', { version: '0.3.0' });
  backend.emit('download-progress', { percent: 41.7 });
  backend.emit('download-progress', { percent: 41.9 });
  updater.check();
  assert.equal(backend.checks, 1);
  assert.equal(updater.readyVersion(), null);
  backend.emit('update-downloaded', { version: '0.3.0' });
  updater.check();
  assert.equal(backend.checks, 1);
  assert.equal(updater.readyVersion(), '0.3.0');
  updater.install();
  assert.equal(backend.installs, 1);
  assert.deepEqual(events, [
    { state: 'checking' },
    { state: 'downloading', version: '0.3.0', percent: 0 },
    { state: 'downloading', version: '0.3.0', percent: 41 },
    { state: 'ready', version: '0.3.0' },
    'before-install',
  ]);
});

test('an update is not installed before it is ready and a failure allows another check', () => {
  const { backend, updater } = setup();
  updater.check();
  updater.install();
  assert.equal(backend.installs, 0);
  const warn = console.warn;
  console.warn = () => {};
  try {
    backend.emit('error', new Error('offline'));
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(updater.status(), { state: 'failed' });
  updater.check();
  assert.equal(backend.checks, 2);
});

test('automatic checks start only when enabled and stop on request', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const off = setup();
  t.mock.timers.tick(updaterModule.FIRST_CHECK_DELAY_MS);
  assert.equal(off.loads(), 0);

  const on = setup({ automatic: true });
  t.mock.timers.tick(updaterModule.FIRST_CHECK_DELAY_MS);
  assert.equal(on.backend.checks, 1);
  on.backend.emit('update-not-available');
  t.mock.timers.tick(updaterModule.CHECK_INTERVAL_MS);
  assert.equal(on.backend.checks, 2);
  on.updater.stop();
  on.backend.emit('update-not-available');
  t.mock.timers.tick(updaterModule.CHECK_INTERVAL_MS);
  assert.equal(on.backend.checks, 2);
});
