import assert from 'node:assert/strict';
import { test } from 'node:test';
import slideModule from '../../../dist/main/window/menu-bar-slide.js';

const { RESTING_SLIDE, slideMenuBar } = slideModule;

function run(edges, height = 30) {
  let slide = RESTING_SLIDE;
  return edges.map((edge) => (slide = slideMenuBar(slide, edge, height)));
}

test('the window eases to the menu bar once the strip starts sliding down, even through a stall', () => {
  const slides = run([0, -32, -25, -18, 4, 15, 15, 15, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]);
  assert.deepEqual(
    slides.slice(0, 2).map((slide) => slide.inset),
    [0, 0],
  );
  const insets = slides.map((slide) => slide.inset);
  for (let index = 1; index < insets.length; index++) assert.ok(insets[index] >= insets[index - 1]);
  assert.equal(slides.at(-1).inset, 30);
});

test('the window eases back up when the strip slides up and ignores the jumps to its parking spot', () => {
  let slide = { edge: 30, target: 30, inset: 30 };
  for (const edge of [24, 18, 10, 2, -6, -32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    slide = slideMenuBar(slide, edge, 30);
  assert.equal(slide.target, 0);
  assert.equal(slide.inset, 0);
});

test('leaving full screen resets the slide at once', () => {
  assert.equal(slideMenuBar({ edge: 30, target: 30, inset: 30 }, null, 30), RESTING_SLIDE);
});
