// Runs against the compiled main-process modules (npm test builds them first).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import settings from '../dist/main/settings.js';

const { SettingsStore, sanitizeSettings } = settings;

test('unknown or mistyped fields fall back', () => {
  assert.deepEqual(
    sanitizeSettings({ searchEngine: 'altavista', theme: 'blue', panelCollapsed: 'yes', freezeBackgroundTabs: 1, adBlocking: 'no' }),
    {
      version: 1,
      searchEngine: 'google',
      customSearchTemplate: null,
      theme: 'light',
      panelCollapsed: false,
      freezeBackgroundTabs: true,
      adBlocking: true,
    },
  );
  assert.equal(sanitizeSettings(null).searchEngine, 'google');
  assert.equal(sanitizeSettings({ customSearchTemplate: '  ' }).customSearchTemplate, null);
});

test('updates keep valid fields and persist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-settings-'));
  try {
    const store = new SettingsStore(dir);
    store.update({ searchEngine: 'yandex', theme: 'dark', panelCollapsed: true, freezeBackgroundTabs: false, adBlocking: false });
    store.update({ searchEngine: 'nope', theme: 7 });
    assert.equal(store.get().searchEngine, 'yandex');
    assert.equal(store.get().theme, 'dark');

    const reloaded = new SettingsStore(dir).get();
    assert.equal(reloaded.searchEngine, 'yandex');
    assert.equal(reloaded.panelCollapsed, true);
    assert.equal(reloaded.freezeBackgroundTabs, false);
    assert.equal(reloaded.adBlocking, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
