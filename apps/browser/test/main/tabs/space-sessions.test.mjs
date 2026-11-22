import assert from 'node:assert/strict';
import { test } from 'node:test';
import tabs from '../../../dist/main/tabs/tabs.js';

const { TabManager } = tabs;

function fixture() {
  const daily = { name: 'daily' };
  const isolatedSession = { name: 'work' };
  const isolated = new Set(['work']);
  const manager = new TabManager({
    window: { contentView: { removeChildView() {} } },
    isBookmarked: () => false,
    hasCertificateException: () => false,
    translation: () => ({ enabled: false, language: 'en' }),
    upgradeHttp: () => null,
    onChange() {},
    onHtmlFullScreenChange() {},
    closed: [],
    session: daily,
    privateSession: { name: 'private' },
    developerSession: { name: 'developer' },
    spaceIds: () => ['work', 'home'],
    spaceSession: (id) => (isolated.has(id) ? isolatedSession : null),
  });
  return { manager, daily, isolatedSession, isolated };
}

function liveView(session) {
  return {
    webContents: {
      session,
      closed: false,
      isDestroyed: () => false,
      close() {
        this.closed = true;
      },
      navigationHistory: { getAllEntries: () => [{ url: 'https://a.example/', title: 'A' }], getActiveIndex: () => 0 },
    },
  };
}

test('tabs use their space partition unless they are private or developer tabs', () => {
  const { manager: m, daily, isolatedSession } = fixture();
  const add = (id, space, isPrivate = false, developer = false) =>
    m.tabs.push(m.createRecord({ id, url: `https://${id}.example/`, title: id, space }, isPrivate, developer));
  add('main', '');
  add('home', 'home');
  add('work', 'work');
  add('secret', 'work', true);
  add('dev', 'work', false, true);
  assert.equal(m.tabSession('main'), daily);
  assert.equal(m.tabSession('home'), daily);
  assert.equal(m.tabSession('work'), isolatedSession);
  assert.equal(m.tabSession('secret').name, 'private');
  assert.equal(m.tabSession('dev').name, 'developer');
  m.activeId = 'work';
  assert.equal(m.activeSession(), isolatedSession);
});

test('a tab whose space changes partition drops its old page and keeps its history', () => {
  const { manager: m, daily, isolated } = fixture();
  const tab = m.createRecord({ id: 'w', url: 'https://w.example/', title: 'W', space: 'work' });
  const stays = m.createRecord({ id: 'h', url: 'https://h.example/', title: 'H', space: 'home' });
  m.tabs.push(tab, stays);
  const old = liveView({ name: 'work' });
  tab.view = old;
  stays.view = liveView(daily);
  isolated.delete('work');
  m.syncSpaces();
  assert.equal(tab.view, null);
  assert.equal(old.webContents.closed, true);
  assert.equal(tab.history.entries[0].url, 'https://a.example/');
  assert.notEqual(stays.view, null);
});

test('a favorite reopened from another space leaves its old partition', () => {
  const { manager: m } = fixture();
  const tab = m.createRecord({ id: 'f', url: 'https://f.example/', title: 'F', space: 'work' });
  m.tabs.push(tab);
  tab.view = liveView({ name: 'work' });
  m.favoriteTabs.set('https://f.example/', 'f');
  m.activate = () => {};
  m.openOrActivate('https://f.example/');
  assert.equal(tab.space, '');
  assert.equal(tab.view, null);
});
