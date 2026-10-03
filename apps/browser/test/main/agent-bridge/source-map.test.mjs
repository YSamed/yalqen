import assert from 'node:assert/strict';
import { test } from 'node:test';
import sourceMap from '../../../dist/main/agent-bridge/source-map.js';

const { inlineSourceMap, originalPosition } = sourceMap;

// Line 1: col 0 -> a.jsx 1:1. Line 2: col 0 -> a.jsx 2:1, col 6 -> a.jsx 2:7, col 20 -> b.jsx 9:3.
const map = { sources: ['a.jsx', 'b.jsx'], mappings: 'AAAA;AACA,MAAM,cCOJ' };

test('originalPosition finds the closest mapping at or before the column', () => {
  assert.deepEqual(originalPosition(map, 1, 1), { source: 'a.jsx', line: 1, column: 1 });
  assert.deepEqual(originalPosition(map, 2, 3), { source: 'a.jsx', line: 2, column: 1 });
  assert.deepEqual(originalPosition(map, 2, 8), { source: 'a.jsx', line: 2, column: 7 });
  assert.deepEqual(originalPosition(map, 2, 30), { source: 'b.jsx', line: 9, column: 3 });
});

test('originalPosition returns null outside the mapped lines', () => {
  assert.equal(originalPosition(map, 0, 1), null);
  assert.equal(originalPosition(map, 9, 1), null);
});

test('sourceRoot is prefixed to the source', () => {
  assert.equal(originalPosition({ ...map, sourceRoot: 'webpack://app/' }, 1, 1).source, 'webpack://app/a.jsx');
});

test('inlineSourceMap reads base64 and plain data URLs', () => {
  const json = JSON.stringify(map);
  assert.deepEqual(
    inlineSourceMap(`data:application/json;charset=utf-8;base64,${Buffer.from(json).toString('base64')}`),
    map,
  );
  assert.deepEqual(inlineSourceMap(`data:application/json,${encodeURIComponent(json)}`), map);
  assert.equal(inlineSourceMap('http://localhost/app.js.map'), null);
  assert.equal(inlineSourceMap('data:application/json;base64,bm90IGpzb24='), null);
});
