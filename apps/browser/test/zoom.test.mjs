import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import zoom from '../dist/main/tabs/zoom.js';

const { ZoomStore, stepZoom, zoomKey } = zoom;

test('steps move between zoom levels and stop at the ends', () => {
  assert.equal(stepZoom(1, 1), 1.1);
  assert.equal(stepZoom(1, -1), 0.9);
  assert.equal(stepZoom(1.2, 1), 1.25);
  assert.equal(stepZoom(1.2, -1), 1.1);
  assert.equal(stepZoom(5, 1), 5);
  assert.equal(stepZoom(0.25, -1), 0.25);
});

test('only web pages have a zoom key', () => {
  assert.equal(zoomKey('https://www.example.com/a?b#c'), 'www.example.com');
  assert.equal(zoomKey('http://localhost:3000/'), 'localhost');
  assert.equal(zoomKey('yalqen://newtab/'), null);
  assert.equal(zoomKey('about:blank'), null);
  assert.equal(zoomKey('not a url'), null);
});

test('zoom levels are remembered per site and persist', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-zoom-'));
  try {
    const store = new ZoomStore(dir);
    assert.equal(store.get('https://example.com/'), 1);
    store.set('https://example.com/a', 1.25);
    store.set('https://other.org/', 0.8);
    store.set('yalqen://newtab/', 2);
    assert.equal(store.get('https://example.com/b'), 1.25);
    store.saveNow();

    const reloaded = new ZoomStore(dir);
    assert.equal(reloaded.get('https://example.com/'), 1.25);
    assert.equal(reloaded.get('https://other.org/x'), 0.8);
    assert.equal(reloaded.get('yalqen://newtab/'), 1);

    reloaded.set('https://example.com/', 1);
    reloaded.set('https://other.org/', 9);
    reloaded.saveNow();
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'zoom.json'), 'utf8'));
    assert.deepEqual(saved, { version: 1, sites: { 'other.org': 5 } });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('invalid saved levels are ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-zoom-'));
  try {
    fs.writeFileSync(
      path.join(dir, 'zoom.json'),
      JSON.stringify({ version: 1, sites: { 'a.com': 1.5, 'b.com': 'big', 'c.com': 50 } }),
    );
    const store = new ZoomStore(dir);
    assert.equal(store.get('https://a.com/'), 1.5);
    assert.equal(store.get('https://b.com/'), 1);
    assert.equal(store.get('https://c.com/'), 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a store without a directory keeps levels in memory only', () => {
  const store = new ZoomStore(null);
  store.set('https://example.com/', 1.5);
  assert.equal(store.get('https://example.com/'), 1.5);
  assert.equal(store.file, null);
});

test('sites without a level of their own follow the default zoom', () => {
  let fallback = 1.25;
  const store = new ZoomStore(null, () => fallback);
  assert.equal(store.get('https://a.com/'), 1.25);
  assert.equal(store.get('yalqen://newtab/'), 1.25);
  store.set('https://a.com/', 1.5);
  assert.equal(store.has('https://a.com/'), true);
  store.set('https://a.com/', 1.25);
  assert.equal(store.has('https://a.com/'), false);
  fallback = 0.9;
  assert.equal(store.get('https://a.com/'), 0.9);
});
