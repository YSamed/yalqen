import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

function page() {
  const ipc = new Map();
  const events = new Map();
  const animations = [];
  const motion = { matches: false, addEventListener: (name, listener) => events.set(name, listener) };
  const root = {
    animate(keyframes, options) {
      const animation = { keyframes, options, cancelled: false, finished: new Promise(() => {}) };
      animation.cancel = () => {
        animation.cancelled = true;
      };
      animations.push(animation);
      return animation;
    },
  };
  const window = { addEventListener: (name, listener) => events.set(name, listener), matchMedia: () => motion };
  window.top = window;
  const document = {
    documentElement: root,
    readyState: 'complete',
    hidden: false,
    addEventListener: (name, listener) => events.set(name, listener),
  };
  const context = {
    exports: {},
    require: () => ({
      ipcRenderer: { on: (channel, listener) => ipc.set(channel, listener) },
      contextBridge: { exposeInMainWorld() {} },
    }),
    window,
    document,
    location: { href: 'about:blank', protocol: 'about:' },
    getComputedStyle: () => ({ opacity: '0.7' }),
    Date,
  };
  const code = readFileSync(path.join(import.meta.dirname, '../../dist/preload/page-preload.js'), 'utf8');
  vm.runInNewContext(code, context);
  return {
    document,
    motion,
    animations,
    events,
    send: (startedAt = Date.now()) => ipc.get('yalqen:tab-transition')({}, startedAt),
  };
}

test('tab reveal preserves site opacity and only animates opacity without retaining styles', () => {
  const p = page();
  p.send();
  const { keyframes, options } = p.animations[0];
  assert.equal(keyframes[0].opacity, 0.7 * 0.88);
  assert.equal(keyframes[1].opacity, 0.7);
  assert.deepEqual(Object.keys(keyframes[0]), ['opacity']);
  assert.equal(options.duration, 140);
  assert.equal(options.fill, undefined);
});

test('fast switching cancels previous effects and keyboard switching does not start one', () => {
  const p = page();
  p.send();
  p.send();
  assert.equal(p.animations[0].cancelled, true);
  p.send(null);
  assert.equal(p.animations[1].cancelled, true);
  assert.equal(p.animations.length, 2);
});

test('reduced motion, loading, background and stale requests do not animate', () => {
  const p = page();
  p.motion.matches = true;
  p.send();
  p.motion.matches = false;
  p.document.readyState = 'loading';
  p.send();
  p.document.readyState = 'complete';
  p.document.hidden = true;
  p.send();
  p.document.hidden = false;
  p.send(Date.now() - 1000);
  assert.equal(p.animations.length, 0);
});

test('hiding the page and changing the motion preference cancel an in-flight effect', () => {
  const p = page();
  p.send();
  p.events.get('pagehide')();
  assert.equal(p.animations[0].cancelled, true);
  p.send();
  p.motion.matches = true;
  p.events.get('change')();
  assert.equal(p.animations[1].cancelled, true);
});
