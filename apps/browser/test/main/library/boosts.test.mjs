import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import boosts from '../../../dist/main/library/boosts.js';

const { BoostStore, boostOrigin, boostSelector, boostStyles, sanitizeBoost } = boosts;
const full = { enabled: true, accent: '#AABBCC', background: null, font: 'serif', hidden: ['.ad'], css: 'a{x:y}' };

function withDir(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-boosts-'));
  try {
    run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('sites are keyed by http(s) origin only', () => {
  assert.equal(boostOrigin('https://a.example/path?q#h'), 'https://a.example');
  assert.equal(boostOrigin('http://a.example:8080/x'), 'http://a.example:8080');
  for (const value of ['javascript:alert(1)', 'yalqen://settings/', 'https://u:p@a.example/', 'file:///etc', 5, null])
    assert.equal(boostOrigin(value), null, String(value));
});

test('selectors cannot end the rule, open an at-rule or swallow later rules', () => {
  for (const ok of ['.ad', 'div > #main:nth-of-type(2)', 'a[href^="https://x/{y}"]', '#\\31 23', 'li:not(.a, .b)'])
    assert.equal(boostSelector(` ${ok} `), ok, ok);
  for (const bad of [
    '',
    'a{}',
    'a}b{',
    'a;b',
    '@import "x"',
    'a/*',
    'a[href',
    'a[href)',
    'a(',
    'a)',
    'a[x="',
    'a\\',
    'a\nb',
    'x'.repeat(201),
    7,
  ])
    assert.equal(boostSelector(bad), null, String(bad));
});

test('a boost must be complete and valid, and is normalized', () => {
  assert.deepEqual(sanitizeBoost({ ...full, hidden: ['.ad', ' .ad ', '.b'] }), {
    ...full,
    accent: '#aabbcc',
    hidden: ['.ad', '.b'],
  });
  for (const bad of [
    null,
    { ...full, enabled: 'yes' },
    { ...full, accent: 'red' },
    { ...full, accent: undefined },
    { ...full, font: 'Comic Sans' },
    { ...full, hidden: ['a{}'] },
    { ...full, hidden: Array.from({ length: 51 }, (_, i) => `.a${i}`) },
    { ...full, css: 'x'.repeat(20_001) },
    { ...full, css: 5 },
  ])
    assert.equal(sanitizeBoost(bad), null, JSON.stringify(bad));
});

test('styles hide each selector in its own rule and keep custom CSS last', () => {
  const css = boostStyles({ ...full, accent: '#aabbcc', background: '#000000', hidden: ['.a', '#b'] });
  assert.match(css, /accent-color:#aabbcc/);
  assert.match(css, /background-color:#000000/);
  assert.match(css, /font-family:Georgia/);
  assert.ok(css.indexOf('.a{display:none!important}') < css.indexOf('#b{display:none!important}'));
  assert.ok(css.endsWith('a{x:y}'));
  assert.equal(boostStyles({ enabled: true, accent: null, background: null, font: null, hidden: [], css: '' }), '');
});

test('the store persists per origin, appends hidden elements and caps its size', () =>
  withDir((directory) => {
    const store = new BoostStore(directory);
    assert.equal(store.save('https://a.example/page', full), true);
    assert.equal(store.save('javascript:1', full), false);
    assert.equal(store.save('https://b.example', { ...full, css: 'x'.repeat(20_001) }), false);
    assert.equal(store.hide('https://b.example/x', 'div.banner'), true);
    assert.equal(store.hide('https://b.example/y', 'div.banner'), true);
    assert.deepEqual(store.get('https://b.example').hidden, ['div.banner']);
    assert.equal(store.hide('https://b.example/y', 'a{'), false);
    if (process.platform !== 'win32') assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);
    const reopened = new BoostStore(directory);
    assert.deepEqual(
      reopened.list().map((site) => site.origin),
      ['https://a.example', 'https://b.example'],
    );
    reopened.get('https://a.example').hidden.push('.changed');
    assert.deepEqual(reopened.get('https://a.example').hidden, ['.ad']);
    assert.equal(reopened.remove('https://a.example'), true);
    assert.equal(reopened.remove('https://a.example'), false);
    assert.equal(new BoostStore(directory).list().length, 1);
    for (let i = 0; i < 200; i++) store.save(`https://s${i}.example`, full);
    assert.equal(store.save('https://one-too-many.example', full), false);
    assert.equal(store.save('https://s0.example', { ...full, enabled: false }), true);
  }));

test('invalid stored entries are ignored on load', () =>
  withDir((directory) => {
    fs.writeFileSync(
      path.join(directory, 'boosts.json'),
      JSON.stringify({
        'https://ok.example': full,
        'https://ok.example/not-an-origin': full,
        'javascript:1': full,
        'https://bad.example': { ...full, hidden: ['a{}'] },
      }),
    );
    assert.deepEqual(
      new BoostStore(directory).list().map((site) => site.origin),
      ['https://ok.example'],
    );
    fs.writeFileSync(path.join(directory, 'boosts.json'), '[1]');
    assert.equal(new BoostStore(directory).list().length, 0);
  }));
