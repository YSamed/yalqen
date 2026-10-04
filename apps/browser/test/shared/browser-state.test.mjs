import assert from 'node:assert/strict';
import { test } from 'node:test';
import state from '../../dist/shared/browser-state.js';

const { reuseBrowserState } = state;
const tab = (id) => ({
  id,
  title: 'Example',
  url: 'https://example.com/',
  faviconUrl: null,
  live: true,
  frozen: false,
  loading: false,
  pinned: false,
  security: 'secure',
  isPrivate: false,
  bookmarked: false,
  blockedPopups: 0,
  consoleErrors: 0,
  overrides: {
    cacheDisabled: false,
    network: null,
    colorScheme: null,
    reducedMotion: false,
    printMedia: false,
    userAgent: null,
    requestRules: false,
  },
  translation: { status: 'idle', available: false },
  autoReloadSeconds: null,
  audible: false,
  muted: false,
  canGoBack: false,
  canGoForward: false,
  agentObserved: false,
  agentReadAt: null,
  agentEpisode: null,
  agentRules: 0,
});
const fixture = () => ({
  tabs: [tab('a'), tab('b')],
  listOrder: ['a', 'b'],
  developer: false,
  activeTabId: 'a',
  pageFullScreen: false,
  windowFullScreen: false,
  addressPlaceholder: 'Search',
  panelCollapsed: false,
  panelSide: 'left',
  pinnedDisplay: 'always',
  sidebarVisible: true,
  toolbarVisible: true,
  toolbarTabs: true,
  toolbarButtons: ['settings', 'downloads'],
  material: 'opaque',
  device: {
    label: 'Phone',
    width: 300,
    height: 600,
    scale: 1,
    cornerRadius: 12,
    resizable: false,
    deviceScaleFactor: 2,
    x: 100,
    y: 100,
    viewWidth: 300,
    viewHeight: 600,
  },
  zoom: 1,
  defaultZoom: 1,
  downloads: { active: 0, progress: null, started: 0 },
  extensions: false,
  profile: 'personal',
  agentPanelOpen: false,
  agentSession: { id: null, directory: null, status: 'idle', exitCode: null, error: null },
  agentChat: { id: null, directory: null, status: 'idle', model: null, error: null },
  projectRun: { directory: null, command: null, status: 'idle', url: null, exitCode: null },
  agentElements: [],
  agentTerminal: false,
});
const changed = (value) =>
  typeof value === 'boolean'
    ? !value
    : typeof value === 'number'
      ? value + 1
      : value === null
        ? 'changed'
        : `${value}-changed`;
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

test('identical IPC snapshots reuse the root without mutating either input', () => {
  const previous = freeze(fixture());
  const next = freeze(structuredClone(previous));
  assert.equal(reuseBrowserState(previous, next), previous);
  assert.equal(reuseBrowserState(previous, previous), previous);
});

test('picked elements keep their identity until one changes', () => {
  const element = {
    id: 'yk_a1b2c3',
    tabId: 'tab-1',
    url: 'http://localhost/',
    label: 'div',
    component: null,
    source: null,
  };
  const previous = freeze({ ...fixture(), agentElements: [element] });
  const same = freeze(structuredClone(previous));
  assert.equal(reuseBrowserState(previous, same), previous);
  const added = freeze({ ...structuredClone(previous), agentElements: [element, { ...element, id: 'yk_d4e5f6' }] });
  const result = reuseBrowserState(previous, added);
  assert.deepEqual(result.agentElements, added.agentElements);
  assert.equal(result.agentElements[0], previous.agentElements[0]);
});

test('every tab field change reaches the renderer while other tabs remain stable', () => {
  const previous = freeze(fixture());
  for (const [key, value] of Object.entries(previous.tabs[1])) {
    if (typeof value === 'object' && value !== null) continue;
    const next = structuredClone(previous);
    next.tabs[1][key] = changed(value);
    freeze(next);
    const result = reuseBrowserState(previous, next);
    assert.deepEqual(result, next, key);
    assert.equal(result.tabs[0], previous.tabs[0], key);
    assert.notEqual(result.tabs[1], previous.tabs[1], key);
    assert.equal(result.listOrder, previous.listOrder, key);
    assert.equal(result.downloads, previous.downloads, key);
  }
});

test('nested tab changes invalidate only the changed value', () => {
  const previous = freeze(fixture());
  for (const nested of ['overrides', 'translation']) {
    for (const [key, value] of Object.entries(previous.tabs[1][nested])) {
      const next = structuredClone(previous);
      next.tabs[1][nested][key] = changed(value);
      const result = reuseBrowserState(previous, freeze(next));
      assert.deepEqual(result, next);
      assert.notEqual(result.tabs[1][nested], previous.tabs[1][nested]);
      assert.equal(
        result.tabs[1][nested === 'overrides' ? 'translation' : 'overrides'],
        previous.tabs[1][nested === 'overrides' ? 'translation' : 'overrides'],
      );
    }
  }
});

test('tab identity survives reorder, insertion and removal', () => {
  const previous = freeze(fixture());
  for (const ids of [['b', 'a'], ['b'], ['c', 'a', 'b'], []]) {
    const next = structuredClone(previous);
    next.tabs = ids.map(tab);
    next.listOrder = ids;
    const result = reuseBrowserState(previous, freeze(next));
    assert.deepEqual(result, next);
    for (const entry of result.tabs) {
      const old = previous.tabs.find((item) => item.id === entry.id);
      if (old) assert.equal(entry, old);
    }
  }
});

test('all window fields and nested summaries remain current while tabs are reused', () => {
  const previous = freeze(fixture());
  for (const [key, value] of Object.entries(previous)) {
    if (typeof value === 'object') continue;
    const next = structuredClone(previous);
    next[key] = changed(value);
    const result = reuseBrowserState(previous, freeze(next));
    assert.deepEqual(result, next, key);
    assert.equal(result.tabs, previous.tabs, key);
  }
  for (const nested of ['device', 'downloads', 'agentSession']) {
    for (const [key, value] of Object.entries(previous[nested])) {
      const next = structuredClone(previous);
      next[nested][key] = changed(value);
      const result = reuseBrowserState(previous, freeze(next));
      assert.deepEqual(result, next);
      assert.equal(result.tabs, previous.tabs);
      assert.notEqual(result[nested], previous[nested]);
    }
  }
  for (const [key, value] of [
    ['device', null],
    ['toolbarButtons', ['downloads', 'settings']],
    ['listOrder', ['b', 'a']],
  ]) {
    const next = structuredClone(previous);
    next[key] = value;
    assert.deepEqual(reuseBrowserState(previous, freeze(next)), next);
  }
});
