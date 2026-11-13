import assert from 'node:assert/strict';
import { test } from 'node:test';
import placement from '../../../dist/main/tabs/page-placement.js';

const { devToolsSplit, DEVTOOLS_MIN_WIDTH, SPLIT_GAP } = placement;
const area = { x: 100, y: 50, width: 1000, height: 700 };

function fills(split) {
  // The page, the gap and DevTools cover the area exactly, side by side.
  assert.equal(split.page.x, area.x);
  assert.equal(split.page.width + SPLIT_GAP + split.tools.width, area.width);
  assert.equal(split.tools.x + split.tools.width, area.x + area.width);
  assert.deepEqual([split.page.y, split.page.height, split.tools.y, split.tools.height], [50, 700, 50, 700]);
}

test('DevTools takes 40% beside the page until a width is chosen', () => {
  const split = devToolsSplit(area, null);
  assert.equal(split.tools.width, 400);
  fills(split);
});

test('a dragged width is kept between the DevTools minimum and room for the page', () => {
  assert.equal(devToolsSplit(area, 500).tools.width, 500);
  assert.equal(devToolsSplit(area, 10).tools.width, DEVTOOLS_MIN_WIDTH);
  assert.equal(devToolsSplit(area, 5000).page.width, 320);
  for (const width of [null, 10, 500, 5000]) fills(devToolsSplit(area, width));
});

test('a narrow area shares the room between the page and DevTools', () => {
  const narrow = { x: 0, y: 0, width: 400, height: 300 };
  const split = devToolsSplit(narrow, null);
  assert.ok(split.page.width > 0 && split.tools.width > 0);
  assert.equal(split.page.width + SPLIT_GAP + split.tools.width, narrow.width);
});
