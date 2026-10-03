import assert from 'node:assert/strict';
import { test } from 'node:test';
import devices from '../../../dist/main/devtools/devices.js';

const { applyDeviceMetrics, applyEmulation } = devices;
const emulation = { deviceId: 'iphone-15', landscape: false };

function fakeContents() {
  const commands = [];
  const debuggerSession = {
    isAttached: () => true,
    sendCommand: async (name, params) => {
      commands.push({ name, params });
    },
  };
  return { commands, contents: { debugger: debuggerSession } };
}

test('resizing a device only updates its metrics', async () => {
  const { commands, contents } = fakeContents();
  await applyDeviceMetrics(contents, emulation, 0.8);
  assert.deepEqual(
    commands.map(({ name }) => name),
    ['Emulation.setDeviceMetricsOverride'],
  );
  assert.equal(commands[0].params.scale, 0.8);
});

test('entering device mode still applies touch and user agent settings', async () => {
  const { commands, contents } = fakeContents();
  await applyEmulation(contents, emulation, 1);
  assert.deepEqual(
    commands.map(({ name }) => name),
    [
      'Emulation.setDeviceMetricsOverride',
      'Emulation.setTouchEmulationEnabled',
      'Emulation.setEmitTouchEventsForMouse',
      'Emulation.setUserAgentOverride',
    ],
  );
});

test('a device fits inside the page and is centred below its label', () => {
  const page = { x: 0, y: 0, width: 1000, height: 800 };
  const frame = devices.fitDevice(emulation, page);
  assert.equal(frame.label, 'iPhone 15');
  assert.ok(frame.scale < 1);
  assert.ok(frame.viewHeight <= page.height - 2 * 32 - 24);
  assert.equal(frame.x, Math.round((page.width - frame.viewWidth) / 2));
  const landscape = devices.fitDevice(
    { deviceId: 'iphone-15', landscape: true },
    { x: 0, y: 0, width: 3000, height: 3000 },
  );
  assert.deepEqual([landscape.width, landscape.height, landscape.scale], [852, 393, 1]);
  assert.equal(devices.fitDevice(emulation, { x: 0, y: 0, width: 10, height: 10 }).scale, 0.25);
});

const responsive = { deviceId: 'responsive', landscape: false };

test('the responsive frame resizes within limits, phones do not', () => {
  const resized = devices.resizeEmulation(responsive, { width: 375.4, height: 50000 });
  assert.deepEqual(resized.size, { width: 375, height: 4000 });
  assert.deepEqual(devices.resizeEmulation(responsive, { width: Number.NaN, height: 10 }).size, {
    width: 1024,
    height: 200,
  });
  assert.equal(devices.resizeEmulation(emulation, { width: 500, height: 500 }), emulation);
  const frame = devices.fitDevice(resized, { x: 0, y: 0, width: 3000, height: 5000 });
  assert.deepEqual([frame.width, frame.height, frame.resizable, frame.deviceScaleFactor], [375, 4000, true, 1]);
  assert.equal(devices.fitDevice(emulation, { x: 0, y: 0, width: 3000, height: 3000 }).resizable, false);
});

test('rotating swaps a responsive size but toggles landscape on phones', () => {
  const rotated = devices.rotateEmulation({ ...responsive, size: { width: 800, height: 600 } });
  assert.deepEqual([rotated.landscape, rotated.size], [false, { width: 600, height: 800 }]);
  assert.equal(devices.rotateEmulation(emulation).landscape, true);
});

test('only the responsive frame takes a chosen pixel ratio', () => {
  assert.equal(devices.scaleEmulation(responsive, 2).scaleFactor, 2);
  assert.equal(devices.scaleEmulation(responsive, 7), responsive);
  assert.equal(devices.scaleEmulation(emulation, 2), emulation);
});

test('the responsive frame is emulated as a desktop page', async () => {
  const { commands, contents } = fakeContents();
  await applyEmulation(contents, { ...responsive, scaleFactor: 2 }, 1);
  const byName = Object.fromEntries(commands.map(({ name, params }) => [name, params]));
  assert.equal(byName['Emulation.setDeviceMetricsOverride'].mobile, false);
  assert.equal(byName['Emulation.setDeviceMetricsOverride'].deviceScaleFactor, 2);
  assert.equal(byName['Emulation.setTouchEmulationEnabled'].enabled, false);
  assert.equal(byName['Emulation.setUserAgentOverride'].userAgent, '');
});

test('phone presets apply their own viewport and user agent', async () => {
  const cases = {
    'iphone-15-pro-max': { size: [430, 932], scaleFactor: 3, userAgent: /iPhone/, platform: 'iPhone' },
    'iphone-16-pro': { size: [402, 874], scaleFactor: 3, userAgent: /iPhone/, platform: 'iPhone' },
    'pixel-9': { size: [412, 924], scaleFactor: 2.625, userAgent: /Android/, platform: 'Linux armv8l' },
    'galaxy-s24': { size: [360, 780], scaleFactor: 3, userAgent: /Android 10; K\)/, platform: 'Linux armv8l' },
  };
  for (const [deviceId, expected] of Object.entries(cases)) {
    const { commands, contents } = fakeContents();
    await applyEmulation(contents, { deviceId, landscape: false }, 1);
    const byName = Object.fromEntries(commands.map(({ name, params }) => [name, params]));
    const metrics = byName['Emulation.setDeviceMetricsOverride'];
    assert.deepEqual(
      [metrics.width, metrics.height, metrics.deviceScaleFactor, metrics.mobile],
      [...expected.size, expected.scaleFactor, true],
    );
    assert.match(byName['Emulation.setUserAgentOverride'].userAgent, expected.userAgent);
    assert.equal(byName['Emulation.setUserAgentOverride'].platform, expected.platform);
    assert.equal(byName['Emulation.setTouchEmulationEnabled'].enabled, true);
  }
});

test('every device id resolves to its own preset', () => {
  for (const device of devices.DEVICES) assert.equal(devices.findDevice(device.id), device);
  assert.equal(new Set(devices.DEVICES.map((device) => device.id)).size, devices.DEVICES.length);
  assert.equal(devices.findDevice('galaxy-s24').label, 'Galaxy S24');
  assert.equal(devices.findDevice('iphone-15-pro-max').label, 'iPhone 15 Pro Max');
  assert.equal(devices.findDevice('iphone-16-pro').label, 'iPhone 16 Pro');
  assert.equal(devices.findDevice('pixel-9').label, 'Pixel 9');
});
