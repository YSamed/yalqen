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
    ]),
    app: { agentConnection: async () => null, releaseAgentConnection: () => {} },
    uiContents: { isDestroyed: () => false, send: (channel, data) => sent.push({ channel, data }) },
    pushState: () => {},
  });
  host.agentProjects = ['shop', 'admin'].map((id) => ({
    id,
    origins: new Set(),
    busy: false,
    chat: {
      state: () => ({ id }),
      snapshot: () => ({ state: { id }, messages: [{ text: `${id} conversation` }] }),
    },
    dispose: () => disposed.push(id),
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
  assert.deepEqual(cancelled, ['shop', 'admin', 'shop']);
});

test('unassigned and private tabs do not overwrite other tab assignments', () => {
  const { host, open } = fixture();
  open('shop-tab');
  host.selectAgentProject('shop');
  open('admin-tab');
  host.selectAgentProject('admin');
  open('unrelated-tab');
  assert.equal(host.agentProject.id, 'admin');
  open('private-tab', true);
  host.selectAgentProject('shop');
  host.tabs.activate('admin-tab');
  assert.equal(host.agentProject.id, 'admin');
  host.tabs.activate('private-tab');
  assert.equal(host.agentProject.id, 'admin');
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
