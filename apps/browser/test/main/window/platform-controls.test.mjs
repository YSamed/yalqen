import assert from 'node:assert/strict';
import { test } from 'node:test';
import windowModule from '../../../dist/main/window/window.js';

test('native window button APIs are only called on macOS', () => {
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  const calls = [];
  const host = {
    app: { settings: { get: () => ({ toolbarVisible: true }) } },
    window: {
      isFullScreen: () => false,
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
    assert.deepEqual(calls, [true, { x: 16, y: 15 }]);
  } finally {
    Object.defineProperty(process, 'platform', platform);
  }
});
