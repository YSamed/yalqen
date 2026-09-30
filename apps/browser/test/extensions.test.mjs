import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import zlib from 'node:zlib';
import store from '../dist/main/chrome-web-store.js';
import zip from '../dist/main/zip.js';
import manifests from '../dist/main/extension-manifest.js';
import popup from '../dist/main/extension-popup.js';
import extensions from '../dist/main/extensions.js';

const {
  actionTitle,
  extensionPage,
  iconFile,
  localize,
  optionsPage,
  parseMessages,
  popupPage,
  resolveInside,
  sanitizeSavedExtensions,
} = manifests;
const { popupBounds, sanitizeAnchor } = popup;
const { errorMessage, extensionsMenuTemplate } = extensions;
const { crxPayload, crxUrl, parseStoreId } = store;
const { extractZip } = zip;

const STORE_ID = 'abcdefghijklmnopabcdefghijklmnop';

function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content, deflate] of files) {
    const nameBytes = Buffer.from(name);
    const data = Buffer.from(content);
    const packed = deflate ? zlib.deflateRawSync(data) : data;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, packed);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

test('saved extensions keep unique absolute folders', () => {
  assert.deepEqual(
    sanitizeSavedExtensions([
      { path: '/ext/a' },
      { path: '/ext/a', enabled: false },
      { path: 'relative/b' },
      { path: '/ext/c', enabled: false },
      'nope',
    ]),
    [
      { path: '/ext/a', enabled: true },
      { path: '/ext/c', enabled: false },
    ],
  );
  assert.deepEqual(sanitizeSavedExtensions({}), []);
});

test('the toolbar action is read from manifest v3 and v2 keys', () => {
  const v3 = { action: { default_popup: 'popup.html', default_title: 'Dark' }, options_ui: { page: 'options.html' } };
  const v2 = { browser_action: { default_popup: '/ui/popup.html' }, options_page: 'settings.html' };
  assert.deepEqual([popupPage(v3), actionTitle(v3, 'Name'), optionsPage(v3)], ['popup.html', 'Dark', 'options.html']);
  assert.deepEqual(
    [popupPage(v2), actionTitle(v2, 'Name'), optionsPage(v2)],
    ['/ui/popup.html', 'Name', 'settings.html'],
  );
  assert.deepEqual([popupPage({}), optionsPage({ options_ui: { page: '' } })], [null, null]);
});

test('icons prefer the smallest size that is large enough', () => {
  const manifest = { icons: { 16: 'i16.png', 48: 'i48.png', 128: 'i128.png' } };
  assert.equal(iconFile(manifest, 32), 'i48.png');
  assert.equal(iconFile(manifest, 256), 'i128.png');
  assert.equal(iconFile({ action: { default_icon: 'one.png' } }, 16), 'one.png');
  assert.equal(iconFile({ action: { default_icon: { 19: 'a.png', 38: 'b.png' } } }, 32), 'b.png');
  assert.equal(iconFile({}, 16), null);
});

test('extension files and pages cannot leave the extension', () => {
  assert.equal(resolveInside('/ext/a', 'icons/i.png'), '/ext/a/icons/i.png');
  assert.equal(resolveInside('/ext/a', '/icons/i.png'), '/ext/a/icons/i.png');
  assert.equal(resolveInside('/ext/a', '../b/secret.png'), null);
  assert.equal(extensionPage('chrome-extension://abc/', '/ui/popup.html'), 'chrome-extension://abc/ui/popup.html');
  assert.equal(extensionPage('chrome-extension://abc/', '../../x.html'), 'chrome-extension://abc/x.html');
  assert.equal(extensionPage('chrome-extension://abc/', null), null);
});

test('manifest messages are localized case-insensitively', () => {
  const messages = parseMessages({ appName: { message: 'Karanlık Okuyucu' }, empty: { message: '' }, bad: 1 });
  assert.deepEqual(messages, { appname: 'Karanlık Okuyucu' });
  assert.equal(localize('__MSG_APPNAME__ v2', messages), 'Karanlık Okuyucu v2');
  assert.equal(localize('__MSG_missing__', messages), '__MSG_missing__');
});

test('popups open under the button and stay inside the window', () => {
  const anchor = { x: 900, y: 8, width: 28, height: 28 };
  assert.deepEqual(popupBounds(anchor, { width: 300, height: 200 }, { width: 1280, height: 800 }), {
    x: 628,
    y: 42,
    width: 300,
    height: 200,
  });
  assert.deepEqual(popupBounds(anchor, { width: 2000, height: 2000 }, { width: 1280, height: 400 }), {
    x: 128,
    y: 42,
    width: 800,
    height: 350,
  });
  assert.deepEqual(
    popupBounds({ x: 4, y: 8, width: 28, height: 28 }, { width: 10, height: 10 }, { width: 640, height: 400 }),
    {
      x: 8,
      y: 42,
      width: 25,
      height: 25,
    },
  );
});

test('anchors from the chrome are sanitized', () => {
  assert.deepEqual(sanitizeAnchor({ x: 10.5, y: -3, width: 'wide', height: Infinity }), {
    x: 10.5,
    y: 0,
    width: 0,
    height: 0,
  });
  assert.deepEqual(sanitizeAnchor(null), { x: 0, y: 0, width: 0, height: 0 });
});

test('the extensions menu opens popups, falls back to options and links to management', () => {
  const calls = [];
  const handlers = {
    openPopup: (url) => calls.push(['popup', url]),
    openOptions: (url) => calls.push(['options', url]),
    openStore: () => calls.push(['store']),
    manage: () => calls.push(['manage']),
  };
  const items = extensionsMenuTemplate(
    [
      { title: 'Zeta', icon: null, popupUrl: 'chrome-extension://z/popup.html', optionsUrl: null },
      { title: 'Alfa', icon: null, popupUrl: null, optionsUrl: 'chrome-extension://a/options.html' },
      { title: 'Boş', icon: null, popupUrl: null, optionsUrl: null },
    ],
    handlers,
  );
  assert.deepEqual(
    items.map((item) => item.label ?? '-'),
    ['Alfa', 'Boş', 'Zeta', '-', 'Chrome Web Mağazası’nı aç', 'Uzantıları yönet…'],
  );
  assert.equal(items[1].enabled, false);
  items[0].click();
  items[2].click();
  items[4].click();
  items[5].click();
  assert.deepEqual(calls, [
    ['options', 'chrome-extension://a/options.html'],
    ['popup', 'chrome-extension://z/popup.html'],
    ['store'],
    ['manage'],
  ]);
  assert.deepEqual(
    extensionsMenuTemplate([], handlers).map((item) => item.label),
    ['Chrome Web Mağazası’nı aç', 'Uzantıları yönet…'],
  );
});

test('load errors drop the folder prefix Electron adds', () => {
  assert.equal(
    errorMessage(new Error('Loading extension at /a b/ext failed with: Manifest file is missing or unreadable')),
    'Manifest file is missing or unreadable',
  );
  assert.equal(errorMessage('plain'), 'plain');
});

test('store ids are read from Chrome Web Store links and bare ids', () => {
  assert.equal(parseStoreId(STORE_ID), STORE_ID);
  assert.equal(parseStoreId(`  ${STORE_ID}\n`), STORE_ID);
  assert.equal(parseStoreId(`https://chromewebstore.google.com/detail/dark-reader/${STORE_ID}?hl=tr`), STORE_ID);
  assert.equal(parseStoreId(`https://chrome.google.com/webstore/detail/${STORE_ID}`), STORE_ID);
  assert.equal(parseStoreId(`https://evil.example/detail/x/${STORE_ID}`), null);
  assert.equal(parseStoreId(`http://chromewebstore.google.com/detail/x/${STORE_ID}`), null);
  assert.equal(parseStoreId('abc'), null);
  assert.equal(parseStoreId(STORE_ID.toUpperCase()), null);
});

test('the download url asks the update service for a crx3 of that id', () => {
  const url = new URL(crxUrl(STORE_ID, '140.0.0.0'));
  assert.equal(url.origin + url.pathname, 'https://clients2.google.com/service/update2/crx');
  assert.equal(url.searchParams.get('prodversion'), '140.0.0.0');
  assert.equal(url.searchParams.get('x'), `id=${STORE_ID}&installsource=ondemand&uc`);
});

test('crx headers of every version are stripped down to the zip', () => {
  const payload = buildZip([['manifest.json', '{}']]);
  const v3 = Buffer.concat([Buffer.from('Cr24'), Buffer.from([3, 0, 0, 0, 5, 0, 0, 0]), Buffer.alloc(5), payload]);
  const v2 = Buffer.concat([
    Buffer.from('Cr24'),
    Buffer.from([2, 0, 0, 0, 3, 0, 0, 0, 2, 0, 0, 0]),
    Buffer.alloc(5),
    payload,
  ]);
  assert.deepEqual(crxPayload(v3), payload);
  assert.deepEqual(crxPayload(v2), payload);
  assert.deepEqual(crxPayload(payload), payload);
  assert.throws(() => crxPayload(Buffer.from('<html>not a crx at all</html>')));
});

test('zip files unpack stored and deflated entries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-zip-'));
  try {
    const destination = path.join(root, 'ext');
    extractZip(
      buildZip([
        ['manifest.json', '{"name":"x"}', true],
        ['ui/', ''],
        ['ui/popup.html', '<p>hi</p>', false],
      ]),
      destination,
    );
    assert.equal(fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8'), '{"name":"x"}');
    assert.equal(fs.readFileSync(path.join(destination, 'ui', 'popup.html'), 'utf8'), '<p>hi</p>');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('zip files cannot write outside the destination', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-zip-'));
  try {
    const destination = path.join(root, 'ext');
    assert.throws(() => extractZip(buildZip([['../escape.txt', 'x']]), destination), /geçersiz dosya yolu/);
    assert.equal(fs.existsSync(path.join(root, 'escape.txt')), false);
    assert.throws(() => extractZip(Buffer.from('not a zip'), destination));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
