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
      sidebarWidgets: 'media',
      toolbarVisible: 0,
      discardAfterMinutes: 45,
      adBlocking: 'no',
      threatProtection: 'yes',
      httpsOnly: 'yes',
      blockThirdPartyCookies: 1,
      secureDns: 'opendns',
      defaultZoom: 1.3,
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
      transparency: true,
      glassTint: 25,
      startupBehavior: 'restore',
      startupUrls: [],
      panelCollapsed: false,
      panelSide: 'left',
      pinnedDisplay: 'always',
      sidebarVisible: true,
      sidebarWidgets: ['media'],
      toolbarVisible: true,
      toolbarButtons: ['home', 'bookmarks', 'history', 'extensions', 'profile', 'settings', 'screenshot', 'downloads'],
      discardAfterMinutes: 30,
      adBlocking: true,
      threatProtection: true,
      adBlockExceptions: [],
      thirdPartyCookieExceptions: [],
      httpsOnly: false,
      blockThirdPartyCookies: false,
      secureDns: 'automatic',
      defaultZoom: 1,
      interfaceLanguage: 'system',
      pageTranslation: true,
      autoUpdate: true,
      autoUpdateExtensions: true,
      usageCounting: false,
      askBeforeDownload: true,
      downloadDirectory: null,
      welcomeCompleted: false,
      invitationSeen: false,
      displayName: '',
      accentColor: 'orange',
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
  assert.deepEqual(
    sanitizeSettings({ toolbarButtons: ['history', 'bogus', 'technologies', 'history', 'downloads'] }).toolbarButtons,
    ['history', 'downloads', 'settings'],
  );
  assert.deepEqual(sanitizeSettings({ toolbarButtons: [] }).toolbarButtons, ['settings']);
  assert.equal(sanitizeSettings({ toolbarButtons: 'nope' }).toolbarButtons.length, 8);
});

test('the sidebar media player is on by default and stays off once turned off', () => {
  assert.deepEqual(sanitizeSettings({}).sidebarWidgets, ['media']);
  assert.deepEqual(sanitizeSettings({ sidebarWidgets: [] }).sidebarWidgets, []);
  assert.deepEqual(sanitizeSettings({ sidebarWidgets: ['clock', 'media', 'media', 3] }).sidebarWidgets, ['media']);
});

test('the removed ask-where-to-save option keeps downloads prompting', () => {
  assert.equal(sanitizeSettings({ askBeforeDownload: false, askDownloadLocation: true }).askBeforeDownload, true);
  assert.equal(sanitizeSettings({ askBeforeDownload: false }).askBeforeDownload, false);
});

test('download settings persist absolute folders and reject invalid paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-download-settings-'));
  try {
    const store = new SettingsStore(dir);
    const folder = path.join(dir, 'Downloads');
    store.update({ downloadDirectory: folder });
    store.update({ downloadDirectory: 'relative/path' });
    store.update({ downloadDirectory: '/bad\0path' });
    const reloaded = new SettingsStore(dir);
    assert.equal(reloaded.get().downloadDirectory, folder);
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
      toolbarButtons: ['downloads', 'settings'],
      discardAfterMinutes: 0,
      adBlocking: false,
      httpsOnly: true,
      blockThirdPartyCookies: true,
      secureDns: 'quad9',
      defaultZoom: 1.25,
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
    assert.equal(reloaded.pinnedDisplay, 'expanded');
    assert.deepEqual(reloaded.toolbarButtons, ['downloads', 'settings']);
    assert.equal(reloaded.discardAfterMinutes, 0);
    assert.equal(reloaded.adBlocking, false);
    assert.equal(reloaded.httpsOnly, true);
    assert.equal(reloaded.blockThirdPartyCookies, true);
    assert.equal(reloaded.secureDns, 'quad9');
    assert.equal(reloaded.defaultZoom, 1.25);
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

test('the invitation name is trimmed, single-spaced and capped, and the accent stays in the palette', () => {
  const values = sanitizeSettings({ displayName: '  Ada \n  Lovelace\u0007 ', accentColor: 'ocean' });
  assert.equal(values.displayName, 'Ada Lovelace');
  assert.equal(values.accentColor, 'ocean');
  assert.equal(sanitizeSettings({ displayName: 'x'.repeat(80) }).displayName.length, 40);
  assert.equal(sanitizeSettings({ accentColor: '#ff0000' }).accentColor, 'orange');
  assert.equal(sanitizeSettings({ invitationSeen: 'yes' }).invitationSeen, false);
});

test('the glass tint is a whole percentage between 0 and 100', () => {
  assert.equal(sanitizeSettings({}).glassTint, 25);
  assert.equal(sanitizeSettings({ glassTint: 0 }).glassTint, 0);
  assert.equal(sanitizeSettings({ glassTint: 62.6 }).glassTint, 63);
  assert.equal(sanitizeSettings({ glassTint: 180 }).glassTint, 100);
  assert.equal(sanitizeSettings({ glassTint: -4 }).glassTint, 0);
  for (const value of ['40', null, Number.NaN, Infinity])
    assert.equal(sanitizeSettings({ glassTint: value }).glassTint, 25);
});
