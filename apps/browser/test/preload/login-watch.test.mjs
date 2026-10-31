import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

function page() {
  const events = new Map();
  const timers = [];
  let mutations;
  let scans = 0;
  let passwordPresent = false;
  class Element {
    constructor(password = false) {
      this.password = password;
    }
    matches() {
      return this.password;
    }
    querySelector() {
      return this.password ? this : null;
    }
  }
  class HTMLInputElement extends Element {
    constructor(type) {
      super(type === 'password');
      this.type = type;
    }
  }
  const window = {
    addEventListener: (name, callback) => events.set(name, callback),
    setTimeout: (callback, ms) => {
      timers.push({ callback, ms });
      return timers.length;
    },
  };
  window.top = window;
  const context = {
    exports: {},
    require: () => ({
      ipcRenderer: { on() {}, invoke: async () => ({ choices: [] }) },
      contextBridge: { exposeInMainWorld() {} },
      webFrame: { executeJavaScript: async () => {} },
    }),
    location: { href: 'https://example.com/', protocol: 'https:', hostname: 'example.com' },
    window,
    document: {
      documentElement: new Element(),
      addEventListener() {},
      querySelector: () => (passwordPresent ? new HTMLInputElement('password') : null),
      querySelectorAll: () => {
        scans++;
        return [];
      },
    },
    Element,
    HTMLInputElement,
    MutationObserver: class {
      constructor(callback) {
        mutations = callback;
      }
      observe() {}
      disconnect() {}
    },
  };
  const code = readFileSync(path.join(import.meta.dirname, '../../dist/preload/page-preload.js'), 'utf8');
  vm.runInNewContext(code, context);
  events.get('DOMContentLoaded')();
  return {
    Element,
    HTMLInputElement,
    scans: () => scans,
    setPassword: (value) => {
      passwordPresent = value;
    },
    mutate: (records) => mutations(records),
    flush: () => {
      const pending = timers.splice(0).filter(({ ms }) => ms === 100);
      pending.forEach(({ callback }) => callback());
      return pending.length;
    },
  };
}

test('unrelated page updates do not trigger repeated document-wide login scans', () => {
  const p = page();
  const before = p.scans();
  for (let i = 0; i < 100; i++) p.mutate([{ type: 'childList', addedNodes: [new p.Element()] }]);
  assert.equal(p.flush(), 0);
  assert.equal(p.scans(), before);
});

test('a dynamically inserted password form schedules one scan for a burst of updates', () => {
  const p = page();
  const before = p.scans();
  p.setPassword(true);
  for (let i = 0; i < 10; i++) p.mutate([{ type: 'childList', addedNodes: [new p.Element(true)] }]);
  assert.equal(p.flush(), 1);
  assert.ok(p.scans() > before);
  p.mutate([{ type: 'childList', addedNodes: [] }]);
  assert.equal(p.flush(), 1);
});

test('changing an existing input to a password field starts login detection', () => {
  const p = page();
  p.mutate([{ type: 'attributes', target: new p.HTMLInputElement('password') }]);
  assert.equal(p.flush(), 1);
});
