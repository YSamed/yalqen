import assert from 'node:assert/strict';
import { test } from 'node:test';
import preferences from '../dist/main/app/page-preferences.js';

const { acceptLanguages, chromeUserAgent, fontPreferences, spellCheckerLanguages } = preferences;

test('font sizes follow Chromium steps', () => {
  assert.deepEqual(fontPreferences('medium'), { defaultFontSize: 16, defaultMonospaceFontSize: 13 });
  assert.deepEqual(fontPreferences('xlarge'), { defaultFontSize: 24, defaultMonospaceFontSize: 20 });
  assert.deepEqual(fontPreferences('small'), { defaultFontSize: 12, defaultMonospaceFontSize: 10 });
});

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
