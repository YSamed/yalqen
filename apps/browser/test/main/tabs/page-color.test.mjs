import assert from 'node:assert/strict';
import { test } from 'node:test';
import pageColor from '../../../dist/main/tabs/page-color.js';

const { edgeColor } = pageColor;

function strip(width, height, colorAt) {
  const bitmap = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colorAt(x, y);
      bitmap.set([b, g, r, 255], (y * width + x) * 4);
    }
  }
  return bitmap;
}

test('the toolbar takes the color most of the page top edge shows', () => {
  const bitmap = strip(100, 4, (x) => (x < 20 ? [200, 30, 30] : [255, 255, 255]));
  assert.equal(edgeColor(bitmap, 100, 4), '#ffffff');
});

test('a busy or missing edge gives no color', () => {
  const stripes = strip(96, 4, (x) => [x * 2, 0, 0]);
  assert.equal(edgeColor(stripes, 96, 4), null);
  assert.equal(edgeColor(new Uint8Array(8), 100, 4), null);
  assert.equal(edgeColor(new Uint8Array(0), 0, 0), null);
});
