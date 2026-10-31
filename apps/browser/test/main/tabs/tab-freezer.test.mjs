import assert from 'node:assert/strict';
import { test } from 'node:test';
import freezerModule from '../../../dist/main/tabs/tab-freezer.js';
import tabModule from '../../../dist/main/tabs/tab.js';

const { TabFreezer, FREEZE_IDLE_MS } = freezerModule;
const { createTab } = tabModule;

function fixture(t) {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 100_000 });
  const commands = [];
  let attached = false;
  let active = false;
  const tab = createTab({ url: 'https://example.com/' });
  tab.view = {
    webContents: {
      isDestroyed: () => false,
      isCurrentlyAudible: () => false,
      isDevToolsOpened: () => false,
      debugger: {
        isAttached: () => attached,
        attach: () => {
          attached = true;
        },
        detach: () => {
          attached = false;
        },
        sendCommand: async (method, params) => {
          commands.push({ method, ...params });
        },
      },
    },
  };
  const freezer = new TabFreezer({
    enabled: () => true,
    isActive: () => active,
    hasLiveChild: () => false,
    needsDebugger: () => false,
    changed() {},
  });
  return {
    tab,
    freezer,
    commands,
    activate: () => {
      active = true;
    },
  };
}

test('rapid return to a tab avoids freeze and resume protocol work', async (t) => {
  const f = fixture(t);
  f.freezer.maybeFreeze(f.tab);
  t.mock.timers.tick(FREEZE_IDLE_MS - 1);
  assert.equal(f.tab.frozen, false);
  assert.deepEqual(f.commands, []);
  f.activate();
  await f.freezer.unfreeze(f.tab);
  t.mock.timers.tick(FREEZE_IDLE_MS);
  assert.deepEqual(f.commands, []);
});

test('an idle background tab still freezes and resumes', async (t) => {
  const f = fixture(t);
  f.freezer.maybeFreeze(f.tab);
  f.freezer.maybeFreeze(f.tab);
  t.mock.timers.tick(FREEZE_IDLE_MS);
  assert.equal(f.tab.frozen, true);
  await f.freezer.unfreeze(f.tab);
  assert.equal(f.tab.frozen, false);
  assert.deepEqual(
    f.commands.map((command) => command.state),
    ['frozen', 'active'],
  );
});

test('a delayed freeze rechecks loading and media protection', (t) => {
  const f = fixture(t);
  f.freezer.maybeFreeze(f.tab);
  f.tab.loading = true;
  t.mock.timers.tick(FREEZE_IDLE_MS);
  assert.deepEqual(f.commands, []);
  f.tab.loading = false;
  f.tab.playingMedia = 1;
  f.tab.soundAt = Date.now();
  f.freezer.maybeFreeze(f.tab);
  assert.deepEqual(f.commands, []);
  f.tab.playingMedia = 0;
  f.tab.soundAt = 0;
  f.freezer.maybeFreeze(f.tab);
  assert.equal(f.tab.frozen, true);
});

test('disposing a view cancels its pending freeze', (t) => {
  const f = fixture(t);
  f.freezer.maybeFreeze(f.tab);
  f.freezer.cancel(f.tab);
  t.mock.timers.tick(FREEZE_IDLE_MS);
  assert.deepEqual(f.commands, []);
});
