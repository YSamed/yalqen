import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

test('download polling keeps the existing DOM for unchanged or identical updates', async () => {
  let html = '<p>Initial</p>';
  const writes = [];
  const requests = [];
  const updates = [{ version: 0 }, { version: 1, html }, { version: 2, html: '<p>Changed</p>' }];
  const listeners = {};
  const location = { href: '' };
  const list = {
    dataset: { version: '0' },
    addEventListener: (type, handler) => (listeners[type] = handler),
    get innerHTML() {
      return html;
    },
    set innerHTML(next) {
      writes.push(next);
      html = next;
    },
  };
  vm.runInNewContext(fs.readFileSync('src/renderer/public/downloads.js', 'utf8'), {
    document: { getElementById: () => list, activeElement: null },
    HTMLAnchorElement: class {},
    Element: class {},
    location,
    fetch: async (url) => {
      requests.push(url);
      const update = updates.shift();
      if (!update) throw new Error('end of fixture');
      return { ok: true, json: async () => update };
    },
    setTimeout: () => 1,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ['<p>Changed</p>']);
  assert.deepEqual(
    requests,
    [0, 0, 1, 2].map((version) => `yalqen://downloads/changes?since=${version}`),
  );
});

test('dragging a finished download row asks the browser to start a file drag', () => {
  class Element {}
  const listeners = {};
  const location = { href: '' };
  const row = { dataset: { drag: 'yalqen://downloads/drag?id=a' } };
  const target = Object.assign(new Element(), { closest: (selector) => (selector === '[data-drag]' ? row : null) });
  vm.runInNewContext(fs.readFileSync('src/renderer/public/downloads.js', 'utf8'), {
    document: {
      getElementById: () => ({
        dataset: { version: '0' },
        innerHTML: '',
        addEventListener: (type, handler) => (listeners[type] = handler),
      }),
    },
    HTMLAnchorElement: class {},
    Element,
    location,
    fetch: () => new Promise(() => {}),
    setTimeout: () => 1,
  });
  let prevented = false;
  listeners.dragstart({ target, preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
  assert.equal(location.href, 'yalqen://downloads/drag?id=a');
});
