import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import easels from '../../../dist/main/library/easels.js';

const { EaselStore, easelItem } = easels;
const jpeg = 'data:image/jpeg;base64,/9j/4AAQ';
const clip = { w: 200, h: 100, src: jpeg, url: 'https://a.example/page#x', title: 'A page' };
const note = { kind: 'note', x: 10, y: 20, w: 200, h: 120, text: 'hi' };
const stroke = { kind: 'stroke', color: '#E11D48', width: 3, points: [0, 0, 10.26, 10] };

function withDir(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-easels-'));
  try {
    run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

test('items from the page are validated and clips only come from the main process', () => {
  assert.equal(easelItem(note, false).kind, 'note');
  assert.deepEqual(easelItem(stroke, false).points, [0, 0, 10.3, 10]);
  assert.equal(easelItem(stroke, false).color, '#e11d48');
  assert.equal(easelItem({ ...clip, kind: 'clip', x: 0, y: 0 }, false), null);
  assert.equal(easelItem({ ...clip, kind: 'clip', x: 0, y: 0 }, true).url, 'https://a.example/page#x');
  for (const bad of [
    { ...note, text: 'x'.repeat(2001) },
    { ...note, x: Infinity },
    { ...note, w: 5 },
    { ...stroke, color: 'red' },
    { ...stroke, points: [1, 2, 3] },
    { ...stroke, points: [1, 2] },
    { ...stroke, points: Array(4002).fill(1) },
    { ...stroke, width: 99 },
    { kind: 'other' },
    null,
  ])
    assert.equal(easelItem(bad, false), null, JSON.stringify(bad)?.slice(0, 60));
  for (const bad of [
    { ...clip, src: 'data:image/svg+xml;base64,AAAA' },
    { ...clip, src: 'https://evil.example/x.jpg' },
    { ...clip, src: `${jpeg}${'A'.repeat(400_000)}` },
    { ...clip, url: 'javascript:alert(1)' },
  ])
    assert.equal(easelItem({ ...bad, kind: 'clip', x: 0, y: 0 }, true), null, bad.url + bad.src.slice(0, 30));
});

test('easels persist items, patch only allowed fields and keep per-easel caps', () =>
  withDir((directory) => {
    const store = new EaselStore(directory);
    const easel = store.create('  Research \n board ');
    assert.equal(easel.name, 'Research board');
    assert.equal(store.create('   '), null);
    const added = store.add(easel.id, note);
    assert.equal(store.add(easel.id, { ...clip, kind: 'clip', x: 0, y: 0 }), null);
    assert.equal(store.add(easel.id, stroke).kind, 'stroke');
    assert.equal(store.add('missing', note), null);
    assert.equal(store.patch(easel.id, added.id, { x: 50, text: 'changed', id: 'other', kind: 'stroke' }), true);
    const patched = store.get(easel.id).items[0];
    assert.deepEqual([patched.id, patched.kind, patched.x, patched.text], [added.id, 'note', 50, 'changed']);
    assert.equal(store.patch(easel.id, added.id, { x: 'far' }), false);
    assert.equal(store.patch(easel.id, store.get(easel.id).items[1].id, { x: 1 }), false);
    if (process.platform !== 'win32') assert.equal(fs.statSync(store.file).mode & 0o777, 0o600);

    const reopened = new EaselStore(directory);
    assert.deepEqual(reopened.list(), [{ id: easel.id, name: 'Research board', count: 2 }]);
    assert.equal(reopened.removeItem(easel.id, added.id), true);
    assert.equal(reopened.removeItem(easel.id, added.id), false);
    assert.equal(reopened.rename(easel.id, 'Renamed'), true);
    assert.equal(new EaselStore(directory).get(easel.id).items.length, 1);
    assert.equal(reopened.remove(easel.id), true);
    assert.equal(new EaselStore(directory).list().length, 0);
  }));

test('clips go to the most recently changed easel, which is created when none exists', () =>
  withDir((directory) => {
    const store = new EaselStore(directory);
    const first = store.clip(clip, 'My easel');
    assert.equal(first.easel.name, 'My easel');
    const other = store.create('Other');
    store.add(other.id, note);
    assert.equal(store.clip(clip, 'unused').easel.id, other.id);
    assert.equal(store.get(other.id).items.length, 2);
    assert.notEqual(store.get(other.id).items[1].x, undefined);
  }));

test('caps: easels, items per easel and total file size', () =>
  withDir((directory) => {
    const store = new EaselStore(directory);
    const easel = store.create('Full');
    for (let i = 0; i < 100; i++) assert.ok(store.add(easel.id, note));
    assert.equal(store.add(easel.id, note), null);
    for (let i = 1; i < 20; i++) assert.ok(store.create(`E${i}`));
    assert.equal(store.create('One too many'), null);
    const big = { ...clip, src: `${jpeg}${'A'.repeat(390_000)}`, kind: 'clip', x: 0, y: 0 };
    const roomy = new EaselStore(fs.mkdtempSync(path.join(directory, 'big-')));
    const target = roomy.create('Big');
    let accepted = 0;
    while (roomy.add(target.id, big, true)) accepted++;
    assert.ok(accepted > 5 && accepted < 100, String(accepted));
    assert.ok(fs.statSync(roomy.file).size <= 8 * 1024 * 1024);
  }));

test('invalid stored easels and items are dropped on load', () =>
  withDir((directory) => {
    const good = {
      id: 'e1',
      name: 'Good',
      updatedAt: 5,
      items: [
        { ...note, id: 'n1' },
        { ...note, id: 'n2', w: 1 },
      ],
    };
    fs.writeFileSync(
      path.join(directory, 'easels.json'),
      JSON.stringify([good, { ...good, id: 'e2', name: '' }, { ...good, id: 'e1' }, { ...good, id: 'e3', items: 5 }]),
    );
    const store = new EaselStore(directory);
    assert.deepEqual(store.list(), [{ id: 'e1', name: 'Good', count: 1 }]);
    fs.writeFileSync(path.join(directory, 'easels.json'), '{"not":"a list"}');
    assert.equal(new EaselStore(directory).list().length, 0);
  }));
