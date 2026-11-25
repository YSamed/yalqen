import assert from 'node:assert/strict';
import { test } from 'node:test';
import installEvents from '../../../dist/main/extensions/install-events.js';

const { installedDetails } = installEvents;

test('a new extension gets install, a new version gets update, the same version gets nothing', () => {
  assert.deepEqual(installedDetails(undefined, '1.0'), { reason: 'install' });
  assert.deepEqual(installedDetails('1.0', '1.1'), { reason: 'update', previousVersion: '1.0' });
  assert.equal(installedDetails('1.1', '1.1'), null);
});
