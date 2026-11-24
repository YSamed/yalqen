import assert from 'node:assert/strict';
import { test } from 'node:test';
import authFlow from '../../../dist/main/extensions/auth-flow.js';

const { SILENT_AUTH_MAX_MS, silentAuthOptions } = authFlow;

test('silent auth flows only load web urls', () => {
  assert.equal(silentAuthOptions({ url: 'https://idp.example/auth?x=1' }).url, 'https://idp.example/auth?x=1');
  assert.equal(silentAuthOptions({ url: 'http://127.0.0.1:8080/auth' }).url, 'http://127.0.0.1:8080/auth');
  for (const url of [
    'javascript:alert(1)',
    'file:///etc/hosts',
    'data:text/html,hi',
    `chrome-extension://${'a'.repeat(32)}/page.html`,
    'not a url',
    42,
    undefined,
  ]) {
    assert.throws(() => silentAuthOptions({ url }), /http or https/, String(url));
  }
  assert.throws(() => silentAuthOptions(null), /http or https/);
});

test('silent auth flows abort on load and cap the timeout by default', () => {
  assert.deepEqual(silentAuthOptions({ url: 'https://idp.example/' }), {
    url: 'https://idp.example/',
    abortOnLoad: true,
    timeoutMs: SILENT_AUTH_MAX_MS,
  });
  const options = (extra) => silentAuthOptions({ url: 'https://idp.example/', ...extra });
  assert.equal(options({ abortOnLoadForNonInteractive: false }).abortOnLoad, false);
  assert.equal(options({ abortOnLoadForNonInteractive: 'no' }).abortOnLoad, true);
  assert.equal(options({ timeoutMsForNonInteractive: 500 }).timeoutMs, 500);
  for (const timeoutMsForNonInteractive of [0, -5, Number.NaN, '500'])
    assert.equal(options({ timeoutMsForNonInteractive }).timeoutMs, SILENT_AUTH_MAX_MS);
  for (const timeoutMsForNonInteractive of [Number.POSITIVE_INFINITY, 10 * SILENT_AUTH_MAX_MS])
    assert.equal(options({ timeoutMsForNonInteractive }).timeoutMs, SILENT_AUTH_MAX_MS);
});
