import assert from 'node:assert/strict';
import { test } from 'node:test';
import tabs from '../dist/main/tabs/tabs.js';

const { TabManager } = tabs;

function fixture() {
  let nativeReads = 0;
  const manager = new TabManager({
    isBookmarked: (url) => url === 'https://selected.example/',
    hasCertificateException: () => false,
    translation: () => ({ enabled: true, language: 'tr' }),
  });
  const first = manager.createRecord({ id: 'first', url: 'https://first.example/' });
  const selected = manager.createRecord({ id: 'selected', url: 'https://selected.example/', title: 'Selected' }, true);
  const native = (value) => () => {
    nativeReads++;
    return value;
  };
  for (const tab of [first, selected]) {
    tab.view = {
      webContents: {
        isDestroyed: () => false,
        isCurrentlyAudible: native(tab === selected),
        getZoomFactor: native(1.5),
        navigationHistory: { canGoBack: native(true), canGoForward: native(false) },
      },
    };
  }
  selected.pageLanguage = 'en';
  manager.tabs.push(first, selected);
  manager.activeId = 'selected';
  return { manager, selected, nativeReads: () => nativeReads };
}

test('a targeted snapshot matches full state without querying unrelated live tabs', () => {
  const f = fixture();
  const selected = f.manager.snapshotFor();
  assert.equal(f.nativeReads(), 3);
  assert.equal(selected.id, 'selected');
  assert.equal(selected.isPrivate, true);
  assert.equal(selected.bookmarked, true);
  assert.equal(selected.audible, true);
  assert.equal(selected.canGoBack, true);
  assert.deepEqual(selected.translation, { status: 'idle', available: true });
  assert.deepEqual(
    selected,
    f.manager.state().tabs.find((tab) => tab.id === 'selected'),
  );

  f.selected.title = 'Renamed';
  f.selected.muted = true;
  f.selected.translation = 'translating';
  const updated = f.manager.snapshotFor('selected');
  assert.equal(updated.title, 'Renamed');
  assert.equal(updated.muted, true);
  assert.equal(updated.translation.status, 'translating');
  assert.equal(selected.title, 'Selected');
});

test('targeted snapshots handle missing, inactive and discarded tabs', () => {
  const f = fixture();
  assert.equal(f.manager.snapshotFor('missing'), null);
  assert.equal(f.manager.snapshotFor(null), null);
  assert.equal(f.nativeReads(), 0);
  assert.equal(f.manager.snapshotFor('first').id, 'first');
  f.selected.view = null;
  const discarded = f.manager.snapshotFor();
  assert.equal(discarded.live, false);
  assert.equal(discarded.audible, false);
  assert.equal(discarded.canGoBack, false);
  assert.equal(discarded.canGoForward, false);
  assert.deepEqual(discarded.translation, { status: 'idle', available: false });
  f.manager.activeId = null;
  assert.equal(f.manager.snapshotFor(), null);
});
