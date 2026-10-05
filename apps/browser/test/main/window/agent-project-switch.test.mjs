import assert from 'node:assert/strict';
import { test } from 'node:test';
import windowModule from '../../../dist/main/window/window.js';
import linksModule from '../../../dist/main/window/agent-project-tabs.js';

const { YalqenWindow } = windowModule;
const { AgentProjectTabs } = linksModule;

function fixture() {
  const sent = [];
  const disposed = [];
  const cancelled = [];
  const tabs = new Map();
  let activeTabId = null;
  const host = Object.create(YalqenWindow.prototype);
  Object.assign(host, {
    isPrivate: false,
    isDeveloper: false,
    activeProjectId: 'shop',
    projectTabs: new AgentProjectTabs(),
    projectElements: new Map(),
    pickedElements: [],
    references: new Map(),
    visualComparisons: new Map(),
    responsiveScans: new Map([
      ['shop', { cancel: () => cancelled.push('shop'), clear: () => {} }],
      ['admin', { cancel: () => cancelled.push('admin'), clear: () => {} }],
      ['loose', { cancel: () => cancelled.push('loose'), clear: () => {} }],
    ]),
    app: { agentConnection: async () => null, releaseAgentConnection: () => {} },
    uiContents: { isDestroyed: () => false, send: (channel, data) => sent.push({ channel, data }) },
    pushState: () => {},
  });
  host.agentProjects = ['shop', 'admin', 'loose'].map((id) => ({
    id,
    directory: id === 'loose' ? null : `/code/${id}`,
    origins: new Set(),
    busy: false,
    chat: {
      state: () => ({ id }),
      snapshot: () => ({ state: { id }, messages: [{ text: `${id} conversation` }] }),
    },
    dispose: () => disposed.push(id),
    focusTab: () => false,
    shareConversation: () => {},
    retainTabs: () => {},
  }));
  host.tabs = {
    get activeTabId() {
      return activeTabId;
    },
    snapshotFor: (id = activeTabId) => tabs.get(id) ?? null,
    open: (url, { activate } = {}) => {
      const id = `tab-${tabs.size}`;
      tabs.set(id, { id, url, isPrivate: false });
      if (activate !== false) host.tabs.activate(id);
      else host.syncAgentProjectWithTab();
      return id;
    },
    activate: (id) => {
      activeTabId = id;
      host.syncAgentProjectWithTab();
    },
  };
  const open = (id, isPrivate = false) => {
    tabs.set(id, { id, url: 'about:blank', isPrivate });
    host.tabs.activate(id);
  };
  return { host, tabs, open, sent, disposed, cancelled };
}

test('browser tab switches restore the selected chat and picked elements without stopping a busy project', () => {
  const { host, open, sent, disposed, cancelled } = fixture();
  open('shop-tab');
  assert.equal(host.selectAgentProject('shop'), true);
  host.setPickedElements([{ id: 'shop-element' }]);
  open('admin-tab');
  assert.equal(host.selectAgentProject('admin'), true);
  assert.deepEqual(host.pickedElements, []);
  host.setPickedElements([{ id: 'admin-element' }]);
  host.agentProjects[1].busy = true;

  host.tabs.activate('shop-tab');
  assert.equal(host.agentProject.id, 'shop');
  assert.deepEqual(host.pickedElements, [{ id: 'shop-element' }]);
  assert.equal(JSON.parse(sent.at(-1).data).messages[0].text, 'shop conversation');
  host.tabs.activate('admin-tab');
  assert.equal(host.agentProject.id, 'admin');
  assert.deepEqual(host.pickedElements, [{ id: 'admin-element' }]);
  assert.equal(JSON.parse(sent.at(-1).data).messages[0].text, 'admin conversation');
  assert.deepEqual(disposed, []);
  // New tabs start on the folderless project until they are given one.
  assert.deepEqual(cancelled, ['shop', 'loose', 'shop', 'loose', 'admin', 'shop']);
});

test('tabs without a project show the folderless project and leave other tab assignments alone', () => {
  const { host, open } = fixture();
  open('shop-tab');
  host.selectAgentProject('shop');
  open('admin-tab');
  host.selectAgentProject('admin');
  open('unrelated-tab');
  assert.equal(host.agentProject.id, 'loose');
  open('private-tab', true);
  host.selectAgentProject('shop');
  host.tabs.activate('admin-tab');
  assert.equal(host.agentProject.id, 'admin');
  host.tabs.activate('private-tab');
  assert.equal(host.agentProject.id, 'loose');
  host.tabs.activate('shop-tab');
  assert.equal(host.agentProject.id, 'shop');
  assert.equal(host.selectAgentProject('missing'), false);
});

test('a dev server tab is bound to its own project before activation, including shared origins', () => {
  const { host, open } = fixture();
  open('shop-tab');
  host.selectAgentProject('shop');
  host.agentProjects[0].origins.add('http://localhost:3000');
  const project = host.addProject();
  project.claim('http://localhost:3000');
  project.options.onUrl(project, 'http://localhost:3000/');
  assert.equal(host.agentProject, project);
  const serverTabId = host.tabs.activeTabId;
  host.tabs.activate('shop-tab');
  assert.equal(host.agentProject.id, 'shop');
  host.tabs.activate(serverTabId);
  assert.equal(host.agentProject, project);
  project.dispose();
});

test('closing a project releases its tab links and captured references', () => {
  const { host, open, disposed } = fixture();
  open('shop-tab');
  host.selectAgentProject('shop');
  host.references.set('shop-reference', { id: 'shop-reference' });
  host.setPickedElements([{ id: 'shop-reference' }]);
  open('admin-tab');
  host.selectAgentProject('admin');
  host.references.set('admin-reference', { id: 'admin-reference' });
  host.setPickedElements([{ id: 'admin-reference' }]);
  assert.equal(host.references.size, 2);
  assert.equal(host.closeAgentProject('shop'), true);
  assert.deepEqual(disposed, ['shop']);
  assert.equal(host.references.has('shop-reference'), false);
  assert.equal(host.references.has('admin-reference'), true);
  assert.equal(host.projectTabs.projectFor(host.tabs.snapshotFor('shop-tab'), host.agentProjects), null);
});

test('finishing a send after a tab switch clears only the sending project attachments', async () => {
  const { host, open, tabs } = fixture();
  host.state = () => ({ tabs: [...tabs.values()] });
  let finishSend;
  host.agentProjects[0].chat.send = () => new Promise((resolve) => (finishSend = resolve));
  open('shop-tab');
  host.selectAgentProject('shop');
  host.setPickedElements([{ id: 'shop-element' }]);
  const sending = host.sendAgentChat('shop', 'Fix this', []);
  await new Promise((resolve) => setImmediate(resolve));
  open('admin-tab');
  host.selectAgentProject('admin');
  host.setPickedElements([{ id: 'admin-element' }]);
  finishSend(true);
  assert.equal(await sending, true);
  assert.deepEqual(host.pickedElements, [{ id: 'admin-element' }]);
  host.tabs.activate('shop-tab');
  assert.deepEqual(host.pickedElements, []);
});

test('choosing another folder moves the tab to that folder project instead of changing a shared one', () => {
  const host = Object.create(YalqenWindow.prototype);
  const created = [];
  const project = (id, directory, busy = false) => ({ id, directory, busy });
  const shop = project('shop', '/code/shop', true);
  const admin = project('admin', '/code/admin');
  const fresh = project('fresh', null);
  host.agentProjects = [shop, admin, fresh];
  host.addProject = () => {
    const next = project(`new-${created.length}`, null);
    created.push(next);
    host.agentProjects.push(next);
    return next;
  };
  assert.equal(host.projectForDirectory(shop, '/code/shop'), shop);
  assert.equal(host.projectForDirectory(shop, '/code/admin'), admin);
  assert.equal(host.projectForDirectory(fresh, '/code/admin'), admin);
  const blog = host.projectForDirectory(fresh, '/code/blog');
  assert.notEqual(blog, fresh);
  assert.deepEqual(created, [blog]);
  while (host.agentProjects.length < 6) host.addProject();
  assert.equal(host.projectForDirectory(shop, '/code/other'), null);
});

test('a project with a folder closes with its last tab, and the folderless one stays', () => {
  const { host, tabs, open, disposed } = fixture();
  open('shop-tab');
  host.selectAgentProject('shop');
  open('shop-docs');
  host.selectAgentProject('shop');
  open('other-tab');
  tabs.delete('shop-tab');
  host.syncAgentProjectWithTab();
  assert.deepEqual(disposed, []);
  tabs.delete('shop-docs');
  host.syncAgentProjectWithTab();
  assert.deepEqual(disposed, ['shop']);
  assert.deepEqual(
    host.agentProjects.map((project) => project.id),
    ['admin', 'loose'],
  );
  assert.equal(host.agentProject.id, 'loose');
});
