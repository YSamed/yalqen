import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import settings from '../dist/main/settings.js';

const { SettingsStore, sanitizeSettings } = settings;

test('unknown or mistyped fields fall back', () => {
  assert.deepEqual(
    sanitizeSettings({
      searchEngine: 'altavista',
      theme: 'blue',
      startupBehavior: 'close-all',
      panelCollapsed: 'yes',
      panelSide: 'top',
      sidebarVisible: 'no',
      toolbarVisible: 0,
      toolbarTabs: 'no',
      freezeBackgroundTabs: 1,
      discardAfterMinutes: 45,
      adBlocking: 'no',
      httpsOnly: 'yes',
      blockThirdPartyCookies: 1,
      secureDns: 'opendns',
      fontSize: 'huge',
      defaultZoom: 1.3,
      pageLanguage: 'de',
      autoUpdate: 'no',
    }),
    {
      version: 1,
      searchEngine: 'google',
      customSearchTemplate: null,
      theme: 'light',
      startupBehavior: 'restore',
      panelCollapsed: false,
      panelSide: 'left',
      sidebarVisible: true,
      toolbarVisible: true,
      toolbarTabs: true,
      freezeBackgroundTabs: true,
      discardAfterMinutes: 30,
      adBlocking: true,
      httpsOnly: false,
      blockThirdPartyCookies: false,
      secureDns: 'automatic',
      fontSize: 'medium',
      defaultZoom: 1,
      pageLanguage: 'tr',
      pageTranslation: true,
      autoUpdate: true,
      askBeforeDownload: true,
      welcomeCompleted: false,
    },
  );
  assert.equal(sanitizeSettings(null).searchEngine, 'google');
  assert.equal(sanitizeSettings({ customSearchTemplate: '  ' }).customSearchTemplate, null);
});

test('updates keep valid fields and persist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-settings-'));
  try {
    const store = new SettingsStore(dir);
    store.update({
      searchEngine: 'yandex',
      theme: 'dark',
      startupBehavior: 'new-tab',
      panelCollapsed: true,
      panelSide: 'right',
      sidebarVisible: false,
      toolbarVisible: false,
      toolbarTabs: false,
      freezeBackgroundTabs: false,
      discardAfterMinutes: 0,
      adBlocking: false,
      httpsOnly: true,
      blockThirdPartyCookies: true,
      secureDns: 'quad9',
      fontSize: 'large',
      defaultZoom: 1.25,
      pageLanguage: 'en',
      askBeforeDownload: false,
    });
    store.update({ searchEngine: 'nope', theme: 7 });
    assert.equal(store.get().searchEngine, 'yandex');
    assert.equal(store.get().theme, 'dark');

    const reloaded = new SettingsStore(dir).get();
    assert.equal(reloaded.searchEngine, 'yandex');
    assert.equal(reloaded.startupBehavior, 'new-tab');
    assert.equal(reloaded.panelCollapsed, true);
    assert.equal(reloaded.panelSide, 'right');
    assert.equal(reloaded.sidebarVisible, false);
    assert.equal(reloaded.toolbarVisible, false);
    assert.equal(reloaded.toolbarTabs, false);
    assert.equal(reloaded.freezeBackgroundTabs, false);
    assert.equal(reloaded.discardAfterMinutes, 0);
    assert.equal(reloaded.adBlocking, false);
    assert.equal(reloaded.httpsOnly, true);
    assert.equal(reloaded.blockThirdPartyCookies, true);
    assert.equal(reloaded.secureDns, 'quad9');
    assert.equal(reloaded.fontSize, 'large');
    assert.equal(reloaded.defaultZoom, 1.25);
    assert.equal(reloaded.pageLanguage, 'en');
    assert.equal(reloaded.askBeforeDownload, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an update that changes nothing keeps the same settings and skips the write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-settings-'));
  try {
    const store = new SettingsStore(dir);
    const before = store.get();
    assert.equal(store.update({ theme: before.theme, searchEngine: 'nope' }), before);
    assert.equal(fs.existsSync(store.file), false);
    assert.notEqual(store.update({ theme: 'dark' }), before);
    assert.equal(JSON.parse(fs.readFileSync(store.file, 'utf8')).theme, 'dark');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
