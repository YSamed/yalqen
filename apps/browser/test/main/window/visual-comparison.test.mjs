import assert from 'node:assert/strict';
import { test } from 'node:test';
import comparison from '../../../dist/main/window/visual-comparison.js';

const { VisualComparisonManager, MAX_VISUAL_COMPARISON_IMAGE_BYTES } = comparison;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4n8AAAAASUVORK5CYII=';
const image = () => ({ mediaType: 'image/png', data: png, thumbnail: `data:image/png;base64,${png}` });
const viewport = () => ({ width: 1200, height: 800, deviceScaleFactor: 2 });

function fixture() {
  const state = {
    tab: {
      tabId: 'tab-1',
      url: 'http://localhost:3000/app',
      title: 'Demo app',
      isPrivate: false,
      observed: true,
      viewport: viewport(),
    },
    calls: 0,
    capture: null,
  };
  const manager = new VisualComparisonManager(
    async (tabId) => {
      state.calls++;
      assert.equal(tabId, state.tab.tabId);
      if (state.capture) return state.capture();
      return {
        ...state.tab,
        viewport: { ...state.tab.viewport },
        capturedAt: 1700000000000 + state.calls,
        image: image(),
      };
    },
    (tabId) => (state.tab && tabId === state.tab.tabId ? { ...state.tab, viewport: { ...state.tab.viewport } } : null),
  );
  return { manager, state };
}

test('captures a fixed baseline and after, producing ordered images with page and viewport context', async () => {
  const { manager, state } = fixture();
  assert.equal(manager.preview(), null);
  assert.equal(manager.review(), null);
  const before = await manager.capture('before', 'tab-1');
  assert.equal(before.after, null);
  assert.equal(before.before.capturedAt, 1700000000001);
  state.tab.title = 'Updated app';
  const after = await manager.capture('after', 'tab-1');
  assert.deepEqual(after.before, before.before);
  assert.equal(after.after.title, 'Updated app');
  const review = manager.review();
  assert.equal(review.tabId, 'tab-1');
  assert.equal(review.images.length, 2);
  assert.match(review.text, /Image 1 is BEFORE; image 2 is AFTER/);
  assert.match(review.text, /http:\/\/localhost:3000\/app/);
  assert.match(review.text, /1200 × 800/);
  assert.match(review.text, /Review only; do not edit files/);
});

test('returned previews and review images cannot mutate the stored baseline', async () => {
  const { manager } = fixture();
  const preview = await manager.capture('before', 'tab-1');
  preview.before.url = 'https://example.com/';
  preview.before.viewport.width = 1;
  await manager.capture('after', 'tab-1');
  const review = manager.review();
  review.images[0].data = 'changed';
  assert.equal(manager.preview().before.viewport.width, 1200);
  assert.equal(manager.preview().before.url, 'http://localhost:3000/app');
  assert.equal(manager.review().images[0].data, png);
});

test('private, unobserved, remote and missing tabs cannot be captured', async () => {
  for (const change of [{ isPrivate: true }, { observed: false }, { url: 'https://example.com/app' }]) {
    const { manager, state } = fixture();
    Object.assign(state.tab, change);
    await assert.rejects(manager.capture('before', 'tab-1'), /visual-comparison:scope/);
    assert.equal(state.calls, 0);
  }
  const { manager, state } = fixture();
  await assert.rejects(manager.capture('before', 'missing'), /visual-comparison:unavailable/);
  assert.equal(state.calls, 0);
});

test('after captures require the same tab, URL and viewport as the baseline', async () => {
  const { manager, state } = fixture();
  await assert.rejects(manager.capture('after', 'tab-1'), /visual-comparison:baseline/);
  await manager.capture('before', 'tab-1');
  state.tab.url += '?new-route=1';
  await assert.rejects(manager.capture('after', 'tab-1'), /visual-comparison:navigation/);
  state.tab.url = 'http://localhost:3000/app';
  state.tab.viewport.width = 390;
  await assert.rejects(manager.capture('after', 'tab-1'), /visual-comparison:viewport/);
  state.tab.viewport = viewport();
  state.tab.tabId = 'tab-2';
  await assert.rejects(manager.capture('after', 'tab-2'), /visual-comparison:navigation/);
  assert.equal(state.calls, 1);
});

test('navigation, resize or privacy changes during capture reject the resulting image', async () => {
  for (const expected of ['navigation', 'viewport', 'scope']) {
    const { manager, state } = fixture();
    state.capture = async () => {
      const capture = { ...state.tab, viewport: viewport(), image: image() };
      if (expected === 'navigation') state.tab.url = 'http://localhost:3000/other';
      if (expected === 'viewport') state.tab.viewport.height = 400;
      if (expected === 'scope') state.tab.isPrivate = true;
      return capture;
    };
    await assert.rejects(manager.capture('before', 'tab-1'), new RegExp(`visual-comparison:${expected}`));
    assert.equal(manager.preview(), null);
  }
});

test('a resized after screenshot is rejected even when live viewport metadata is unavailable', async () => {
  const { state } = fixture();
  const manager = new VisualComparisonManager(
    async () => ({ ...state.tab, viewport: { ...state.tab.viewport }, image: image() }),
    () => ({ ...state.tab, viewport: undefined }),
  );
  await manager.capture('before', 'tab-1');
  state.tab.viewport.height = 500;
  await assert.rejects(manager.capture('after', 'tab-1'), /visual-comparison:viewport/);
  assert.equal(manager.preview().after, null);
});

test('clear cancels a pending capture and parallel capture requests do not race', async () => {
  const { manager, state } = fixture();
  let finish;
  state.capture = () => new Promise((resolve) => (finish = resolve));
  const pending = manager.capture('before', 'tab-1');
  await assert.rejects(manager.capture('before', 'tab-1'), /visual-comparison:busy/);
  manager.clear();
  finish({ ...state.tab, image: image() });
  await assert.rejects(pending, /visual-comparison:stale/);
  assert.equal(manager.preview(), null);
  state.capture = null;
  await manager.capture('before', 'tab-1');
  assert.ok(manager.preview());
});

test('recapturing the baseline releases the previous after and closing its tab clears both images', async () => {
  const { manager } = fixture();
  await manager.capture('before', 'tab-1');
  await manager.capture('after', 'tab-1');
  const next = await manager.capture('before', 'tab-1');
  assert.equal(next.after, null);
  assert.equal(manager.review(), null);
  manager.removeTab('unrelated');
  assert.ok(manager.preview());
  manager.removeTab('tab-1');
  assert.equal(manager.preview(), null);
});

test('malformed or oversized images do not replace a valid baseline', async () => {
  const { manager, state } = fixture();
  const before = await manager.capture('before', 'tab-1');
  state.capture = async () => ({ ...state.tab, image: { ...image(), data: 'not base64' } });
  await assert.rejects(manager.capture('before', 'tab-1'), /visual-comparison:capture/);
  state.capture = async () => ({
    ...state.tab,
    image: { ...image(), data: Buffer.alloc(MAX_VISUAL_COMPARISON_IMAGE_BYTES + 1).toString('base64') },
  });
  await assert.rejects(manager.capture('before', 'tab-1'), /visual-comparison:too-large/);
  assert.deepEqual(manager.preview(), before);
});

test('review rechecks sharing permissions and page identity before returning screenshots', async () => {
  const { manager, state } = fixture();
  await manager.capture('before', 'tab-1');
  await manager.capture('after', 'tab-1');
  state.tab.isPrivate = true;
  assert.throws(() => manager.review(), /visual-comparison:scope/);
  state.tab.isPrivate = false;
  state.tab.url = 'http://localhost:3000/other';
  assert.throws(() => manager.review(), /visual-comparison:navigation/);
  state.tab.url = 'http://localhost:3000/app';
  state.tab.viewport.width = 400;
  assert.throws(() => manager.review(), /visual-comparison:viewport/);
});
