import assert from 'node:assert/strict';
import { test } from 'node:test';
import tabs from '../../dist/shared/extension-bridge.js';

const { authRedirectExtension, chromeWindow, extensionIdOf, extensionTabUrl, WINDOW_ID_NONE } = tabs;
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
