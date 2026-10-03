import assert from 'node:assert/strict';
import { test } from 'node:test';
import pageOverrides from '../dist/main/devtools/page-overrides.js';

const { NO_OVERRIDES, USER_AGENTS, hasOverrides, overrideCommands } = pageOverrides;
const noDevice = { userAgent: '', platform: '' };
const byMethod = (commands) => Object.fromEntries(commands.map((command) => [command.method, command]));

test('only changed values count as overrides', () => {
  assert.equal(hasOverrides(NO_OVERRIDES), false);
  assert.equal(hasOverrides({ ...NO_OVERRIDES, reducedMotion: true }), true);
  assert.equal(hasOverrides({ ...NO_OVERRIDES, network: 'offline' }), true);
});

test('throttling enables the network domain without buffering bodies', () => {
  const commands = byMethod(overrideCommands({ ...NO_OVERRIDES, network: 'slow-3g' }, noDevice));
  assert.deepEqual(commands['Network.enable'].params, { maxTotalBufferSize: 0, maxResourceBufferSize: 0 });
  assert.deepEqual(commands['Network.emulateNetworkConditions'].params, {
    offline: false,
    latency: 2000,
    downloadThroughput: 50000,
    uploadThroughput: 50000,
  });
  assert.equal(commands['Network.setCacheDisabled'].params.cacheDisabled, false);
  assert.equal(overrideCommands({ ...NO_OVERRIDES, network: 'offline' }, noDevice)[2].params.offline, true);
});

test('clearing the network overrides resets and disables the domain, tolerating refusals', () => {
  const commands = overrideCommands(NO_OVERRIDES, noDevice).filter((command) => command.method.startsWith('Network.'));
  assert.deepEqual(
    commands.map((command) => [command.method, command.optional]),
    [
      ['Network.setCacheDisabled', true],
      ['Network.emulateNetworkConditions', true],
      ['Network.disable', true],
    ],
  );
  assert.equal(commands[1].params.downloadThroughput, -1);
});

test('media features are emulated and reset together', () => {
  const on = byMethod(
    overrideCommands({ ...NO_OVERRIDES, colorScheme: 'dark', reducedMotion: true, printMedia: true }, noDevice),
  );
  assert.deepEqual(on['Emulation.setEmulatedMedia'].params, {
    media: 'print',
    features: [
      { name: 'prefers-color-scheme', value: 'dark' },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ],
  });
  const off = byMethod(overrideCommands(NO_OVERRIDES, noDevice));
  assert.equal(off['Emulation.setEmulatedMedia'].params.media, '');
  assert.equal(off['Emulation.setEmulatedMedia'].params.features[0].value, '');
});

test('a chosen user agent wins over the device, which wins over the default', () => {
  const device = { userAgent: 'Device UA', platform: 'iPhone' };
  const chosen = byMethod(overrideCommands({ ...NO_OVERRIDES, userAgent: 'googlebot' }, device));
  assert.equal(chosen['Emulation.setUserAgentOverride'].params.userAgent, USER_AGENTS.googlebot.userAgent);
  const fallback = byMethod(overrideCommands(NO_OVERRIDES, device));
  assert.deepEqual(fallback['Emulation.setUserAgentOverride'].params, device);
  const reset = byMethod(overrideCommands(NO_OVERRIDES, noDevice));
  assert.equal(reset['Emulation.setUserAgentOverride'].params.userAgent, '');
});
