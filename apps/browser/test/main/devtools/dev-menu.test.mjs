import assert from 'node:assert/strict';
import { test } from 'node:test';
import devMenu from '../../../dist/main/devtools/dev-menu.js';
import pageOverrides from '../../../dist/main/devtools/page-overrides.js';
import i18n from '../../../dist/shared/i18n.js';

i18n.setLocale('tr');

const { devMenuTemplate } = devMenu;
const { NO_OVERRIDES } = pageOverrides;

function actions() {
  const calls = [];
  return { calls, run: (id) => calls.push(id), openDevTools: () => calls.push('open-devtools') };
}
const find = (items, label) => items.find((item) => item.label === label);

test('the menu reflects the tab state and runs commands', () => {
  const a = actions();
  const state = {
    consoleErrors: 120,
    autoReloadSeconds: 30,
    overrides: { ...NO_OVERRIDES, cacheDisabled: true, network: 'fast-3g', userAgent: 'firefox' },
  };
  const items = devMenuTemplate(state, a);
  assert.equal(items[0].label, 'Konsolda 99+ hata');
  items[0].click();
  assert.equal(find(items, 'Önbelleği kapat').checked, true);
  const network = find(items, 'Ağ').submenu;
  assert.deepEqual(
    network.filter((item) => item.checked).map((item) => item.label),
    ['Hızlı 3G'],
  );
  network.find((item) => item.label === 'Çevrimdışı').click();
  assert.equal(find(items, 'Otomatik yenile').submenu.find((item) => item.checked).label, '30 saniye');
  assert.equal(find(items, 'User-Agent').submenu.find((item) => item.checked).label, 'Firefox (macOS)');
  find(items, 'Taklitleri sıfırla').click();
  assert.deepEqual(a.calls, ['open-devtools', 'network-offline', 'reset-overrides']);
});

test('without errors or overrides the menu starts with element selection, then the toggles, and cannot reset', () => {
  const calls = actions();
  const items = devMenuTemplate({ consoleErrors: 0, autoReloadSeconds: null, overrides: NO_OVERRIDES }, calls);
  assert.equal(items[0].label, 'Ajan için Öğe Seç');
  items[0].click();
  assert.deepEqual(calls.calls, ['pick-element']);
  assert.equal(items[2].label, 'Önbelleği kapat');
  assert.equal(find(items, 'Taklitleri sıfırla').enabled, false);
  assert.equal(find(items, 'Tema').submenu.find((item) => item.checked).label, 'Sistem');
});
