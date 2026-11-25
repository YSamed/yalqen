import assert from 'node:assert/strict';
import { test } from 'node:test';
import extensionWindows from '../../../dist/main/extensions/extension-windows.js';

const { popupWindowBounds } = extensionWindows;
const area = { x: 0, y: 25, width: 1440, height: 875 };

test('popup windows keep the asked size inside the screen, centered unless placed', () => {
  assert.deepEqual(popupWindowBounds({ width: 380, height: 630 }, area), { x: 530, y: 148, width: 380, height: 630 });
  assert.deepEqual(popupWindowBounds({ width: 380, height: 630, left: 2000, top: -50 }, area), {
    x: 1060,
    y: 25,
    width: 380,
    height: 630,
  });
  assert.deepEqual(popupWindowBounds({ width: 50, height: 5000 }, area), { x: 620, y: 25, width: 200, height: 875 });
  assert.deepEqual(popupWindowBounds({}, area), { x: 520, y: 163, width: 400, height: 600 });
});
