import assert from 'node:assert/strict';
import { test } from 'node:test';
import sidebarMenu from '../../dist/shared/sidebar-menu.js';
import relativeTime from '../../dist/shared/relative-time.js';

const { sidebarMenuAction } = sidebarMenu;
const { dayLabel } = relativeTime;

const menu = {
  kind: 'tabs',
  anchor: { x: 0, y: 0, width: 0, height: 0 },
  tint: null,
  tabs: [{ id: 'tab-1', title: 'Example', url: 'https://example.com/', faviconUrl: null }],
  spaces: [{ id: 'work', name: 'Work', icon: null, active: true }],
  chats: [{ id: 'chat-1', title: 'Plan', updatedAt: 1, branch: null }],
  commands: ['history', 'downloads'],
  downloadsActive: 0,
  history: [{ url: 'https://history.example/', title: 'Visited', faviconUrl: null }],
  bookmarks: [{ url: 'https://bookmark.example/', title: 'Saved', faviconUrl: null }],
};

test('sidebar menu actions pass only for commands and ids the open menu offered', () => {
  assert.deepEqual(sidebarMenuAction({ type: 'sidebar-command', command: 'history' }, menu), {
    type: 'sidebar-command',
    command: 'history',
  });
  assert.deepEqual(sidebarMenuAction({ type: 'switch-tab', id: 'tab-1' }, menu), { type: 'switch-tab', id: 'tab-1' });
  assert.deepEqual(sidebarMenuAction({ type: 'switch-space', id: 'work' }, menu), { type: 'switch-space', id: 'work' });
  assert.deepEqual(sidebarMenuAction({ type: 'open-chat', id: 'chat-1' }, menu), { type: 'open-chat', id: 'chat-1' });
  assert.deepEqual(sidebarMenuAction({ type: 'open-space-menu', id: 'work' }, menu), {
    type: 'open-space-menu',
    id: 'work',
  });
  assert.equal(sidebarMenuAction({ type: 'open-space-menu', id: 'home' }, menu), null);

  assert.deepEqual(sidebarMenuAction({ type: 'open-link', url: 'https://bookmark.example/' }, menu), {
    type: 'open-link',
    url: 'https://bookmark.example/',
  });

  assert.equal(sidebarMenuAction({ type: 'open-link', url: 'file:///etc/passwd' }, menu), null);
  assert.equal(sidebarMenuAction({ type: 'sidebar-command', command: 'import-space' }, menu), null);
  assert.equal(sidebarMenuAction({ type: 'switch-tab', id: 'tab-2' }, menu), null);
  assert.equal(sidebarMenuAction({ type: 'open-chat', id: 42 }, menu), null);
  assert.equal(sidebarMenuAction({ type: 'submit', input: 'x' }, menu), null);
  assert.equal(sidebarMenuAction(null, menu), null);
  assert.equal(sidebarMenuAction({ type: 'switch-tab', id: 'tab-1' }, undefined), null);
});

test('chat days read as today, yesterday, then a date', () => {
  const now = new Date(2026, 10, 23, 15).getTime();
  assert.equal(dayLabel(new Date(2026, 10, 23, 9).getTime(), 'en', now), 'Today');
  assert.equal(dayLabel(new Date(2026, 10, 22, 23).getTime(), 'en', now), 'Yesterday');
  assert.equal(dayLabel(new Date(2026, 10, 22, 23).getTime(), 'tr', now), 'Dün');
  assert.equal(dayLabel(new Date(2026, 10, 2).getTime(), 'en', now), 'November 2');
});

test('download rows and footer drops pass only for what the open menu offered', () => {
  const withDownloads = { ...menu, downloads: [{ id: 'dl-1', filename: 'a.zip', status: 'Done' }], footer: null };
  assert.deepEqual(sidebarMenuAction({ type: 'download-action', id: 'dl-1' }, withDownloads), {
    type: 'download-action',
    id: 'dl-1',
  });
  assert.equal(sidebarMenuAction({ type: 'download-action', id: 'dl-2' }, withDownloads), null);
  const drop = { type: 'place-footer-item', item: 'settings', index: 1 };
  assert.equal(sidebarMenuAction(drop, withDownloads), null);
  const customizable = { ...withDownloads, footer: { rect: menu.anchor, items: [] } };
  assert.deepEqual(sidebarMenuAction(drop, customizable), drop);
  assert.equal(sidebarMenuAction({ ...drop, item: 'tabs' }, customizable), null);
  assert.equal(sidebarMenuAction({ ...drop, index: 4 }, customizable), null);
  assert.equal(sidebarMenuAction({ ...drop, index: 0.5 }, customizable), null);
});
