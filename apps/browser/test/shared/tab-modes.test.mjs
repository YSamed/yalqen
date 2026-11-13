import assert from 'node:assert/strict';
import { test } from 'node:test';
import tabModes from '../../dist/shared/tab-modes.js';

const { isTabMode, modeOf, modeFlags, TAB_MODES } = tabModes;

test('a tab reads as normal, private or developer', () => {
  assert.equal(modeOf({ isPrivate: false }), 'normal');
  assert.equal(modeOf({ isPrivate: true }), 'private');
  assert.equal(modeOf({ isPrivate: true, developer: true }), 'developer');
  // A developer flag alone still reads as developer, the stronger mode.
  assert.equal(modeOf({ isPrivate: false, developer: true }), 'developer');
});

test('developer tabs are private too, so nothing they visit is kept', () => {
  assert.deepEqual(modeFlags('normal'), { isPrivate: false, developer: false });
  assert.deepEqual(modeFlags('private'), { isPrivate: true, developer: false });
  assert.deepEqual(modeFlags('developer'), { isPrivate: true, developer: true });
  for (const mode of TAB_MODES) assert.equal(modeOf(modeFlags(mode)), mode);
});

test('only the three modes are accepted from the interface', () => {
  for (const mode of ['normal', 'private', 'developer']) assert.equal(isTabMode(mode), true);
  for (const value of ['incognito', '', null, 1, { mode: 'private' }]) assert.equal(isTabMode(value), false);
});
