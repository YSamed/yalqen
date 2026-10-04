import assert from 'node:assert/strict';
import { test } from 'node:test';
import capture from '../../../dist/main/window/visual-capture.js';
import comparison from '../../../dist/main/window/visual-comparison.js';

const { captureVisualPage } = capture;
const { VisualComparisonManager, MAX_VISUAL_COMPARISON_EDGE, MAX_VISUAL_COMPARISON_IMAGE_BYTES } = comparison;

function fixture() {
  const state = {
    viewport: { width: 1200, height: 800, scale: 2 },
    empty: false,
    measurements: 0,
    resizes: [],
    capture: null,
    imageBytes: () => 256,
  };
  const image = {
    isEmpty: () => state.empty,
    getSize: () => ({ width: 3200, height: 2000 }),
    resize: (dimensions) => {
      state.resizes.push(dimensions);
      return {
        toJPEG: (quality) => {
          const result = Buffer.alloc(state.imageBytes(quality, dimensions));
          result.set([255, 216, 255]);
          return result;
        },
      };
    },
  };
  const contents = {
    debugger: {
      sendCommand: async (method) => {
        assert.equal(method, 'Page.getLayoutMetrics');
        state.measurements++;
        return {
          cssLayoutViewport: { clientWidth: state.viewport.width, clientHeight: state.viewport.height },
          layoutViewport: { clientWidth: state.viewport.width * state.viewport.scale },
        };
      },
    },
    capturePage: async () => (state.capture ? state.capture() : image),
  };
  return { state, contents, image };
}

test('an unchanged viewport produces bounded screenshot and thumbnail with CSS viewport metadata', async () => {
  const { contents, state } = fixture();
  const started = Date.now();
  const result = await captureVisualPage(contents);
  assert.deepEqual(result.viewport, { width: 1200, height: 800, deviceScaleFactor: 2 });
  assert.ok(result.capturedAt >= started && result.capturedAt <= Date.now());
  assert.equal(result.image.mediaType, 'image/jpeg');
  assert.ok(Buffer.byteLength(result.image.data, 'base64') <= MAX_VISUAL_COMPARISON_IMAGE_BYTES);
  assert.match(result.image.thumbnail, /^data:image\/jpeg;base64,/);
  assert.ok(result.image.thumbnail.length < 128 * 1024);
  assert.equal(state.measurements, 2);
  assert.equal(state.resizes.length, 2);
  assert.ok(Math.max(state.resizes[0].width, state.resizes[0].height) <= MAX_VISUAL_COMPARISON_EDGE);
  assert.equal(state.resizes[0].width / state.resizes[0].height, 3200 / 2000);
  assert.ok(Math.max(state.resizes[1].width, state.resizes[1].height) <= 160);
});

test('width, height and device scale changes during an awaited screenshot are rejected', async () => {
  for (const change of [{ width: 1000 }, { height: 600 }, { scale: 1 }]) {
    const { contents, state, image } = fixture();
    let finish;
    let started;
    const capturing = new Promise((resolve) => (started = resolve));
    state.capture = () => {
      started();
      return new Promise((resolve) => (finish = resolve));
    };
    const pending = captureVisualPage(contents);
    await capturing;
    Object.assign(state.viewport, change);
    finish(image);
    await assert.rejects(pending, /visual-comparison:viewport/);
    assert.equal(state.resizes.length, 0);
  }
});

test('capture detects resize races even when the comparison manager has no live viewport metadata', async () => {
  const { contents, state, image } = fixture();
  const tab = {
    tabId: 'tab-1',
    url: 'http://localhost:3000/app',
    title: 'Demo app',
    isPrivate: false,
    observed: true,
  };
  const manager = new VisualComparisonManager(
    async () => ({ ...tab, ...(await captureVisualPage(contents)) }),
    () => ({ ...tab }),
  );
  const baseline = await manager.capture('before', tab.tabId);
  let finish;
  let started;
  const capturing = new Promise((resolve) => (started = resolve));
  state.capture = () => {
    started();
    return new Promise((resolve) => (finish = resolve));
  };
  const pending = manager.capture('after', tab.tabId);
  await capturing;
  state.viewport.width = 900;
  finish(image);
  await assert.rejects(pending, /visual-comparison:viewport/);
  assert.deepEqual(manager.preview(), baseline);
});

test('empty screenshot images are rejected without creating previews', async () => {
  const { contents, state } = fixture();
  state.empty = true;
  await assert.rejects(captureVisualPage(contents), /visual-comparison:capture/);
  assert.equal(state.resizes.length, 0);
});

test('compression keeps screenshots within the byte limit and rejects images that remain oversized', async () => {
  const { contents, state } = fixture();
  state.imageBytes = (quality, dimensions) =>
    dimensions.width > 160 && quality >= 85 ? MAX_VISUAL_COMPARISON_IMAGE_BYTES + 1 : 256;
  const result = await captureVisualPage(contents);
  assert.ok(Buffer.byteLength(result.image.data, 'base64') <= MAX_VISUAL_COMPARISON_IMAGE_BYTES);
  state.imageBytes = () => MAX_VISUAL_COMPARISON_IMAGE_BYTES + 1;
  await assert.rejects(captureVisualPage(contents), /visual-comparison:too-large/);
});
