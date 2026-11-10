import assert from 'node:assert/strict';
import { test } from 'node:test';
import autoArchive from '../../../dist/main/tabs/auto-archive.js';

const { isAutoArchiveHours, shouldArchive } = autoArchive;

const HOUR = 3_600_000;
const idle = {
  active: false,
  pinned: false,
  private: false,
  loading: false,
  playing: false,
  devToolsOpen: false,
  edited: false,
  autoReload: false,
  hasLiveChild: false,
  inactiveSince: 0,
};

test('a tab is archived once it has been untouched for the chosen time', () => {
  assert.equal(shouldArchive(idle, 24 * HOUR - 1, 24), false);
  assert.equal(shouldArchive(idle, 24 * HOUR, 24), true);
  assert.equal(shouldArchive({ ...idle, inactiveSince: 10 * HOUR }, 34 * HOUR, 24), true);
});

test('archiving can be turned off', () => {
  assert.equal(shouldArchive(idle, 1000 * HOUR, 0), false);
});

test('tabs the user still relies on are never archived', () => {
  const now = 1000 * HOUR;
  for (const keep of [
    'active',
    'pinned',
    'private',
    'loading',
    'playing',
    'devToolsOpen',
    'edited',
    'autoReload',
    'hasLiveChild',
  ]) {
    assert.equal(shouldArchive({ ...idle, [keep]: true }, now, 12), false, keep);
  }
});

test('only the offered durations are accepted', () => {
  for (const hours of [0, 12, 24, 168, 720]) assert.equal(isAutoArchiveHours(hours), true);
  assert.equal(isAutoArchiveHours(48), false);
  assert.equal(isAutoArchiveHours('24'), false);
});
