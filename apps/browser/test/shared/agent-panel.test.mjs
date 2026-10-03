import assert from 'node:assert/strict';
import { test } from 'node:test';
import layout from '../../dist/shared/agent-panel.js';

test('panel resizing keeps the page usable on large and compact windows', () => {
  assert.equal(layout.fitAgentPanelWidth(400, 1280, 180), 400);
  assert.equal(layout.fitAgentPanelWidth(1200, 1280, 180), 784);
  assert.equal(layout.fitAgentPanelWidth(100, 1280, 180), 280);
  assert.equal(layout.fitAgentPanelWidth(400, 640, 44), 280);
});
