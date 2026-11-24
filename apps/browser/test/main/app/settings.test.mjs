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
      sidebarWidgets: 'media',
      discardAfterMinutes: 45,
      autoArchiveHours: 5,
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
      agentFloating: 'yes',
    }),
    {
      version: 1,
      searchEngine: 'google',
      customSearchTemplate: null,
      theme: 'light',
      darkSites: false,
      frameTheme: { colors: ['#de5a92'], intensity: 50, texture: 'none', textureStrength: 40 },
      startupBehavior: 'restore',
      startupUrls: [],
      spaceRules: [],
      panelCollapsed: true,
      pinnedTabsStayHome: false,
      manualTabCleanup: false,
      tabModes: false,
      autoDeveloperMode: true,
      bookmarksPanel: false,
      touchIdPasskeys: false,
      sidebarWidgets: ['media'],
      sidebarFooterItems: ['spaces', 'downloads', 'screenshot'],
      discardAfterMinutes: 30,
      autoArchiveHours: 0,
      adBlocking: true,
      threatProtection: true,
      adBlockExceptions: [],
      thirdPartyCookieExceptions: [],
      httpsOnly: false,
      stripTrackingOnCopy: true,
      blockThirdPartyCookies: false,
      clearOnExit: false,
      blockedPermissionRequests: [],
      secureDns: 'automatic',
      defaultZoom: 1,
      interfaceLanguage: 'system',
      pageTranslation: true,
      miniWindow: true,
      pictureInPicture: false,
      autoUpdate: true,
      autoUpdateExtensions: true,
      usageCounting: false,
      askBeforeDownload: true,
      downloadDirectory: null,
      welcomeCompleted: false,
      invitationSeen: false,
      displayName: '',
      accentColor: 'orange',
      windowColor: 'none',
      dismissedAnnouncement: '',
      dismissedFeedback: '',
      dismissedUpdate: '',
      agentBridge: false,
      agentOrigins: [],
      agentActions: 'ask',
      agentTracing: false,
      agentTerminal: false,
      agentFloating: false,
      recentTabCycling: true,
      shortcuts: {},
    },
  );
  assert.equal(sanitizeSettings(null).searchEngine, 'google');
  assert.equal(sanitizeSettings({ customSearchTemplate: '  ' }).customSearchTemplate, null);
});

test('keeping pinned tabs on their site is off by default and kept once turned on', () => {
  assert.equal(sanitizeSettings(null).pinnedTabsStayHome, false);
  assert.equal(sanitizeSettings({ pinnedTabsStayHome: true }).pinnedTabsStayHome, true);
  assert.equal(sanitizeSettings({ pinnedTabsStayHome: 'yes' }).pinnedTabsStayHome, false);
  assert.equal(sanitizeSettings(null).stripTrackingOnCopy, true);
  assert.equal(sanitizeSettings({ stripTrackingOnCopy: false }).stripTrackingOnCopy, false);
  assert.equal(sanitizeSettings({ stripTrackingOnCopy: 'no' }).stripTrackingOnCopy, true);
});

test('the button to close idle tabs is off by default and kept once turned on', () => {
  assert.equal(sanitizeSettings(null).manualTabCleanup, false);
  assert.equal(sanitizeSettings({ manualTabCleanup: true }).manualTabCleanup, true);
  assert.equal(sanitizeSettings({ manualTabCleanup: 1 }).manualTabCleanup, false);
});

test('local addresses open in Developer Mode unless the setting is turned off', () => {
  assert.equal(sanitizeSettings(null).autoDeveloperMode, true);
  assert.equal(sanitizeSettings({ autoDeveloperMode: false }).autoDeveloperMode, false);
  assert.equal(sanitizeSettings({ autoDeveloperMode: 'no' }).autoDeveloperMode, true);
});

test('the bookmarks side panel is off by default and kept once turned on', () => {
  assert.equal(sanitizeSettings(null).bookmarksPanel, false);
  assert.equal(sanitizeSettings({ bookmarksPanel: true }).bookmarksPanel, true);
  assert.equal(sanitizeSettings({ bookmarksPanel: 'yes' }).bookmarksPanel, false);
});

test('recent tab cycling is on by default and can be turned off', () => {
  assert.equal(sanitizeSettings(null).recentTabCycling, true);
  assert.equal(sanitizeSettings({ recentTabCycling: false }).recentTabCycling, false);
  assert.equal(sanitizeSettings({ recentTabCycling: 'no' }).recentTabCycling, true);
});

test('shortcut overrides keep only known commands with valid key combinations', () => {
  assert.deepEqual(
    sanitizeSettings({
      shortcuts: {
        newTab: 'cmdorctrl + alt + t',
        reload: 'CmdOrCtrl+R',
        closeTab: 'Hyper+W',
        unknown: 'Ctrl+U',
        find: 7,
      },
    }).shortcuts,
    { newTab: 'CmdOrCtrl+Alt+T' },
  );
  assert.deepEqual(sanitizeSettings({ shortcuts: 'Ctrl+T' }).shortcuts, {});
});

test('Touch ID passkeys are off by default and kept once turned on', () => {
  assert.equal(sanitizeSettings(null).touchIdPasskeys, false);
  assert.equal(sanitizeSettings({ touchIdPasskeys: true }).touchIdPasskeys, true);
  assert.equal(sanitizeSettings({ touchIdPasskeys: 1 }).touchIdPasskeys, false);
});

test('tab modes are off by default and kept once turned on', () => {
  assert.equal(sanitizeSettings(null).tabModes, false);
  assert.equal(sanitizeSettings({ tabModes: true }).tabModes, true);
  assert.equal(sanitizeSettings({ tabModes: 'on' }).tabModes, false);
});

test('the sidebar media player is on by default and stays off once turned off', () => {
  assert.deepEqual(sanitizeSettings({}).sidebarWidgets, ['media']);
  assert.deepEqual(sanitizeSettings({ sidebarWidgets: [] }).sidebarWidgets, []);
  assert.deepEqual(sanitizeSettings({ sidebarWidgets: ['clock', 'media', 'media', 3] }).sidebarWidgets, ['media']);
});

test('clearing site data on quit is off by default and kept once turned on', () => {
  assert.equal(sanitizeSettings(null).clearOnExit, false);
  assert.equal(sanitizeSettings({ clearOnExit: true }).clearOnExit, true);
  assert.equal(sanitizeSettings({ clearOnExit: 'yes' }).clearOnExit, false);
});

test('blocked permission requests keep known prompt kinds once, never popups', () => {
  assert.deepEqual(sanitizeSettings(null).blockedPermissionRequests, []);
  assert.deepEqual(
    sanitizeSettings({
      blockedPermissionRequests: ['notifications', 'popups', 'notifications', 'midi', 3, 'geolocation'],
    }).blockedPermissionRequests,
    ['geolocation', 'notifications'],
  );
  assert.deepEqual(sanitizeSettings({ blockedPermissionRequests: 'camera' }).blockedPermissionRequests, []);
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
      discardAfterMinutes: 0,
      autoArchiveHours: 24,
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
    assert.equal(reloaded.discardAfterMinutes, 0);
    assert.equal(reloaded.autoArchiveHours, 24);
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

test('space rules keep only valid, unique entries and cap at fifty', () => {
  const rules = sanitizeSettings({
    spaceRules: [
      { host: ' GitHub.com ', path: '/org/', space: 'work' },
      { host: 'github.com', path: '/org', space: 'other' },
      { host: 'example.com', space: '' },
      { host: 'https://example.com', space: 'work' },
      { host: 'example.com:8080', space: 'work' },
      { host: 'a.test', path: 'no-slash', space: 'work' },
      { host: 'a.test', path: '/x?y', space: 'work' },
      { host: 'a.test', space: 7 },
      'github.com',
      null,
    ],
  }).spaceRules;
  assert.deepEqual(rules, [
    { host: 'github.com', path: '/org', space: 'work' },
    { host: 'example.com', path: '', space: '' },
  ]);
  const many = Array.from({ length: 80 }, (_, i) => ({ host: `site${i}.test`, space: 'work' }));
  assert.equal(sanitizeSettings({ spaceRules: many }).spaceRules.length, 50);
  assert.deepEqual(sanitizeSettings({ spaceRules: 'x' }).spaceRules, []);
});

test('frame theme keeps valid colors and clamps its numbers', () => {
  const theme = sanitizeSettings({
    frameTheme: {
      colors: ['#FF0000', 'red', 7, '#00ff00', '#0000ff', '#ffffff'],
      intensity: 140,
      texture: 'dots',
      textureStrength: -5,
    },
  }).frameTheme;
  assert.deepEqual(theme, {
    colors: ['#ff0000', '#00ff00', '#0000ff'],
    intensity: 100,
    texture: 'dots',
    textureStrength: 0,
  });
});

test('frame theme falls back to defaults for unknown values', () => {
  const theme = sanitizeSettings({
    frameTheme: { colors: [], texture: 'stripes', intensity: 'x' },
  }).frameTheme;
  assert.deepEqual(theme, sanitizeSettings({}).frameTheme);
  assert.deepEqual(sanitizeSettings({ frameTheme: null }).frameTheme, sanitizeSettings({}).frameTheme);
});
