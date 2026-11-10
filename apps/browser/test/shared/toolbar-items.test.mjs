import assert from 'node:assert/strict';
import { test } from 'node:test';
import types from '../../dist/shared/types.js';

const { DEFAULT_TOOLBAR_BUTTONS, TOOLBAR_BUTTON_IDS, toolbarExtensionId, toolbarExtensionItem } = types;
const ID = 'abcdefghijklmnopabcdefghijklmnop';

test('extension toolbar items round-trip through their id', () => {
  assert.equal(toolbarExtensionItem(ID), `extension:${ID}`);
  assert.equal(toolbarExtensionId(toolbarExtensionItem(ID)), ID);
});

test('only real extension ids are extension toolbar items', () => {
  assert.equal(toolbarExtensionId('settings'), null);
  assert.equal(toolbarExtensionId('extension:'), null);
  assert.equal(toolbarExtensionId(`extension:${ID}x`), null);
  assert.equal(toolbarExtensionId(`extension:${ID.toUpperCase()}`), null);
});

test('every built-in button except developer tools is shown by default', () => {
  assert.deepEqual(
    DEFAULT_TOOLBAR_BUTTONS,
    TOOLBAR_BUTTON_IDS.filter((id) => id !== 'devtools'),
  );
});
