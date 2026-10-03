import assert from 'node:assert/strict';
import { test } from 'node:test';
import contextMenu from '../../../dist/main/window/context-menu.js';
import i18n from '../../../dist/shared/i18n.js';

i18n.setLocale('tr');

const { contextMenuTemplate, snippet } = contextMenu;

const FLAGS = { canUndo: false, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true };
const context = (overrides = {}) => ({
  linkURL: '',
  srcURL: '',
  mediaType: 'none',
  selectionText: '',
  isEditable: false,
  editFlags: FLAGS,
  misspelledWord: '',
  dictionarySuggestions: [],
  ...overrides,
});

function actions() {
  const calls = [];
  const record =
    (name) =>
    (...args) =>
      calls.push([name, ...args]);
  return {
    calls,
    canGoBack: true,
    canGoForward: false,
    canViewSource: true,
    openInNewTab: record('open'),
    openInNewWindow: record('window'),
    copyText: record('copy'),
    copyImage: record('copyImage'),
    download: record('download'),
    search: record('search'),
    goBack: record('back'),
    goForward: record('forward'),
    reload: record('reload'),
    inspect: record('inspect'),
    print: record('print'),
    viewSource: record('viewSource'),
    copyAddress: record('copyAddress'),
    replaceMisspelling: record('replace'),
    addToDictionary: record('addWord'),
  };
}

const labels = (items) => items.map((item) => (item.type === 'separator' ? '-' : item.label));
const item = (items, label) => items.find((entry) => entry.label === label);

test('a plain page offers navigation, printing, its source, its address and inspect', () => {
  const a = actions();
  const items = contextMenuTemplate(context(), a);
  assert.deepEqual(labels(items), [
    'Geri',
    'İleri',
    'Yenile',
    '-',
    'Yazdır…',
    'Sayfa kaynağını görüntüle',
    'Sayfa adresini kopyala',
    '-',
    'İncele',
  ]);
  assert.equal(item(items, 'Geri').enabled, true);
  assert.equal(item(items, 'İleri').enabled, false);
  item(items, 'Yazdır…').click();
  item(items, 'Sayfa kaynağını görüntüle').click();
  item(items, 'İncele').click();
  for (const entry of item(items, 'Sayfa adresini kopyala').submenu) entry.click();
  assert.deepEqual(a.calls, [
    ['print'],
    ['viewSource'],
    ['inspect'],
    ['copyAddress', 'url'],
    ['copyAddress', 'markdown'],
    ['copyAddress', 'curl'],
  ]);
  const internal = contextMenuTemplate(context(), { ...a, canViewSource: false });
  assert.equal(item(internal, 'Sayfa kaynağını görüntüle'), undefined);
  assert.equal(item(internal, 'Sayfa adresini kopyala'), undefined);
});

test('misspelled words get suggestions and can be added to the dictionary', () => {
  const a = actions();
  const items = contextMenuTemplate(
    context({
      isEditable: true,
      misspelledWord: 'merhba',
      dictionarySuggestions: ['merhaba', 'a', 'b', 'c', 'd', 'e'],
    }),
    a,
  );
  assert.deepEqual(labels(items).slice(0, 7), ['merhaba', 'a', 'b', 'c', 'd', '“merhba” sözlüğe ekle', '-']);
  item(items, 'merhaba').click();
  item(items, '“merhba” sözlüğe ekle').click();
  assert.deepEqual(a.calls, [
    ['replace', 'merhaba'],
    ['addWord', 'merhba'],
  ]);
  const none = contextMenuTemplate(context({ isEditable: true, misspelledWord: 'qwxz' }), a);
  assert.equal(none[0].label, 'Yazım önerisi yok');
  assert.equal(none[0].enabled, false);
});

test('links can be opened in a new tab and copied', () => {
  const a = actions();
  const items = contextMenuTemplate(context({ linkURL: 'https://example.com/a' }), a);
  assert.deepEqual(labels(items), [
    'Bağlantıyı yeni sekmede aç',
    'Bağlantıyı yeni pencerede aç',
    'Bağlantıyı indir',
    'Bağlantı adresini kopyala',
    '-',
    'İncele',
  ]);
  item(items, 'Bağlantıyı yeni sekmede aç').click();
  item(items, 'Bağlantıyı yeni pencerede aç').click();
  item(items, 'Bağlantıyı indir').click();
  item(items, 'Bağlantı adresini kopyala').click();
  assert.deepEqual(a.calls, [
    ['open', 'https://example.com/a'],
    ['window', 'https://example.com/a'],
    ['download', 'https://example.com/a'],
    ['copy', 'https://example.com/a'],
  ]);
});

test('script, local, internal and HTML document links are not opened', () => {
  for (const linkURL of ['javascript:alert(1)', 'file:///etc/hosts', 'yalqen://history/clear', 'data:text/html,<p>x']) {
    const items = contextMenuTemplate(context({ linkURL }), actions());
    assert.deepEqual(labels(items), ['Bağlantı adresini kopyala', '-', 'İncele'], linkURL);
  }
});

test('images inside links get both groups', () => {
  const a = actions();
  const items = contextMenuTemplate(
    context({ linkURL: 'https://example.com/', mediaType: 'image', srcURL: 'https://example.com/i.png' }),
    a,
  );
  assert.deepEqual(labels(items), [
    'Bağlantıyı yeni sekmede aç',
    'Bağlantıyı yeni pencerede aç',
    'Bağlantıyı indir',
    'Bağlantı adresini kopyala',
    '-',
    'Resmi yeni sekmede aç',
    'Resmi indir',
    'Resmi kopyala',
    'Resim adresini kopyala',
    '-',
    'İncele',
  ]);
  item(items, 'Resmi kopyala').click();
  assert.deepEqual(a.calls, [['copyImage']]);
});

test('selected text can be copied and searched', () => {
  const a = actions();
  const items = contextMenuTemplate(context({ selectionText: '  merhaba\n dünya ' }), a);
  assert.deepEqual(labels(items), ['Kopyala', '-', '“merhaba dünya” için ara', '-', 'İncele']);
  assert.equal(item(items, 'Kopyala').role, 'copy');
  item(items, '“merhaba dünya” için ara').click();
  assert.deepEqual(a.calls, [['search', 'merhaba\n dünya']]);
});

test('editable fields get edit commands with their flags', () => {
  const items = contextMenuTemplate(context({ isEditable: true }), actions());
  assert.deepEqual(labels(items), [
    'Geri al',
    'Yinele',
    '-',
    'Kes',
    'Kopyala',
    'Yapıştır',
    'Tümünü seç',
    '-',
    'İncele',
  ]);
  assert.equal(item(items, 'Geri al').enabled, false);
  assert.equal(item(items, 'Yapıştır').enabled, true);
});

test('long selections are shortened for the label', () => {
  assert.equal(snippet('kısa'), 'kısa');
  assert.equal(snippet('a'.repeat(40)), `${'a'.repeat(29)}…`);
});

test('a plain page offers translation only when available', () => {
  const a = actions();
  const labels = (items) => items.map((item) => item.label);
  assert.ok(!labels(contextMenuTemplate(context(), a)).includes('Sayfayı çevir'));
  const items = contextMenuTemplate(context(), {
    ...a,
    translation: { label: 'Sayfayı çevir', run: () => a.calls.push(['translate']) },
  });
  items.find((item) => item.label === 'Sayfayı çevir').click();
  assert.deepEqual(a.calls, [['translate']]);
});

test('a selection offers translation only when available and not while editing', () => {
  const a = actions();
  const translatable = { ...a, translateSelection: () => a.calls.push(['translateSelection']) };
  assert.ok(!labels(contextMenuTemplate(context({ selectionText: 'Hello' }), a)).includes('Seçili metni çevir'));
  assert.ok(
    !labels(contextMenuTemplate(context({ selectionText: 'Hello', isEditable: true }), translatable)).includes(
      'Seçili metni çevir',
    ),
  );
  const items = contextMenuTemplate(context({ selectionText: 'Hello' }), translatable);
  item(items, 'Seçili metni çevir').click();
  assert.deepEqual(a.calls, [['translateSelection']]);
});
