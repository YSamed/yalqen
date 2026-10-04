import assert from 'node:assert/strict';
import { test } from 'node:test';
import layout from '../../dist/shared/agent-panel.js';

test('panel resizing keeps the page usable on large and compact windows', () => {
  assert.equal(layout.fitAgentPanelWidth(400, 1280, 180), 400);
  assert.equal(layout.fitAgentPanelWidth(1200, 1280, 180), 784);
  assert.equal(layout.fitAgentPanelWidth(100, 1280, 180), 280);
  assert.equal(layout.fitAgentPanelWidth(400, 640, 44), 280);
});

const tab = (id, extra = {}) => ({
  id,
  title: `Page ${id}`,
  url: `https://example.com/${id}`,
  isPrivate: false,
  agentObserved: false,
  ...extra,
});

test('tab attachments preserve selection order and deduplicate without attaching other tabs', () => {
  const tabs = [tab('one'), tab('two', { url: 'http://localhost:3000/', agentObserved: true }), tab('three')];
  assert.deepEqual(layout.resolveAgentContexts(['two', 'one', 'two'], tabs), [
    { id: 'two', title: 'Page two', url: 'http://localhost:3000/', local: true },
    { id: 'one', title: 'Page one', url: 'https://example.com/one', local: false },
  ]);
  assert.equal(layout.resolveAgentContexts(null, tabs).length, 0);
  assert.equal(layout.resolveAgentContexts([], tabs).length, 0);
  assert.equal(layout.resolveAgentContexts('one', tabs)[0].id, 'one');
});

test('tab attachments reject the whole request for missing, private or internal tabs', () => {
  const tabs = [tab('public'), tab('private', { isPrivate: true }), tab('internal', { url: 'yalqen://settings/' })];
  for (const denied of ['missing', 'private', 'internal'])
    assert.equal(layout.resolveAgentContexts(['public', denied], tabs), null);
  for (const invalid of [undefined, false, ['public', null], ['public', 1], ['']])
    assert.equal(layout.resolveAgentContexts(invalid, tabs), null);
});

test('tab attachments allow at most five distinct tabs after deduplication', () => {
  assert.equal(layout.MAX_CHAT_TABS, 5);
  const tabs = Array.from({ length: 6 }, (_, index) => tab(String(index)));
  assert.equal(layout.resolveAgentContexts(['0', '1', '2', '3', '4', '0'], tabs).length, 5);
  assert.equal(
    layout.resolveAgentContexts(
      tabs.map((entry) => entry.id),
      tabs,
    ),
    null,
  );
});

test('developer window session tabs are attachable only with the trusted window flag', () => {
  const tabs = [
    tab('local', { isPrivate: true, url: 'http://localhost:3000/', agentObserved: true }),
    tab('docs', { isPrivate: true }),
    tab('internal', { isPrivate: true, url: 'yalqen://settings/' }),
  ];
  assert.equal(layout.resolveAgentContexts(['local', 'docs'], tabs), null);
  assert.equal(layout.resolveAgentContexts(['local', 'docs'], tabs, false), null);
  assert.deepEqual(layout.resolveAgentContexts(['local', 'docs'], tabs, true), [
    { id: 'local', title: 'Page local', url: 'http://localhost:3000/', local: true },
    { id: 'docs', title: 'Page docs', url: 'https://example.com/docs', local: false },
  ]);
  assert.equal(layout.resolveAgentContexts(['local', 'internal'], tabs, true), null);
  assert.equal(layout.resolveAgentContexts(['local', 'missing'], tabs, true), null);
});
