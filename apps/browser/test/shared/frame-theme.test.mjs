import assert from 'node:assert/strict';
import { test } from 'node:test';
import frame from '../../dist/shared/frame-theme.js';

test('bright colors are softened so dark-mode sidebar text stays readable', () => {
  const amount = frame.readableFrameAmount(['#ffe600'], 100, 'dark');
  assert.ok(amount < 100);
  assert.equal(frame.readableFrameAmount(['#1b2a6b'], 80, 'dark'), 80);
});

test('several colors make a diagonal gradient', () => {
  assert.match(
    frame.frameGradient(['#ff0000', '#0000ff'], 40),
    /^linear-gradient\(160deg, color-mix\(in srgb, rgb\(from #ff0000/,
  );
  assert.match(frame.frameGradient(['#ff0000'], 40), /^linear-gradient\(to bottom/);
});

test('the color pad maps hue and lightness both ways', () => {
  assert.equal(frame.padColor(0, 0.5), '#ee2b2b');
  for (const [x, y] of [
    [0.1, 0.2],
    [0.55, 0.5],
    [0.9, 0.8],
  ]) {
    const point = frame.padPoint(frame.padColor(x, y));
    assert.ok(Math.abs(point.x - x) < 0.01 && Math.abs(point.y - y) < 0.02, `${x},${y} -> ${point.x},${point.y}`);
  }
});
