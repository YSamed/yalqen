import assert from 'node:assert/strict';
import { test } from 'node:test';
import floatingChat from '../../../dist/main/window/floating-chat.js';

const { floatingChatBounds } = floatingChat;

test('the floating chat sits in the top right of the page and shrinks to fit a small page', () => {
  assert.deepEqual(floatingChatBounds({ x: 200, y: 47, width: 1200, height: 900 }), {
    x: 948,
    y: 59,
    width: 440,
    height: 760,
  });
  assert.deepEqual(floatingChatBounds({ x: 0, y: 0, width: 300, height: 400 }), {
    x: 12,
    y: 12,
    width: 276,
    height: 376,
  });
});

test('a dragged card keeps its offset but never leaves the page', () => {
  const page = { x: 200, y: 47, width: 1200, height: 900 };
  assert.deepEqual(floatingChatBounds(page, { right: 300, top: 100 }), { x: 660, y: 147, width: 440, height: 760 });
  assert.deepEqual(floatingChatBounds(page, { right: -50, top: 5000 }), { x: 960, y: 187, width: 440, height: 760 });
});
