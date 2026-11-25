import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

function gesturePage(platform = 'darwin') {
  const sent = [];
  let onWheel;
  let now = 0;
  let styleReads = 0;
  class Element {
    constructor(overflowX = 'visible', scrollWidth = 100, clientWidth = 100) {
      Object.assign(this, { overflowX, scrollWidth, clientWidth });
    }
  }
  const window = {
    addEventListener: (name, callback) => {
      if (name === 'wheel') onWheel = callback;
    },
  };
  window.top = window;
  const context = {
    exports: {},
    require: () => ({
      ipcRenderer: { send: (...args) => sent.push(args), on() {}, sendSync() {} },
      contextBridge: { exposeInMainWorld() {} },
      webFrame: { executeJavaScript: async () => {} },
    }),
    location: { href: 'https://example.com/' },
    window,
    document: { scrollingElement: new Element() },
    Element,
    WheelEvent: { DOM_DELTA_PIXEL: 0 },
    getComputedStyle: (element) => {
      styleReads++;
      return { overflowX: element.overflowX };
    },
    performance: { now: () => now },
    process: { platform },
  };
  const code = readFileSync(path.join(import.meta.dirname, '../../dist/preload/page-preload.js'), 'utf8');
  vm.runInNewContext(code, context);
  return {
    sent,
    Element,
    styleReads: () => styleReads,
    wheel(deltaX, at, target = new Element(), isTrusted = true, wheelDeltaX = -deltaX * 1.2) {
      now = at;
      onWheel({
        deltaX,
        wheelDeltaX,
        deltaY: 0,
        deltaMode: 0,
        isTrusted,
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        composedPath: () => [target],
      });
    },
  };
}

test('a horizontal swipe navigates once in each direction', () => {
  const page = gesturePage();
  page.wheel(-35, 1000);
  page.wheel(-35, 1020);
  page.wheel(-35, 1040);
  page.wheel(-100, 1060);
  assert.deepEqual(page.sent, [['yalqen:page-swipe', 'back']]);

  page.wheel(100, 1800);
  assert.deepEqual(page.sent, [
    ['yalqen:page-swipe', 'back'],
    ['yalqen:page-swipe', 'forward'],
  ]);
});

test('horizontal content and synthetic wheel events never navigate', () => {
  const page = gesturePage();
  page.wheel(120, 1000, new page.Element('auto', 200, 100));
  page.wheel(120, 1800, new page.Element(), false);
  assert.deepEqual(page.sent, []);
});

test('a gesture checks for horizontal scrollers once, not on every event', () => {
  const page = gesturePage();
  const scroller = new page.Element('auto', 200, 100);
  for (let at = 1000; at <= 1100; at += 20) page.wheel(-35, at, scroller);
  assert.equal(page.styleReads(), 1);
  assert.deepEqual(page.sent, []);

  page.wheel(-35, 1600);
  page.wheel(-100, 1620);
  assert.equal(page.styleReads(), 2);
  assert.deepEqual(page.sent, [['yalqen:page-swipe', 'back']]);
});

test('off macOS a tilt wheel never navigates but a touchpad swipe does', () => {
  const page = gesturePage('win32');
  for (let at = 1000; at <= 1100; at += 20) page.wheel(-100, at, undefined, true, 120);
  assert.deepEqual(page.sent, []);

  page.wheel(-35, 1800);
  page.wheel(-35, 1820);
  page.wheel(-35, 1840);
  page.wheel(-100, 1860);
  assert.deepEqual(page.sent, [['yalqen:page-swipe', 'back']]);
});
