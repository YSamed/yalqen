import assert from 'node:assert/strict';
import { test } from 'node:test';
import widgets from '../../dist/shared/sidebar-widgets.js';

const { moveSidebarWidget } = widgets;

test('a dragged widget lands before the drop index in either direction', () => {
  const order = ['media', 'clock', 'focus'];
  assert.deepEqual(moveSidebarWidget(order, 'focus', 0), ['focus', 'media', 'clock']);
  assert.deepEqual(moveSidebarWidget(order, 'media', 2), ['clock', 'media', 'focus']);
  assert.deepEqual(moveSidebarWidget(order, 'media', 3), ['clock', 'focus', 'media']);
  assert.deepEqual(order, ['media', 'clock', 'focus']);
});

test('a drop that keeps the order or names an unknown widget returns the same list', () => {
  const order = ['media', 'clock'];
  assert.equal(moveSidebarWidget(order, 'clock', 1), order);
  assert.equal(moveSidebarWidget(order, 'clock', 2), order);
  assert.equal(moveSidebarWidget(order, 'focus', 0), order);
});
