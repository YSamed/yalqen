import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import settings from '../../../dist/main/app/settings.js';

const { SettingsStore, sanitizeSettings } = settings;

test('unknown or mistyped fields fall back', () => {
  assert.deepEqual(
    sanitizeSettings({
      searchEngine: 'altavista',
      theme: 'blue',
      startupBehavior: 'close-all',
      panelCollapsed: 'yes',
      panelSide: 'top',
      pinnedDisplay: 'sometimes',
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
      usageCounting: 'yes',
      agentBridge: 'on',
      agentOrigins: 'https://x.test',
      agentActions: 'always',
      agentTracing: 'yes',
      agentTerminal: 'yes',
    }),
    {
      version: 1,
      searchEngine: 'google',
      customSearchTemplate: null,
      theme: 'light',
      startupBehavior: 'restore',
      panelCollapsed: false,
      panelSide: 'left',
      pinnedDisplay: 'always',
      sidebarVisible: true,
      toolbarVisible: true,
      toolbarTabs: true,
      toolbarButtons: ['bookmarks', 'history', 'extensions', 'profile', 'settings', 'screenshot', 'downloads'],
      freezeBackgroundTabs: true,
      discardAfterMinutes: 30,
      adBlocking: true,
      httpsOnly: false,
      blockThirdPartyCookies: false,
      secureDns: 'automatic',
      fontSize: 'medium',
      defaultZoom: 1,
      pageLanguage: 'tr',
      interfaceLanguage: 'system',
      pageTranslation: true,
      autoUpdate: true,
      usageCounting: false,
      askBeforeDownload: true,
      askDownloadLocation: false,
      downloadDirectory: null,
      welcomeCompleted: false,
      dismissedAnnouncement: '',
      dismissedFeedback: '',
      dismissedUpdate: '',
      agentBridge: false,
      agentOrigins: [],
      agentActions: 'ask',
      agentTracing: false,
      agentTerminal: false,
    },
  );
  assert.equal(sanitizeSettings(null).searchEngine, 'google');
  assert.equal(sanitizeSettings({ customSearchTemplate: '  ' }).customSearchTemplate, null);
});

test('toolbar buttons are deduplicated, filtered and always keep settings', () => {
  assert.deepEqual(sanitizeSettings({ toolbarButtons: ['history', 'bogus', 'history', 'downloads'] }).toolbarButtons, [
    'history',
    'downloads',
    'settings',
  ]);
  assert.deepEqual(sanitizeSettings({ toolbarButtons: [] }).toolbarButtons, ['settings']);
  assert.equal(sanitizeSettings({ toolbarButtons: 'nope' }).toolbarButtons.length, 7);
});

test('download settings persist absolute folders and reject invalid paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-download-settings-'));
  try {
    const store = new SettingsStore(dir);
    const folder = path.join(dir, 'Downloads');
    store.update({ downloadDirectory: folder, askDownloadLocation: true });
    store.update({ downloadDirectory: 'relative/path', askDownloadLocation: 'yes' });
    store.update({ downloadDirectory: '/bad\0path' });
    const reloaded = new SettingsStore(dir);
    assert.equal(reloaded.get().downloadDirectory, folder);
    assert.equal(reloaded.get().askDownloadLocation, true);
    reloaded.update({ downloadDirectory: null });
    assert.equal(new SettingsStore(dir).get().downloadDirectory, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
      pinnedDisplay: 'expanded',
      sidebarVisible: false,
      toolbarVisible: false,
      toolbarTabs: false,
      toolbarButtons: ['downloads', 'settings'],
      freezeBackgroundTabs: false,
      discardAfterMinutes: 0,
      adBlocking: false,
      httpsOnly: true,
      blockThirdPartyCookies: true,
      secureDns: 'quad9',
      fontSize: 'large',
      defaultZoom: 1.25,
      pageLanguage: 'en',
      interfaceLanguage: 'tr',
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
    assert.equal(reloaded.pinnedDisplay, 'expanded');
    assert.deepEqual(reloaded.toolbarButtons, ['downloads', 'settings']);
    assert.equal(reloaded.freezeBackgroundTabs, false);
    assert.equal(reloaded.discardAfterMinutes, 0);
    assert.equal(reloaded.adBlocking, false);
    assert.equal(reloaded.httpsOnly, true);
    assert.equal(reloaded.blockThirdPartyCookies, true);
    assert.equal(reloaded.secureDns, 'quad9');
    assert.equal(reloaded.fontSize, 'large');
    assert.equal(reloaded.defaultZoom, 1.25);
    assert.equal(reloaded.pageLanguage, 'en');
    assert.equal(reloaded.interfaceLanguage, 'tr');
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

test('agent origins keep unique http and https origins only', () => {
  assert.deepEqual(
    sanitizeSettings({
      agentOrigins: ['https://app.ngrok.app/login', 'https://app.ngrok.app', 'ftp://x', 42, 'http://192.168.1.5:3000'],
    }).agentOrigins,
    ['https://app.ngrok.app', 'http://192.168.1.5:3000'],
  );
});
