import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import i18n from '../../dist/shared/i18n.js';
import english from '../../dist/shared/locales/en.js';
import turkish from '../../dist/shared/locales/tr.js';

const { getLocale, pickLocale, setLocale, t } = i18n;
const { en } = english;
const { tr } = turkish;
const renderer = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/renderer');
const placeholders = (message) => [...message.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test('the first device language with a translation wins, otherwise English', () => {
  assert.equal(pickLocale(['tr-TR', 'en-US']), 'tr');
  assert.equal(pickLocale(['en-GB', 'tr-TR']), 'en');
  assert.equal(pickLocale(['zh-Hans-CN', 'tr-TR']), 'tr');
  assert.equal(pickLocale(['zh-Hans-CN', 'de-DE']), 'en');
  assert.equal(pickLocale(['TR_tr']), 'tr');
  assert.equal(pickLocale([]), 'en');
  assert.equal(pickLocale([null, '']), 'en');
});

test('both languages have the same messages and placeholders', () => {
  assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort());
  for (const [key, message] of Object.entries(en)) {
    if (key.endsWith('.one')) {
      for (const name of placeholders(message)) assert.ok(placeholders(tr[key]).includes(name), key);
    } else {
      assert.deepEqual(placeholders(tr[key]), placeholders(message), key);
    }
  }
});

test('messages fill placeholders and use the singular form for a count of one', () => {
  const plural = Object.keys(en).find((key) => key.endsWith('.one'));
  assert.ok(plural, 'at least one message has a singular form');
  const base = plural.slice(0, -'.one'.length);
  setLocale('en');
  assert.equal(getLocale(), 'en');
  assert.equal(t(base, { count: 1 }), en[plural].replace('{count}', '1'));
  assert.equal(t(base, { count: 3 }), en[base].replace('{count}', '3'));
  setLocale('tr');
  assert.equal(t(base, { count: 3 }), tr[base].replace('{count}', '3'));
});

test('page templates only reference existing messages', () => {
  const templates = [
    path.join(renderer, 'settings.html'),
    ...fs
      .readdirSync(path.join(renderer, 'public'))
      .filter((name) => name.endsWith('.html'))
      .map((name) => path.join(renderer, 'public', name)),
  ];
  for (const file of templates) {
    const page = fs.readFileSync(file, 'utf8');
    assert.match(page, /<html lang="en">/, file);
    for (const [, key] of page.matchAll(/\{\{([\w.]+)\}\}/g)) assert.ok(key in en, `${path.basename(file)}: ${key}`);
  }
});
