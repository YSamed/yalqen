import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import captureArea from '../../../dist/main/window/capture-area.js';

const { CAPTURE_AREA_SCRIPT, captureRect } = captureArea;

test('a selected area is scaled by the page zoom', () => {
  assert.deepEqual(captureRect({ x: 10, y: 20.4, width: 100, height: 50 }, 1.5), {
    x: 15,
    y: 31,
    width: 150,
    height: 75,
  });
});

test('cancelled, tiny or malformed selections capture nothing', () => {
  for (const value of [
    null,
    'x',
    { x: 0, y: 0, width: 3, height: 50 },
    { x: -1, y: 0, width: 10, height: 10 },
    { x: 0, y: 0, width: Infinity, height: 10 },
    { x: '0', y: 0, width: 10, height: 10 },
  ])
    assert.equal(captureRect(value, 1), null);
  assert.equal(captureRect({ x: 0, y: 0, width: 10, height: 10 }, 0), null);
});

test('the selection script removes its layer and reports the dragged rectangle', async () => {
  const handlers = {};
  const layer = {
    style: {},
    append() {},
    remove: () => (handlers.removed = true),
    setPointerCapture() {},
    addEventListener: (type, handler) => (handlers[type] = handler),
  };
  const box = { style: {} };
  const created = [layer, box];
  const result = vm.runInNewContext(CAPTURE_AREA_SCRIPT, {
    document: { createElement: () => created.shift(), documentElement: { append() {} } },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame: (run) => run(),
  });
  const event = (clientX, clientY) => ({ button: 0, clientX, clientY, pointerId: 1, preventDefault() {} });
  handlers.pointerdown(event(50, 40));
  handlers.pointermove(event(10, 90));
  handlers.pointerup(event(10, 90));
  assert.deepEqual({ ...(await result) }, { x: 10, y: 40, width: 40, height: 50 });
  assert.equal(handlers.removed, true);
});
