import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSwipeTracker } from '../../dist/shared/swipe.js';

test('a horizontal swipe switches once per gesture', () => {
  const swipe = createSwipeTracker(80, 200);
  assert.equal(swipe(40, 0, 0), 0);
  assert.equal(swipe(50, 5, 10), 1);
  assert.equal(swipe(200, 0, 20), 0);
  assert.equal(swipe(-90, 0, 500), -1);
});

test('vertical scrolling never switches', () => {
  const swipe = createSwipeTracker(80, 200);
  for (let i = 0; i < 10; i++) assert.equal(swipe(30, 60, i * 10), 0);
});
