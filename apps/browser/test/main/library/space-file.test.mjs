import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import workspaces from '../../../dist/main/library/workspaces.js';

const { WorkspaceStore, parseSpaceFile, spaceFileText, spacePartition } = workspaces;
const ID = '0b9a6f3e-3c1d-4f6e-9a8b-1c2d3e4f5a6b';

const window = {
  activeTabId: 'b',
  tabs: [
    { id: 'a', url: 'https://mail.example/', title: 'Mail', pinnedUrl: 'https://mail.example/', group: null },
    { id: 'b', url: 'https://docs.example/', title: 'Docs', pinnedUrl: null, group: 'Work' },
    { id: 'c', url: 'https://wiki.example/', title: 'Wiki', pinnedUrl: null, group: 'Team' },
  ],
  collapsedGroups: ['Work'],
  groupParents: { Team: 'Work' },
};

function withStore(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-space-file-'));
  const forgotten = [];
  try {
    run(new WorkspaceStore(dir, (partition) => forgotten.push(partition)), forgotten, dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('space partitions exist only for isolated spaces with a UUID id', () => {
  assert.equal(spacePartition(ID, true), `persist:space-${ID}`);
  assert.equal(spacePartition(ID, false), null);
  assert.equal(spacePartition('', true), null);
  assert.equal(spacePartition('../daily', true), null);
  assert.equal(spacePartition(`${ID}x`, true), null);
});

test('a space file keeps pinned tabs, folders and the partition flag', () => {
  const text = spaceFileText({ name: 'Work', icon: '💼', isolated: true, window });
  const parsed = parseSpaceFile(text);
  assert.equal(parsed.name, 'Work');
  assert.equal(parsed.icon, '💼');
  assert.equal(parsed.isolated, true);
  assert.deepEqual(
    parsed.window.tabs.map(({ url, pinnedUrl, group, history, faviconUrl }) => ({
      url,
      pinnedUrl,
      group,
      history,
      faviconUrl,
    })),
    [
      {
        url: 'https://mail.example/',
        pinnedUrl: 'https://mail.example/',
        group: null,
        history: null,
        faviconUrl: null,
      },
      { url: 'https://docs.example/', pinnedUrl: null, group: 'Work', history: null, faviconUrl: null },
      { url: 'https://wiki.example/', pinnedUrl: null, group: 'Team', history: null, faviconUrl: null },
    ],
  );
  assert.deepEqual(parsed.window.collapsedGroups, ['Work']);
  assert.deepEqual(parsed.window.groupParents, { Team: 'Work' });
  assert.equal(parsed.window.activeTabId, parsed.window.tabs[1].id);
  assert.notEqual(parsed.window.tabs[0].id, 'a');
});

test('space files from outside are validated', () => {
  const valid = JSON.parse(spaceFileText({ name: 'Work', icon: null, isolated: false, window }));
  const parse = (value) => parseSpaceFile(typeof value === 'string' ? value : JSON.stringify(value));
  assert.equal(parse('{not json'), null);
  assert.equal(parse('null'), null);
  assert.equal(parse({ ...valid, format: 'other' }), null);
  assert.equal(parse({ ...valid, version: 2 }), null);
  assert.equal(parse({ ...valid, name: '' }), null);
  assert.equal(parse({ ...valid, name: 'a\u0000b' }), null);
  assert.equal(parse({ ...valid, window: null }), null);
  assert.equal(parse({ ...valid, window: { tabs: 'x' } }), null);
  assert.equal(parse({ ...valid, isolated: 'true' }).isolated, false);
  assert.equal(parse({ ...valid, icon: 42 }).icon, null);
  assert.equal(parse('x'.repeat(3 * 1024 * 1024)), null);
  const hostile = parse({
    ...valid,
    window: {
      activeTabId: 'x',
      tabs: [
        { id: 'x', url: 'javascript:alert(1)', title: 'x' },
        { id: 'y', url: 'file:///etc/passwd', title: 'y' },
        { id: 'z', url: 'https://ok.example/', title: 'z', pinnedUrl: 'data:text/html,hi', group: 'G\u0007' },
      ],
      groupParents: { G: 'Missing' },
    },
  });
  assert.deepEqual(
    hostile.window.tabs.map(({ url, pinnedUrl, group }) => ({ url, pinnedUrl, group })),
    [{ url: 'https://ok.example/', pinnedUrl: null, group: null }],
  );
  assert.deepEqual(hostile.window.groupParents, {});
});

test('importing into another profile creates a fresh space and renames on collision', () => {
  withStore((source) => {
    const id = source.importText(spaceFileText({ name: 'Work', icon: '💼', isolated: true, window }));
    const text = source.exportText(id, null);
    withStore((target) => {
      target.create('Work');
      const imported = target.importText(text);
      assert.ok(imported);
      assert.notEqual(imported, id);
      const space = target.spaces().find((item) => item.id === imported);
      assert.equal(space.name, 'Work 2');
      assert.equal(space.icon, '💼');
      assert.equal(target.isolated(imported), true);
      assert.equal(target.partition(imported), `persist:space-${imported}`);
      assert.equal(target.open(imported).tabs.length, 3);
      assert.equal(target.importText('{}'), null);
    });
  });
});

test('the partition flag persists and removing a space forgets its partition data', () => {
  withStore((store, forgotten, dir) => {
    const plain = store.create('Plain');
    const isolated = store.create('Isolated');
    assert.equal(store.partition(isolated), null);
    assert.equal(store.setIsolated(isolated, true), true);
    assert.equal(new WorkspaceStore(dir).partition(isolated), `persist:space-${isolated}`);
    assert.equal(store.setIsolated(isolated, false), true);
    assert.equal(store.partition(isolated), null);
    assert.deepEqual(store.storedPartitions(), [`persist:space-${isolated}`]);
    assert.equal(store.remove(plain), true);
    assert.deepEqual(forgotten, []);
    assert.equal(store.remove(isolated), true);
    assert.deepEqual(forgotten, [`persist:space-${isolated}`]);
  });
});

test('spaces can share a profile and its data is kept until the last space using it is removed', () => {
  withStore((store, forgotten, dir) => {
    const work = store.create('Work');
    const client = store.create('Client');
    assert.equal(store.setProfile(work, 'new'), true);
    const profile = store.profile(work);
    assert.match(profile, /^[0-9a-f-]{36}$/);
    assert.equal(store.setProfile(client, profile), true);
    assert.equal(store.partition(client), `persist:space-${profile}`);
    const [shared, ...others] = store.profiles();
    assert.deepEqual(others, []);
    assert.equal(shared.id, profile);
    assert.deepEqual(shared.spaceIds.toSorted(), [work, client].toSorted());
    assert.equal(store.setProfile(client, ID), false);

    assert.equal(store.remove(work), true);
    assert.deepEqual(forgotten, []);
    assert.equal(new WorkspaceStore(dir).partition(client), `persist:space-${profile}`);
    assert.equal(store.remove(client), true);
    assert.deepEqual(forgotten, [`persist:space-${profile}`]);
  });
});

test('the default space can use a profile and it is cleared with the others', () => {
  withStore((store, forgotten, dir) => {
    assert.equal(store.partition(''), null);
    const work = store.create('Work');
    assert.equal(store.setProfile('', 'new'), true);
    const profile = store.profile('');
    assert.equal(new WorkspaceStore(dir).partition(''), `persist:space-${profile}`);
    assert.equal(store.setProfile(work, profile), true);
    assert.deepEqual(store.storedPartitions(), [`persist:space-${profile}`]);
    assert.equal(store.remove(work), true);
    assert.deepEqual(forgotten, []);

    assert.equal(store.setProfile('', null), true);
    assert.equal(store.partition(''), null);
    assert.deepEqual(store.storedPartitions(), [`persist:space-${profile}`]);
  });
});

test('hand-edited profile ids that are not ids are ignored', () => {
  withStore((store, forgotten, dir) => {
    fs.writeFileSync(path.join(dir, 'space-profiles.json'), JSON.stringify({ default: '../daily', known: ['x', ID] }));
    const reloaded = new WorkspaceStore(dir);
    assert.equal(reloaded.partition(''), null);
    assert.deepEqual(reloaded.storedPartitions(), [`persist:space-${ID}`]);
  });
});

test('a space keeps its own frame theme across restarts, export and import', () => {
  withStore((store, _forgotten, dir) => {
    const id = store.create('Design');
    const theme = {
      colors: ['#ff66aa', '#6644ff'],
      intensity: 70,
      texture: 'dots',
      textureStrength: 30,
    };
    assert.equal(store.setTheme(id, { ...theme, colors: [...theme.colors, 'nope'] }), true);
    assert.equal(store.setTheme('missing', theme), false);
    assert.deepEqual(new WorkspaceStore(dir).spaces()[0].theme, theme);

    const imported = store.importText(store.exportText(id, null));
    assert.deepEqual(store.spaces().find((space) => space.id === imported).theme, theme);

    assert.equal(store.setTheme(id, null), true);
    assert.equal('theme' in store.spaces().find((space) => space.id === id), false);
  });
});
