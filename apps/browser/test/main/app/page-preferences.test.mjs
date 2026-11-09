import assert from 'node:assert/strict';
import { test } from 'node:test';
import preferences from '../../../dist/main/app/page-preferences.js';

const { acceptLanguages, chromeUserAgent, firefoxVersion, signInUserAgent, spellCheckerLanguages } = preferences;

test('languages are ordered by the chosen preference', () => {
  assert.equal(acceptLanguages('tr'), 'tr-TR,tr,en-US,en');
  assert.equal(acceptLanguages('en'), 'en-US,en,tr-TR,tr');
  assert.deepEqual(spellCheckerLanguages('tr'), ['tr', 'en-US']);
  assert.deepEqual(spellCheckerLanguages('en'), ['en-US', 'tr']);
});

test('the page user agent drops the app and Electron tokens', () => {
  const electron =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Yalqen/0.1.1-dev.ba1ae86 Chrome/152.0.7977.130 Electron/44.4.5 Safari/537.36';
  const chrome =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36';
  assert.equal(chromeUserAgent(electron), chrome);
  assert.equal(chromeUserAgent(chrome), chrome);
});

test('google sign-in gets a firefox user agent for the platform', () => {
  assert.match(signInUserAgent('https://accounts.google.com/v3/signin', 'darwin'), /Macintosh.*Firefox\//);
  assert.match(signInUserAgent('https://accounts.google.com/', 'win32'), /Windows NT.*Firefox\//);
  assert.match(signInUserAgent('https://accounts.google.com/', 'linux'), /Linux.*Firefox\//);
  assert.equal(signInUserAgent('https://mail.google.com/', 'darwin'), null);
  assert.equal(signInUserAgent('not a url', 'darwin'), null);
});

test('the sign-in firefox version follows the four-week release train', () => {
  assert.equal(firefoxVersion(Date.UTC(2025, 0, 1)), 145);
  assert.equal(firefoxVersion(Date.UTC(2025, 10, 11)), 145);
  assert.equal(firefoxVersion(Date.UTC(2025, 11, 9)), 146);
  assert.equal(firefoxVersion(Date.UTC(2026, 10, 9)), 157);
  assert.match(
    signInUserAgent('https://accounts.google.com/', 'darwin', Date.UTC(2026, 10, 9)),
    /rv:157\.0\) Gecko\/20100101 Firefox\/157\.0$/,
  );
});
