import assert from 'node:assert/strict';
import vm from 'node:vm';
import { test } from 'node:test';
import preparation from '../../../dist/main/devtools/screenshot-preparation.js';

const { PREPARE_SCREENSHOT_SCRIPT } = preparation;

function page({ infinite = false, stalled = false, failure = false } = {}) {
  let now = 0;
  const visits = [];
  const image = {
    loading: 'lazy',
    getAttribute: () => 'lazy',
    setAttribute: (_name, value) => (image.loading = value),
    decode: () => {
      assert.equal(image.loading, 'eager');
      if (failure) throw new Error('decode failed');
      return stalled ? new Promise(() => {}) : Promise.reject(new Error('broken image'));
    },
  };
  const lateImage = { loading: 'eager', decode: () => Promise.resolve() };
  const document = {
    images: [image],
    scrollingElement: { scrollHeight: infinite ? Infinity : 2400 },
    fonts: { ready: Promise.resolve() },
  };
  const window = {
    scrollX: 24,
    scrollY: 320,
    innerHeight: 600,
    scrollTo: ({ left, top, behavior }) => {
      assert.equal(behavior, 'instant');
      window.scrollX = left;
      window.scrollY = top;
      visits.push(top);
      if (top >= 960 && !document.images.includes(lateImage)) document.images.push(lateImage);
    },
  };
  const context = vm.createContext({
    window,
    document,
    Date: { now: () => now },
    setTimeout: (callback, ms) =>
      setTimeout(() => {
        now += ms;
        callback();
      }, 0),
    clearTimeout,
  });
  return {
    window,
    document,
    image,
    visits,
    run: () => vm.runInContext(PREPARE_SCREENSHOT_SCRIPT, context),
    elapsed: () => now,
  };
}

test('capture preparation visits the bottom and restores scroll and lazy loading even with a broken image', async () => {
  const p = page();
  await p.run();
  assert.ok(p.visits.includes(1920));
  assert.equal(p.document.images.length, 2);
  assert.equal(p.image.loading, 'lazy');
  assert.equal(p.window.scrollX, 24);
  assert.equal(p.window.scrollY, 320);
});

test('infinite pages and stalled images have a bounded preparation time', async () => {
  const p = page({ infinite: true, stalled: true });
  await p.run();
  assert.ok(p.visits.length <= 101);
  assert.ok(p.elapsed() <= 10080);
  assert.equal(p.window.scrollY, 320);
  assert.equal(p.image.loading, 'lazy');
});

test('unexpected preparation failures still restore the page', async () => {
  const p = page({ failure: true });
  await assert.rejects(p.run(), /decode failed/);
  assert.equal(p.window.scrollY, 320);
  assert.equal(p.image.loading, 'lazy');
});
