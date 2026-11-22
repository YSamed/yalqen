import assert from 'node:assert/strict';
import { test } from 'node:test';
import menusModule from '../../../dist/main/extensions/extension-menus.js';

const { ExtensionMenus } = menusModule;
const ID = 'abcdefghijklmnopabcdefghijklmnop';
const context = (overrides = {}) => ({
  linkURL: '',
  srcURL: '',
  mediaType: 'none',
  selectionText: '',
  isEditable: false,
  pageURL: 'https://example.com/',
  frameURL: '',
  ...overrides,
});
const labels = (items) => items.map((item) => (item.submenu ? { [item.label]: labels(item.submenu) } : item.label));
const shown = (menus, overrides) => labels(menus.template(ID, 'Ext', context(overrides), () => {}));

test('a single top-level item shows directly and several group under the extension name', () => {
  const menus = new ExtensionMenus();
  menus.call(ID, 'create', [{ id: 'fill', title: 'Fill' }]);
  assert.deepEqual(shown(menus), ['Fill']);
  menus.call(ID, 'create', [{ id: 'copy', title: 'Copy' }]);
  assert.deepEqual(shown(menus), [{ Ext: ['Fill', 'Copy'] }]);
  assert.deepEqual(
    menus.template('other', 'Other', context(), () => {}),
    [],
  );
});

test('items follow contexts, children and url patterns', () => {
  const menus = new ExtensionMenus();
  menus.call(ID, 'create', [{ id: 'root', title: 'Vault', contexts: ['all'] }]);
  menus.call(ID, 'create', [{ id: 'fill', parentId: 'root', title: 'Fill', contexts: ['editable'] }]);
  menus.call(ID, 'create', [{ id: 'find', parentId: 'root', title: 'Find "%s"', contexts: ['selection'] }]);
  menus.call(ID, 'create', [
    { id: 'link', title: 'Save link', contexts: ['link'], targetUrlPatterns: ['https://*/*'] },
  ]);
  menus.call(ID, 'create', [{ id: 'local', title: 'Local', documentUrlPatterns: ['https://local.test/*'] }]);
  assert.deepEqual(shown(menus), ['Vault']);
  assert.deepEqual(shown(menus, { isEditable: true }), [{ Vault: ['Fill'] }]);
  assert.deepEqual(shown(menus, { selectionText: 'word' }), [{ Vault: ['Find "word"'] }]);
  assert.deepEqual(shown(menus, { linkURL: 'https://a.example/' }), [{ Ext: ['Vault', 'Save link'] }]);
  assert.deepEqual(shown(menus, { linkURL: 'http://a.example/' }), ['Vault']);
  assert.deepEqual(shown(menus, { pageURL: 'https://local.test/x' }), [{ Ext: ['Vault', 'Local'] }]);
});

test('clicks report Chrome click info and toggle checkboxes', () => {
  const menus = new ExtensionMenus();
  const clicks = [];
  const link = context({ linkURL: 'https://a.example/' });
  menus.call(ID, 'create', [{ id: 7, type: 'checkbox', title: 'Block', contexts: ['link'] }]);
  menus.template(ID, 'Ext', link, (info) => clicks.push(info))[0].click();
  assert.deepEqual(clicks, [
    {
      menuItemId: 7,
      editable: false,
      pageUrl: 'https://example.com/',
      linkUrl: 'https://a.example/',
      wasChecked: false,
      checked: true,
    },
  ]);
  assert.equal(menus.template(ID, 'Ext', link, () => {})[0].checked, true);
});

test('update, remove and removeAll change the stored items', () => {
  const menus = new ExtensionMenus();
  menus.call(ID, 'create', [{ id: 'root', title: 'Root' }]);
  menus.call(ID, 'create', [{ id: 'child', parentId: 'root', title: 'Child' }]);
  menus.call(ID, 'create', [{ id: 'other', title: 'Other' }]);
  assert.throws(() => menus.call(ID, 'create', [{ id: 'root', title: 'Again' }]), /duplicate id/);
  assert.throws(() => menus.call(ID, 'create', [{ id: 'x', parentId: 'missing' }]), /Cannot find/);
  assert.throws(() => menus.call(ID, 'create', [{ title: 'No id' }]), /id is required/);
  menus.call(ID, 'update', ['other', { title: 'Renamed' }]);
  menus.call(ID, 'remove', ['root']);
  assert.deepEqual(shown(menus), ['Renamed']);
  assert.throws(() => menus.call(ID, 'update', ['child', { title: 'Gone' }]), /Cannot find/);
  menus.call(ID, 'removeAll', []);
  assert.deepEqual(shown(menus), []);
  assert.throws(() => menus.call(ID, 'open', []), /Unsupported/);
});
