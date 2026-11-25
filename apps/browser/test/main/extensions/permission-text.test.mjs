import assert from 'node:assert/strict';
import { test } from 'node:test';
import permissionText from '../../../dist/main/extensions/permission-text.js';

const { permissionLines } = permissionText;

test('install prompts describe known permissions and never show raw API names', () => {
  const lines = permissionLines(['userScripts', 'webRequestAuthProvider', 'tabGroups', 'storage', '<all_urls>']);
  assert.equal(lines.length, 2);
  assert.ok(!lines.some((line) => /userScripts|webRequestAuthProvider|tabGroups/.test(line)));
});
