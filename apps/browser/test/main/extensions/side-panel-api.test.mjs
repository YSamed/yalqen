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
