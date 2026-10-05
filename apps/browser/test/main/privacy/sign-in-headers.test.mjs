import assert from 'node:assert/strict';
import { test } from 'node:test';
import headers from '../../../dist/main/privacy/sign-in-headers.js';

const { signInRequestHeaders } = headers;

const chromium = {
  'User-Agent': 'Mozilla/5.0 (Macintosh) Chrome/152.0.7977.130 Safari/537.36',
  'sec-ch-ua': '"Chromium";v="152"',
  'sec-ch-ua-mobile': '?0',
  'Sec-CH-UA-Platform': '"macOS"',
  Cookie: 'SID=1',
};

test('google sign-in requests drop chromium client hints and present firefox', () => {
  const rewritten = signInRequestHeaders('https://accounts.google.com/v3/signin/identifier', chromium, 'darwin');
  assert.deepEqual(Object.keys(rewritten).sort(), ['Cookie', 'User-Agent']);
  assert.match(rewritten['User-Agent'], /Firefox\//);
  assert.equal(rewritten.Cookie, 'SID=1');
});

test('other requests keep their headers', () => {
  assert.equal(signInRequestHeaders('https://mail.google.com/mail/', chromium, 'darwin'), null);
});
