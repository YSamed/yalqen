import assert from 'node:assert/strict';
import { test } from 'node:test';
import tabs from '../../dist/shared/extension-bridge.js';

const {
  authRedirectExtension,
  chromeWindow,
  extensionIdOf,
  extensionTabUrl,
  fragmentOnly,
  shortcutMatches,
  suggestedShortcut,
  WINDOW_ID_NONE,
} = tabs;
const ID = 'abcdefghijklmnopabcdefghijklmnop';

test('extension pages and workers are recognized by their origin', () => {
  assert.equal(extensionIdOf(`chrome-extension://${ID}/popup.html`), ID);
  assert.equal(extensionIdOf(`chrome-extension://${ID}/`), ID);
  assert.equal(extensionIdOf('https://example.com/'), null);
  assert.equal(extensionIdOf('chrome-extension://not-an-id/'), null);
  assert.equal(extensionIdOf(''), null);
});

test('only https chromiumapp.org hosts of an extension id are auth redirects', () => {
  assert.equal(authRedirectExtension(`https://${ID}.chromiumapp.org/cb?code=1`), ID);
  assert.equal(authRedirectExtension(`http://${ID}.chromiumapp.org/`), null);
  assert.equal(authRedirectExtension(`https://evil.${ID}.chromiumapp.org/`), null);
  assert.equal(authRedirectExtension('https://chromiumapp.org.example.com/'), null);
  assert.equal(authRedirectExtension('not a url'), null);
});

test('extensions open web pages and their own pages, nothing else', () => {
  assert.equal(extensionTabUrl(undefined, ID), null);
  assert.equal(extensionTabUrl('https://www.grammarly.com/signin', ID), 'https://www.grammarly.com/signin');
  assert.equal(extensionTabUrl('page.html', ID), `chrome-extension://${ID}/page.html`);
  assert.equal(extensionTabUrl('/src/newTab.html', ID), `chrome-extension://${ID}/src/newTab.html`);
  assert.throws(() => extensionTabUrl('file:///etc/hosts', ID));
  assert.throws(() => extensionTabUrl('javascript:alert(1)', ID));
  assert.throws(() => extensionTabUrl(`chrome-extension://${'b'.repeat(32)}/page.html`, ID));
  assert.throws(() => extensionTabUrl('yalqen://settings', ID));
  assert.throws(() => extensionTabUrl(42, ID));
});

test('windows are described to extensions as normal, non-incognito windows', () => {
  assert.deepEqual(chromeWindow({ id: 3, focused: true }), {
    id: 3,
    focused: true,
    type: 'normal',
    state: 'normal',
    incognito: false,
    alwaysOnTop: false,
  });
  assert.equal(WINDOW_ID_NONE, -1);
});

test('command shortcuts pick the platform key and fall back to default', () => {
  const suggested = { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' };
  assert.equal(suggestedShortcut(suggested, 'darwin'), 'Command+Shift+Y');
  assert.equal(suggestedShortcut(suggested, 'win32'), 'Ctrl+Shift+Y');
  assert.equal(suggestedShortcut({ linux: 'Alt+L' }, 'linux'), 'Alt+L');
  assert.equal(suggestedShortcut('Alt+K', 'win32'), 'Alt+K');
  assert.equal(suggestedShortcut(undefined, 'darwin'), '');
  assert.equal(suggestedShortcut({ windows: 'Alt+L' }, 'darwin'), '');
});

test('command shortcuts match the physical key and the exact modifiers', () => {
  const input = (code, modifiers = {}) => ({
    code,
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...modifiers,
  });
  assert.equal(shortcutMatches('Ctrl+Shift+L', input('KeyL', { control: true, shift: true }), 'win32'), true);
  assert.equal(shortcutMatches('Ctrl+Shift+L', input('KeyL', { meta: true, shift: true }), 'darwin'), true);
  assert.equal(shortcutMatches('Ctrl+Shift+L', input('KeyL', { control: true, shift: true }), 'darwin'), false);
  assert.equal(shortcutMatches('MacCtrl+Shift+L', input('KeyL', { control: true, shift: true }), 'darwin'), true);
  assert.equal(shortcutMatches('Alt+Shift+9', input('Digit9', { alt: true, shift: true }), 'linux'), true);
  assert.equal(shortcutMatches('Alt+Up', input('ArrowUp', { alt: true }), 'linux'), true);
  assert.equal(shortcutMatches('Ctrl+Shift+L', input('KeyL', { control: true }), 'win32'), false);
  assert.equal(shortcutMatches('Ctrl+L', input('KeyL', { control: true, alt: true }), 'win32'), false);
  assert.equal(shortcutMatches('Ctrl+Shift+L', input('KeyK', { control: true, shift: true }), 'win32'), false);
  assert.equal(shortcutMatches('L', input('KeyL'), 'win32'), false);
  assert.equal(shortcutMatches('', input('KeyL'), 'win32'), false);
  assert.equal(shortcutMatches('Ctrl+toString', input('KeyL', { control: true }), 'win32'), false);
});

test('fragmentOnly detects a hash-only change', () => {
  assert.equal(fragmentOnly('https://a.test/p', 'https://a.test/p#x'), true);
  assert.equal(fragmentOnly('https://a.test/p#x', 'https://a.test/p#y'), true);
  assert.equal(fragmentOnly('https://a.test/p#x', 'https://a.test/p'), true);
  assert.equal(fragmentOnly('https://a.test/p', 'https://a.test/q#x'), false);
  assert.equal(fragmentOnly('https://a.test/p?a=1', 'https://a.test/p?a=2#x'), false);
  assert.equal(fragmentOnly('https://a.test/p#x', 'https://a.test/p#x'), false);
  assert.equal(fragmentOnly(undefined, 'https://a.test/p#x'), false);
});
