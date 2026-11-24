import assert from 'node:assert/strict';
import { test } from 'node:test';
import actionApi from '../../../dist/main/extensions/action-api.js';
import extensions from '../../../dist/main/extensions/extensions.js';

const { ActionApi, badgeColor, iconSource, paintBadgeDot } = actionApi;
const { actionTarget, extensionsMenuTemplate, runAction } = extensions;
const ID = 'a'.repeat(32);
const BASE = `chrome-extension://${ID}/`;

function fakeApi(manifest = { action: { default_popup: 'popup.html', default_title: 'Hello' } }) {
  const extension = { id: ID, url: BASE, name: 'Ext', path: '/ext', manifest };
  const session = { extensions: { getExtension: (id) => (id === ID ? extension : null) } };
  const tabs = new Map([[7, { id: 7 }]]);
  const opened = [];
  const api = new ActionApi(
    session,
    {
      openActionPopup: (windowId, popupUrl) => {
        if (windowId === 99) return 'no-window';
        const url = popupUrl(tabs.get(7));
        if (!url) return 'no-popup';
        opened.push([windowId, url]);
        return 'opened';
      },
    },
    (id) => tabs.get(id) ?? null,
  );
  return { api, tab: tabs.get(7), opened };
}

test('badge colors accept hex and color arrays and refuse anything else', () => {
  assert.deepEqual(badgeColor('#F00'), [255, 0, 0, 255]);
  assert.deepEqual(badgeColor('#1a2b3c'), [26, 43, 60, 255]);
  assert.deepEqual(badgeColor([1, 2, 3, 4]), [1, 2, 3, 4]);
  for (const bad of ['red', '#12', [1, 2, 3], [1, 2, 3, 256], [1.5, 2, 3, 4], null]) {
    assert.throws(() => badgeColor(bad));
  }
});

test('setIcon picks a 16px icon from a path or a size dictionary', () => {
  assert.equal(iconSource({ path: 'icon.png' }), 'icon.png');
  assert.equal(iconSource({ path: { 32: 'big.png', 16: 'small.png' } }), 'small.png');
  assert.equal(iconSource({ imageData: { 48: 'data:image/png;base64,AA==' } }), 'data:image/png;base64,AA==');
  assert.equal(iconSource({ path: '' }), null);
  assert.equal(iconSource({}), null);
});

test('a tab value overrides the global value until the tab closes', () => {
  const { api, tab } = fakeApi();
  api.call(ID, 'setBadgeText', [{ text: '3' }]);
  api.call(ID, 'setBadgeText', [{ text: '9', tabId: 7 }]);
  api.call(ID, 'setTitle', [{ title: 'Tab title', tabId: 7 }]);
  assert.equal(api.call(ID, 'getBadgeText', [{}]), '3');
  assert.equal(api.call(ID, 'getBadgeText', [{ tabId: 7 }]), '9');
  assert.equal(api.state(ID, tab).badge, '9');
  assert.equal(api.state(ID, tab).title, 'Tab title');
  assert.equal(api.state(ID, null).title, 'Hello');
  api.call(ID, 'setBadgeText', [{ text: null, tabId: 7 }]);
  assert.equal(api.call(ID, 'getBadgeText', [{ tabId: 7 }]), '3');
  api.call(ID, 'disable', [7]);
  assert.equal(api.call(ID, 'isEnabled', [7]), false);
  assert.equal(api.call(ID, 'isEnabled', []), true);
  api.dropTab(7);
  assert.equal(api.call(ID, 'isEnabled', [7]), true);
  assert.equal(api.call(ID, 'getTitle', [{ tabId: 7 }]), 'Hello');
  assert.throws(() => api.call(ID, 'getBadgeText', [{ tabId: 8 }]), /No tab with id: 8/);
  assert.throws(() => api.call(ID, 'getBadgeText', [{ tabId: '7' }]), /Invalid tabId/);
  assert.throws(() => api.call('b'.repeat(32), 'getBadgeText', [{}]), /Unknown extension/);
});

test('setPopup overrides the manifest, an empty popup removes it, and outside pages are refused', () => {
  const { api, opened } = fakeApi();
  assert.equal(api.call(ID, 'getPopup', [{}]), `${BASE}popup.html`);
  api.call(ID, 'openPopup', [{}]);
  assert.deepEqual(opened, [[null, `${BASE}popup.html`]]);
  api.call(ID, 'setPopup', [{ popup: 'other.html' }]);
  assert.equal(api.state(ID, null).popupUrl, `${BASE}other.html`);
  assert.throws(() => api.call(ID, 'setPopup', [{ popup: 'https://example.com/' }]), /Invalid popup/);
  api.call(ID, 'setPopup', [{ popup: '' }]);
  assert.equal(api.call(ID, 'getPopup', [{}]), '');
  assert.equal(api.state(ID, null).popupUrl, null);
  assert.throws(() => api.call(ID, 'openPopup', [{}]), /does not have a popup on the active tab/);
});

test('openPopup targets the given window and uses the active tab popup', () => {
  const { api, opened } = fakeApi();
  api.call(ID, 'openPopup', [{ windowId: 5 }]);
  assert.deepEqual(opened, [[5, `${BASE}popup.html`]]);
  assert.throws(() => api.call(ID, 'openPopup', [{ windowId: 99 }]), /No window with id: 99\./);
  assert.throws(() => api.call(ID, 'openPopup', [{ windowId: '5' }]), /Invalid windowId/);
  api.call(ID, 'setPopup', [{ popup: '', tabId: 7 }]);
  assert.throws(() => api.call(ID, 'openPopup', [{ windowId: 5 }]), /does not have a popup on the active tab/);
  assert.equal(opened.length, 1);
  api.call(ID, 'setPopup', [{ popup: 'tab.html', tabId: 7 }]);
  api.call(ID, 'openPopup', [{}]);
  assert.deepEqual(opened[1], [null, `${BASE}tab.html`]);
});

test('colors and titles fall back to defaults, and listeners are forgotten on unload', () => {
  const { api } = fakeApi({});
  assert.deepEqual(api.call(ID, 'getBadgeBackgroundColor', [{}]), [0, 0, 0, 0]);
  api.call(ID, 'setBadgeTextColor', [{ color: '#000' }]);
  assert.deepEqual(api.call(ID, 'getBadgeTextColor', [{}]), [0, 0, 0, 255]);
  assert.equal(api.call(ID, 'getTitle', [{}]), '');
  assert.equal(api.state(ID, null).title, 'Ext');
  assert.throws(() => api.call(ID, 'setIcon', [{}]), /path or imageData/);
  assert.throws(() => api.call(ID, 'setTitle', [{ title: 5 }]), /Invalid title/);
  api.call(ID, 'listen', []);
  assert.equal(api.state(ID, null).listens, true);
  api.forget(ID);
  assert.equal(api.state(ID, null).listens, false);
  assert.throws(() => api.call(ID, 'getTextColor', []), /Unsupported action method/);
});

test('a click opens the popup, then the side panel, then onClicked, then options', () => {
  const action = {
    id: ID,
    title: 'T',
    icon: null,
    popupUrl: 'p',
    optionsUrl: 'o',
    sidePanel: ID,
    sidePanelOnAction: true,
  };
  assert.equal(actionTarget(action), 'popup');
  assert.equal(actionTarget({ ...action, popupUrl: null, listens: true }), 'panel');
  assert.equal(actionTarget({ ...action, popupUrl: null, listens: true, sidePanelOnAction: false }), 'clicked');
  assert.equal(actionTarget({ ...action, popupUrl: null, sidePanelOnAction: false }), 'options');
  assert.equal(actionTarget({ ...action, enabled: false }), null);
  const calls = [];
  runAction(
    { ...action, popupUrl: null, listens: true, sidePanelOnAction: false },
    { openPopup() {}, openOptions() {}, clickAction: (id) => calls.push(id) },
  );
  assert.deepEqual(calls, [ID]);
});

test('the menu shows the badge in the label and disables a disabled action', () => {
  const handlers = { openPopup() {}, openOptions() {}, openStore() {}, manage() {} };
  const [badged, off] = extensionsMenuTemplate(
    [
      { title: 'A', icon: null, popupUrl: 'p', optionsUrl: null, badge: '3' },
      { title: 'B', icon: null, popupUrl: 'p', optionsUrl: null, enabled: false },
    ],
    handlers,
  );
  assert.equal(badged.label, 'A (3)');
  assert.equal(badged.enabled, true);
  assert.equal(off.label, 'B');
  assert.equal(off.enabled, false);
});

test('the badge dot is painted in BGRA order with a light border, in the bottom-right corner', () => {
  const size = { width: 16, height: 16 };
  const empty = Buffer.alloc(16 * 16 * 4);
  const at = (x, y) => (y * 16 + x) * 4;
  const painted = paintBadgeDot(empty, size, [255, 0, 0, 255]);
  assert.deepEqual([...painted.subarray(at(12, 12), at(12, 12) + 4)], [0, 0, 255, 255]);
  assert.deepEqual([...painted.subarray(at(15, 12), at(15, 12) + 4)], [255, 255, 255, 255]);
  assert.deepEqual([...painted.subarray(at(0, 0), at(0, 0) + 4)], [0, 0, 0, 0]);
  assert.deepEqual([...empty.subarray(at(12, 12), at(12, 12) + 4)], [0, 0, 0, 0]);
  const fallback = paintBadgeDot(empty, size, [0, 0, 0, 0]);
  assert.deepEqual([...fallback.subarray(at(12, 12), at(12, 12) + 4)], [0x68, 0x63, 0x5f, 255]);
});

test('the action state carries the badge color, defaulting to unset', () => {
  const { api } = fakeApi();
  assert.deepEqual(api.state(ID, null).badgeColor, [0, 0, 0, 0]);
  api.call(ID, 'setBadgeBackgroundColor', [{ color: '#00f' }]);
  assert.deepEqual(api.state(ID, null).badgeColor, [0, 0, 255, 255]);
});
