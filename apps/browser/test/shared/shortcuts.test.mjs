import assert from 'node:assert/strict';
import { test } from 'node:test';
import shortcuts from '../../dist/shared/shortcuts.js';

const { SHORTCUTS, normalizeAccelerator, shortcutAccelerator, shortcutConflicts } = shortcuts;

test('key combinations are normalized or rejected', () => {
  assert.equal(normalizeAccelerator('shift+cmdorctrl+k'), 'CmdOrCtrl+Shift+K');
  assert.equal(normalizeAccelerator('Command+Option+i'), 'Cmd+Alt+I');
  assert.equal(normalizeAccelerator('CmdOrCtrl++'), 'CmdOrCtrl+Plus');
  assert.equal(normalizeAccelerator('F5'), 'F5');
  assert.equal(normalizeAccelerator('K'), null);
  assert.equal(normalizeAccelerator('Ctrl+Ctrl+K'), null);
  assert.equal(normalizeAccelerator('Ctrl+Hyper+K'), null);
  assert.equal(normalizeAccelerator('Ctrl+'), null);
  assert.equal(normalizeAccelerator(42), null);
});

test('defaults are already normalized and free of conflicts on every platform', () => {
  for (const { accelerator } of SHORTCUTS) assert.equal(normalizeAccelerator(accelerator), accelerator);
  assert.equal(shortcutConflicts({}, true).size, 0);
  assert.equal(shortcutConflicts({}, false).size, 0);
});

test('overrides replace defaults and duplicate or built-in combinations conflict', () => {
  assert.equal(shortcutAccelerator('newTab', { newTab: 'Alt+T' }), 'Alt+T');
  assert.equal(shortcutAccelerator('newTab', {}), 'CmdOrCtrl+T');
  assert.deepEqual([...shortcutConflicts({ reload: 'CmdOrCtrl+T' }, true)].sort(), ['newTab', 'reload']);
  assert.deepEqual([...shortcutConflicts({ reload: 'Ctrl+T' }, false)].sort(), ['newTab', 'reload']);
  assert.equal(shortcutConflicts({ reload: 'Ctrl+T' }, true).size, 0);
  assert.deepEqual([...shortcutConflicts({ reload: 'CmdOrCtrl+1' }, true)], ['reload']);
});
