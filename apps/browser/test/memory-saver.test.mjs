import assert from 'node:assert/strict';
import { test } from 'node:test';
import memorySaver from '../dist/main/tabs/memory-saver.js';

const {
  DEFAULT_DISCARD_AFTER_MINUTES,
  PRESSURE_MIN_IDLE_MS,
  isDiscardAfterMinutes,
  parsePressureLevel,
  pressureVictim,
  shouldDiscard,
} = memorySaver;

const MINUTE = 60_000;
const idle = {
  live: true,
  active: false,
  pinned: false,
  loading: false,
  audible: false,
  devToolsOpen: false,
  edited: false,
  inactiveSince: 0,
};

test('a background tab is discarded once it has been idle long enough', () => {
  assert.equal(shouldDiscard(idle, 30 * MINUTE - 1, 30), false);
  assert.equal(shouldDiscard(idle, 30 * MINUTE, 30), true);
});

test('discarding can be turned off', () => {
  assert.equal(shouldDiscard(idle, 1000 * MINUTE, 0), false);
});

test('tabs the user still relies on are kept in memory', () => {
  const now = 1000 * MINUTE;
  for (const keep of ['active', 'pinned', 'loading', 'audible', 'devToolsOpen', 'edited']) {
    assert.equal(shouldDiscard({ ...idle, [keep]: true }, now, 30), false, keep);
  }
  assert.equal(shouldDiscard({ ...idle, live: false }, now, 30), false);
});

test('only the offered durations are accepted', () => {
  assert.equal(isDiscardAfterMinutes(DEFAULT_DISCARD_AFTER_MINUTES), true);
  assert.equal(isDiscardAfterMinutes(0), true);
  assert.equal(isDiscardAfterMinutes(45), false);
  assert.equal(isDiscardAfterMinutes('30'), false);
});

test('under memory pressure the longest idle background tab goes first', () => {
  const now = 1000 * MINUTE;
  const tabs = [
    { ...idle, id: 'recent', inactiveSince: now - PRESSURE_MIN_IDLE_MS },
    { ...idle, id: 'oldest-but-playing', inactiveSince: 0, audible: true },
    { ...idle, id: 'old', inactiveSince: now - 10 * MINUTE },
    { ...idle, id: 'just-left', inactiveSince: now - 1000 },
  ];
  assert.equal(pressureVictim(tabs, now).id, 'old');
  assert.equal(
    pressureVictim(
      tabs.filter((tab) => tab.id !== 'old'),
      now,
    ).id,
    'recent',
  );
  assert.equal(pressureVictim([{ ...idle, active: true }], now), null);
});

test('the kernel pressure level is read as normal, warning or critical', () => {
  assert.equal(parsePressureLevel('1\n'), 'normal');
  assert.equal(parsePressureLevel('2\n'), 'warning');
  assert.equal(parsePressureLevel('4\n'), 'critical');
  assert.equal(parsePressureLevel(''), 'normal');
});
