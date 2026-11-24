import assert from 'node:assert/strict';
import { test } from 'node:test';
import sidePanelApi from '../../../dist/main/extensions/side-panel-api.js';
import sidePanel from '../../../dist/main/extensions/extension-side-panel.js';
import manifests from '../../../dist/main/extensions/extension-manifest.js';

const { ownPage } = sidePanelApi;
const { SIDE_PANEL_WIDTH, sidePanelBounds } = sidePanel;
const BASE = `chrome-extension://${'a'.repeat(32)}/`;

test('side panel pages must belong to the extension', () => {
  assert.equal(ownPage(BASE, 'offscreen.html'), `${BASE}offscreen.html`);
  assert.equal(ownPage(BASE, '/ui/panel.html?x=1'), `${BASE}ui/panel.html?x=1`);
  assert.equal(ownPage(BASE, 'https://example.com/'), null);
  assert.equal(ownPage(BASE, `chrome-extension://${'b'.repeat(32)}/x.html`), null);
  assert.equal(ownPage(BASE, ''), null);
  assert.equal(ownPage(BASE, 3), null);
});

test('the side panel docks right of the page and the manifest names its page', () => {
  assert.deepEqual(sidePanelBounds({ x: 100, y: 50, width: 600, height: 400 }), {
    x: 708,
    y: 50,
    width: SIDE_PANEL_WIDTH - 8,
    height: 400,
  });
  assert.equal(manifests.sidePanelPage({ side_panel: { default_path: 'panel.html' } }), 'panel.html');
  assert.equal(manifests.sidePanelPage({}), null);
});

function fakePanels() {
  const extension = { url: BASE, manifest: { side_panel: { default_path: 'panel.html' } } };
  const session = { extensions: { getExtension: (id) => (id === 'ext' ? extension : null) } };
  const tabs = new Map([5, 15].map((id) => [id, { id }]));
  const state = { active: 5, open: true, refreshed: [] };
  const host = {
    windowId: () => 1,
    isActive: (tab) => tab.id === state.active,
    sidePanelOpen: () => state.open,
    refreshSidePanel: (windowId) => state.refreshed.push(windowId),
    openSidePanel: () => null,
    closeSidePanel() {},
  };
  const api = new sidePanelApi.SidePanelApi(
    session,
    host,
    () => {},
    (id) => tabs.get(id) ?? null,
  );
  return { api, tabs, state };
}

test('per-tab side panel options override the global ones and refresh an open panel on the active tab', () => {
  const { api, tabs, state } = fakePanels();
  api.call('ext', 'setOptions', [{ path: 'global.html' }]);
  api.call('ext', 'setOptions', [{ tabId: 15, path: 'other.html' }]);
  assert.deepEqual(state.refreshed, []);
  api.call('ext', 'setOptions', [{ tabId: 5, enabled: false }]);
  assert.deepEqual(state.refreshed, [1]);
  state.open = false;
  api.call('ext', 'setOptions', [{ tabId: 5, path: 'own.html' }]);
  assert.deepEqual(state.refreshed, [1]);

  assert.equal(api.panelUrl('ext', null), `${BASE}global.html`);
  assert.equal(api.panelUrl('ext', tabs.get(5)), null);
  assert.equal(api.panelUrl('ext', tabs.get(15)), `${BASE}other.html`);
  assert.equal(api.panelUrl('unknown', tabs.get(15)), null);
});

test('closing a tab drops only its own side panel options', () => {
  const { api, tabs } = fakePanels();
  api.call('ext', 'setOptions', [{ tabId: 5, enabled: false }]);
  api.call('ext', 'setOptions', [{ tabId: 15, path: 'other.html' }]);
  api.dropTab(5);
  assert.equal(api.panelUrl('ext', tabs.get(5)), `${BASE}panel.html`);
  assert.equal(api.panelUrl('ext', tabs.get(15)), `${BASE}other.html`);
});
