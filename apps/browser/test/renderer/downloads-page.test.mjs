import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

test('download polling keeps the existing DOM for unchanged or identical updates', async () => {
  let html = '<p>Initial</p>';
  const writes = [];
  const requests = [];
  const updates = [{ version: 0 }, { version: 1, html }, { version: 2, html: '<p>Changed</p>' }];
  const list = {
    dataset: { version: '0' },
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
    fetch: async (url) => {
      requests.push(url);
      const update = updates.shift();
      if (!update) throw new Error('end of fixture');
      return { ok: true, json: async () => update };
    },
    // The retry stays pending without creating a real timer after the fixture ends.
    setTimeout: () => 1,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, ['<p>Changed</p>']);
  assert.deepEqual(
    requests,
    [0, 0, 1, 2].map((version) => `yalqen://downloads/changes?since=${version}`),
  );
});
