import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, BrowserWindow, session } from 'electron';
import settings from '../../dist/main/app/settings.js';
import ipc from '../../dist/main/app/settings-ipc.js';
import settingsPage from '../../dist/main/app/settings-page.js';
import internal from '../../dist/main/pages/internal-pages.js';
import permissionStores from '../../dist/main/privacy/permissions.js';
import siteStorage from '../../dist/shared/site-storage.js';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-sites-ui-'));
app.setPath('userData', root);
internal.registerInternalScheme();
const rendererErrors = [];
const iconRequests = [];
let window;
const deadline = setTimeout(() => app.exit(1), 30000);
process.on('uncaughtException', (error) => {
  console.error(error);
  app.exit(1);
});
async function eventually(predicate) {
  const start = Date.now();
  while (!(await window.webContents.executeJavaScript(predicate))) {
    if (Date.now() - start > 5000) throw Error(`Timed out: ${predicate}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const run = (script) => window.webContents.executeJavaScript(script);
const site = (domain) => `document.querySelector('li[data-domain=${JSON.stringify(domain)}]')`;
const labelled = (label) => `document.querySelector('#pane [aria-label=${JSON.stringify(label)}]')`;
app
  .whenReady()
  .then(async () => {
    const preferences = new settings.SettingsStore(root);
    preferences.update({
      adBlockExceptions: ['https://example.com'],
      thirdPartyCookieExceptions: ['https://accounts.example.com'],
    });
    const permissions = new permissionStores.PermissionStore(root);
    permissions.set('https://meet.example.com', ['camera'], 'allow');
    ipc.registerSettingsIpc({
      view: () => ({
        values: preferences.get(),
        version: 'test',
        downloadDirectory: root,
        defaultBrowser: true,
        engines: [{ id: 'google', label: 'Google' }],
        customTemplateValid: true,
        update: { state: 'unavailable' },
      }),
      profiles: { view: () => ({ currentId: 'default', profiles: [] }) },
      update: (patch) => preferences.update(patch),
      updateThreatLists: async () => {},
      clearData: async () => {},
      updater: {},
      relaunch() {},
      permissions,
      requestRules: { list: () => [] },
      onRequestRulesSaved() {},
      siteIcons: (domains) => {
        iconRequests.push(...domains);
        return { 'example.com': 'https://icons.invalid/example.png' };
      },
    });
    const stored = [
      { domain: 'example.com', origins: 2, cookies: 12, databaseBytes: 2048 },
      { domain: 'github.com', origins: 3, cookies: 41, databaseBytes: 4096 },
    ];
    settingsPage.handleSettingsCall(siteStorage.SiteStorageChannel.list, (_event, query) => {
      const sites = stored.filter((entry) => entry.domain.includes(query));
      return { sites, total: sites.length, offset: 0, more: false, limited: false };
    });
    const browsing = session.fromPartition('sites-settings');
    internal.serveInternalPages(
      browsing,
      {
        settings: {
          template: fs.readFileSync(path.resolve('dist/renderer/settings.html'), 'utf8'),
          asset: (name) => fs.readFileSync(path.resolve('dist/renderer/assets', name)),
        },
      },
      {},
    );
    window = new BrowserWindow({
      show: false,
      width: 1100,
      height: 1100,
      webPreferences: {
        session: browsing,
        preload: path.resolve('dist/preload/page-preload.js'),
        sandbox: true,
        contextIsolation: true,
      },
    });
    window.webContents.on('console-message', ({ level, message }) => {
      if (level === 'error' && !message.includes('icons.invalid')) rendererErrors.push(message);
    });
    await window.loadURL('yalqen://settings/sites');

    // Permissions, exceptions and stored data for a domain share one row; storage-only sites follow it.
    await eventually(`!!${site('example.com')} && !!${site('github.com')}`);
    assert.deepEqual(
      await run(`[...document.querySelectorAll('li[data-domain]')].map((item) => item.dataset.domain)`),
      ['example.com', 'github.com'],
    );
    const chips = await run(
      `[...${site('example.com')}.querySelectorAll('summary .pill')].map((item) => item.textContent.trim())`,
    );
    assert.deepEqual(chips, ['Camera', 'Ads allowed', 'Cookies allowed']);
    assert.deepEqual([...new Set(iconRequests)].sort(), ['example.com', 'github.com']);
    // A favicon that fails to load falls back to the first letter.
    await eventually(`${site('example.com')}.querySelector('.icon').textContent.trim()==='E'`);

    await run(`${site('example.com')}.querySelector('summary').click()`);
    await eventually(`${site('example.com')}.querySelector('details').open`);
    await eventually(`${site('example.com')}.querySelector('.body').textContent.includes('12 cookies')`);

    await run(`${labelled('Camera for meet.example.com')}.click()`);
    await run(
      `[...document.getElementById(${labelled('Camera for meet.example.com')}.getAttribute('aria-controls')).querySelectorAll('[role=option]')].find((item) => item.textContent.trim()==='Block').click()`,
    );
    await eventually(`${site('example.com')}.querySelector('summary .pill.warn')?.textContent.trim()==='Camera'`);
    assert.equal(permissions.decide('https://meet.example.com', ['camera']), 'deny');

    // A switched-off exception stays listed so it can be switched back on.
    const ads = labelled('Show ads: https://example.com');
    await run(`${ads}.click()`);
    await eventually(`${ads}.getAttribute('aria-checked')==='false'`);
    assert.deepEqual(preferences.get().adBlockExceptions, []);
    await run(`${ads}.click()`);
    await eventually(`${ads}.getAttribute('aria-checked')==='true'`);
    assert.deepEqual(preferences.get().adBlockExceptions, ['https://example.com']);

    await run(
      `[...${site('example.com')}.querySelectorAll('button')].find((item) => item.textContent.trim()==='Reset permissions').click()`,
    );
    await eventually(`!${site('example.com')}.querySelector('summary .pill.warn')`);
    assert.deepEqual(permissions.origins(), []);

    await run(
      `(() => {const input=document.querySelector('.sites-section input[type=search]');input.value='git';input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
    await eventually(`document.querySelectorAll('li[data-domain]').length===1 && !!${site('github.com')}`);

    assert.deepEqual(rendererErrors, []);
    console.log(
      'PASS: sites settings merge permissions, exceptions and stored data per domain, edit them in place, fall back from broken favicons and search the list',
    );
  })
  .then(() => app.quit())
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('before-quit', () => {
  clearTimeout(deadline);
  if (window && !window.isDestroyed()) window.destroy();
});
app.on('quit', () => {
  clearTimeout(deadline);
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
});
