import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { ElectronBlocker } from '@ghostery/adblocker-electron';
import adblock from '../../../dist/main/privacy/adblock.js';

const { loadEngine } = adblock;

test('disabled startup leaves the ad blocking engine unloaded until it is requested', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-adblock-'));
  const cache = path.join(dir, 'filters.bin');
  try {
    fs.writeFileSync(cache, ElectronBlocker.empty().serialize());
    const result = spawnSync(
      process.execPath,
      [
        '-e',
        `const assert = require('node:assert/strict');
        const adblock = require(process.argv[1]);
        const loadedEngines = () => Object.keys(require.cache).filter((file) => file.includes('/@ghostery/'));
        const blocker = new adblock.AdBlocker([], process.argv[2]);
        blocker.setEnabled(false);
        assert.deepEqual(loadedEngines(), []);
        blocker.setEnabled(true);
        assert.ok(loadedEngines().length > 0, 'enabled loading starts before the first await');
        blocker.whenReady().then(() => {
          blocker.destroy();
          assert.ok(loadedEngines().length > 0);
        });`,
        fileURLToPath(new URL('../../../dist/main/privacy/adblock.js', import.meta.url)),
        cache,
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
    assert.equal(result.status, 0, result.stderr || String(result.error));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('an old filter cache is usable immediately without downloading lists', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-adblock-'));
  const cache = path.join(dir, 'filters.bin');
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  try {
    fs.writeFileSync(cache, ElectronBlocker.empty().serialize());
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(cache, old, old);
    globalThis.fetch = async () => {
      fetches++;
      throw new Error('network should not be used');
    };

    const result = await loadEngine(cache);
    assert.equal(result.stale, true);
    assert.equal(typeof result.blocker.isBlockingEnabled, 'function');
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('scriptlets sharing global helpers can be injected one after another', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-adblock-'));
  const cache = path.join(dir, 'filters.bin');
  try {
    const wrapToString = `function wrapToString() {
      if (wrapToString.native === undefined) {
        wrapToString.native = Function.prototype.toString;
        Function.prototype.toString = new Proxy(Function.prototype.toString, {
          apply(target, self) { return wrapToString.native.call(self); },
        });
      }
    }`;
    const engine = ElectronBlocker.parse('example.com##+js(first)\nexample.com##+js(second)', {
      loadCosmeticFilters: true,
    });
    engine.updateResources(
      JSON.stringify({
        scriptlets: ['first', 'second']
          .map((name) => ({
            name: `${name}.js`,
            aliases: [],
            body: `function ${name}() { wrapToString(); }`,
            dependencies: ['wrap-to-string.fn'],
          }))
          .concat({ name: 'wrap-to-string.fn', aliases: [], body: wrapToString, dependencies: [] }),
      }),
      'test',
    );
    fs.writeFileSync(cache, engine.serialize());

    const { blocker } = await loadEngine(cache);
    const { scripts } = blocker.getCosmeticsFilters({
      url: 'https://example.com/',
      hostname: 'example.com',
      domain: 'example.com',
      getBaseRules: false,
      getInjectionRules: true,
      getExtendedRules: false,
      getRulesFromHostname: true,
    });
    assert.equal(scripts.length, 2);

    const page = vm.createContext({});
    for (const script of scripts) vm.runInContext(script, page);
    assert.equal(vm.runInContext('String(() => 1)', page), '() => 1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
