import assert from 'node:assert/strict';
import { test } from 'node:test';
import windowModule from '../../../dist/main/window/window.js';

test('native window button APIs are only called on macOS', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const calls = [];
  let native = false;
  const host = {
    window: {
      isFullScreen: () => native,
      setWindowButtonVisibility: (visible) => calls.push(visible),
      setWindowButtonPosition: (position) => calls.push(position),
    },
  };
  try {
    for (const value of ['linux', 'win32']) {
      Object.defineProperty(process, 'platform', { value });
      windowModule.YalqenWindow.prototype.showWindowControls.call(host);
      assert.deepEqual(calls, []);
    }
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    windowModule.YalqenWindow.prototype.showWindowControls.call(host);
    assert.deepEqual(calls, [true, { x: 18, y: 20 }]);
    calls.length = 0;
    native = true;
    windowModule.YalqenWindow.prototype.showWindowControls.call(host);
    assert.deepEqual(calls, [false]);
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
});
