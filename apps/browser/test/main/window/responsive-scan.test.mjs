import assert from 'node:assert/strict';
import { test } from 'node:test';
import scan from '../../../dist/main/window/responsive-scan.js';
import shared from '../../../dist/shared/responsive-scan.js';

const { ResponsiveScanManager, createResponsiveScanSession, parseResponsiveMeasurements } = scan;
const { RESPONSIVE_SCAN_VIEWPORTS } = shared;
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4n8AAAAASUVORK5CYII=';
const image = () => ({ mediaType: 'image/png', data: png, thumbnail: `data:image/png;base64,${png}` });
const measurements = (viewport) => ({
  viewport: { width: viewport.width, height: viewport.height },
  documentWidth: viewport.width + 12,
  horizontalOverflow: 12,
  findings: [
    {
      kind: 'horizontal-overflow',
      selector: '#wide',
      label: 'Wide content',
      rect: { x: 0, y: 20, width: viewport.width + 12, height: 40 },
    },
  ],
  truncated: false,
});

function fixture() {
  const state = {
    tab: { tabId: 'tab-1', url: 'http://localhost:3000/app', title: 'Demo', isPrivate: false, observed: true },
    calls: [],
    restores: 0,
    scan: null,
    restore: null,
  };
  const manager = new ResponsiveScanManager({
    readTab: () => (state.tab ? { ...state.tab } : null),
    createSession: async () => ({
      scan: async (viewport, signal) => {
        state.calls.push(viewport.id);
        return state.scan ? state.scan(viewport, signal) : { image: image(), measurements: measurements(viewport) };
      },
      restore: async () => {
        state.restores++;
        await state.restore?.();
      },
    }),
  });
  return { manager, state };
}

test('runs all three fixed sizes with ordered screenshots and measured review context', async () => {
  const { manager, state } = fixture();
  const pending = manager.run('tab-1');
  assert.equal(manager.runningTabId, 'tab-1');
  const result = await pending;
  assert.equal(result.status, 'ready');
  assert.deepEqual(state.calls, ['mobile', 'tablet', 'desktop']);
  assert.deepEqual(
    result.frames.map((frame) => frame.viewport),
    RESPONSIVE_SCAN_VIEWPORTS,
  );
  assert.equal(state.restores, 1);
  assert.equal(manager.runningTabId, null);
  const review = manager.review();
  assert.equal(review.images.length, 3);
  assert.match(review.text, /Measured DOM geometry/);
  assert.match(review.text, /CSS viewport sweep/);
  assert.match(review.text, /may be intentional/);
  assert.match(review.text, /#wide/);
  assert.ok(review.text.length <= 14_000);
  result.frames[0].measurements.viewport.width = 1;
  review.images[0].data = 'changed';
  assert.equal(manager.preview().frames[0].measurements.viewport.width, 390);
  assert.equal(manager.review().images[0].data, png);
});

test('scope restrictions reject capture before any page mutation', async () => {
  for (const change of [{ isPrivate: true }, { observed: false }, { url: 'https://example.com/' }]) {
    const { manager, state } = fixture();
    Object.assign(state.tab, change);
    assert.throws(() => manager.run('tab-1'), /responsive-scan:scope/);
    assert.equal(state.calls.length, 0);
    assert.equal(manager.preview(), null);
  }
});

test('a navigation during capture rejects its frame and always restores the page', async () => {
  const { manager, state } = fixture();
  state.scan = async (viewport) => {
    state.tab.url = 'http://localhost:3000/other';
    return { image: image(), measurements: measurements(viewport) };
  };
  const result = await manager.run('tab-1');
  assert.equal(result.error, 'navigation');
  assert.equal(result.frames.length, 0);
  assert.equal(state.restores, 1);
  assert.equal(manager.review(), null);
});

test('cancellation and clearing retain the lock until pending operations and restoration finish', async () => {
  const { manager, state } = fixture();
  let finish;
  let started;
  const scanning = new Promise((resolve) => (started = resolve));
  state.scan = (viewport) => {
    started();
    return new Promise((resolve) => (finish = () => resolve({ image: image(), measurements: measurements(viewport) })));
  };
  const pending = manager.run('tab-1');
  await scanning;
  const clearing = manager.clear();
  assert.equal(manager.running, true);
  assert.throws(() => manager.run('tab-1'), /responsive-scan:busy/);
  finish();
  const result = await pending;
  await clearing;
  assert.equal(result.status, 'cancelled');
  assert.equal(state.restores, 1);
  assert.equal(manager.running, false);
  assert.equal(manager.preview(), null);
});

test('the deadline stops a scan at the settled operation boundary and restores metrics', async () => {
  let restored = false;
  const tab = { tabId: 'tab-1', url: 'http://localhost:3000', title: 'Demo', isPrivate: false, observed: true };
  const manager = new ResponsiveScanManager({
    readTab: () => tab,
    timeoutMs: 10,
    createSession: async () => ({
      scan: (viewport, signal) =>
        new Promise((resolve) =>
          signal.addEventListener('abort', () => resolve({ image: image(), measurements: measurements(viewport) }), {
            once: true,
          }),
        ),
      restore: async () => {
        restored = true;
      },
    }),
  });
  const result = await manager.run(tab.tabId);
  assert.equal(result.error, 'timeout');
  assert.equal(restored, true);
  assert.equal(manager.running, false);
});

test('failed restoration is reported and scan images cannot be reviewed as a successful scan', async () => {
  const { manager, state } = fixture();
  state.restore = async () => {
    throw new Error('restore failed');
  };
  const result = await manager.run('tab-1');
  assert.equal(result.status, 'error');
  assert.equal(result.error, 'restore');
  assert.equal(manager.review(), null);
  assert.equal(manager.running, false);
});

test('measurement parsing bounds reports and excludes values, HTML and unknown fields', () => {
  const source = measurements({ width: 390, height: 844 });
  source.findings = Array.from({ length: 25 }, () => ({
    ...source.findings[0],
    selector: 's'.repeat(500),
    label: 'l'.repeat(500),
    value: 'secret',
    html: '<script>secret</script>',
  }));
  source.script = 'secret';
  source.horizontalOverflow = 999;
  const result = parseResponsiveMeasurements(source);
  assert.equal(result.findings.length, 20);
  assert.equal(result.findings[0].selector.length, 240);
  assert.equal(result.findings[0].label.length, 80);
  assert.equal(result.horizontalOverflow, 12);
  assert.equal(result.truncated, true);
  assert.equal('value' in result.findings[0], false);
  assert.equal('html' in result.findings[0], false);
  assert.equal('script' in result, false);
  assert.throws(() => parseResponsiveMeasurements({ ...source, documentWidth: Infinity }), /responsive-scan:capture/);
});

function sessionFixture() {
  const state = { viewport: { width: 640, height: 480 }, events: [], valid: true, capture: null, setMetrics: null };
  const contents = {
    isDestroyed: () => false,
    debugger: {
      sendCommand: async (method, params) => {
        assert.equal(method, 'Emulation.setDeviceMetricsOverride');
        state.events.push('set-start');
        await state.setMetrics?.();
        state.viewport = { width: params.width, height: params.height };
        state.events.push('set-finish');
      },
    },
    executeJavaScriptInIsolatedWorld: async (_world, scripts) => {
      const code = scripts[0].code;
      if (code.startsWith('({')) return { x: 13, y: 600 };
      if (code.startsWith('window.scrollTo')) {
        state.events.push(code);
        return undefined;
      }
      return measurements(state.viewport);
    },
  };
  const options = {
    guard: () => {
      if (!state.valid) throw new Error('responsive-scan:navigation');
    },
    restoreMetrics: async () => {
      state.events.push('restore');
      state.viewport = { width: 640, height: 480 };
    },
    capture: async () => (state.capture ? state.capture() : image()),
  };
  return { state, contents, options };
}

test('session preserves metrics and scroll on success without changing UA or touch behavior', async () => {
  const { state, contents, options } = sessionFixture();
  const session = await createResponsiveScanSession(contents, options);
  const result = await session.scan(RESPONSIVE_SCAN_VIEWPORTS[0], new AbortController().signal);
  assert.equal(result.measurements.viewport.width, 390);
  await session.restore();
  await session.restore();
  assert.deepEqual(state.viewport, { width: 640, height: 480 });
  assert.equal(state.events.filter((event) => event === 'restore').length, 1);
  assert.match(state.events.at(-1), /left: 13, top: 600/);
});

test('pending device metrics settle before cancellation restoration runs', async () => {
  const { state, contents, options } = sessionFixture();
  let finish;
  let started;
  const setting = new Promise((resolve) => (started = resolve));
  state.setMetrics = () => {
    started();
    return new Promise((resolve) => (finish = resolve));
  };
  const manager = new ResponsiveScanManager({
    readTab: () => ({ tabId: 'tab-1', url: 'http://localhost', title: 'Demo', isPrivate: false, observed: true }),
    createSession: () => createResponsiveScanSession(contents, options),
  });
  const pending = manager.run('tab-1');
  await setting;
  const cancelling = manager.cancel();
  assert.deepEqual(state.events, ['set-start']);
  assert.equal(manager.running, true);
  finish();
  await cancelling;
  assert.equal((await pending).status, 'cancelled');
  assert.ok(state.events.indexOf('set-finish') < state.events.indexOf('restore'));
  assert.deepEqual(state.viewport, { width: 640, height: 480 });
  assert.match(state.events.at(-1), /top: 600/);
});

test('viewport changes during screenshot capture are detected and restoration still succeeds', async () => {
  const { state, contents, options } = sessionFixture();
  options.capture = async () => {
    state.viewport.width = 640;
    return image();
  };
  const session = await createResponsiveScanSession(contents, options);
  await assert.rejects(
    session.scan(RESPONSIVE_SCAN_VIEWPORTS[0], new AbortController().signal),
    /responsive-scan:viewport/,
  );
  await session.restore();
  assert.deepEqual(state.viewport, { width: 640, height: 480 });
});

test('a navigated document receives metric restoration but never stale scroll coordinates', async () => {
  const { state, contents, options } = sessionFixture();
  options.capture = async () => {
    state.valid = false;
    return image();
  };
  const session = await createResponsiveScanSession(contents, options);
  await assert.rejects(
    session.scan(RESPONSIVE_SCAN_VIEWPORTS[0], new AbortController().signal),
    /responsive-scan:navigation/,
  );
  await session.restore();
  assert.equal(state.events.at(-1), 'restore');
  assert.deepEqual(state.viewport, { width: 640, height: 480 });
});

test('same-document scroll restoration can survive an active-tab or layout guard change', async () => {
  const { state, contents, options } = sessionFixture();
  options.canRestoreScroll = () => true;
  const session = await createResponsiveScanSession(contents, options);
  await session.scan(RESPONSIVE_SCAN_VIEWPORTS[0], new AbortController().signal);
  state.valid = false;
  await session.restore();
  assert.match(state.events.at(-1), /left: 13, top: 600/);
  assert.deepEqual(state.viewport, { width: 640, height: 480 });
});

test('a completed scan remains running until viewport restoration settles', async () => {
  const { manager, state } = fixture();
  let finish;
  let restoring;
  const started = new Promise((resolve) => (restoring = resolve));
  state.restore = () => {
    restoring();
    return new Promise((resolve) => (finish = resolve));
  };
  const pending = manager.run('tab-1');
  await started;
  assert.equal(manager.preview().status, 'running');
  assert.equal(manager.running, true);
  assert.equal(manager.review(), null);
  finish();
  assert.equal((await pending).status, 'ready');
});
