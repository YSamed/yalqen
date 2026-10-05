import assert from 'node:assert/strict';
import { test } from 'node:test';
import projectsModule from '../../../dist/main/window/agent-project-tabs.js';

const { AgentProjectTabs } = projectsModule;
const project = (id, ...origins) => ({ id, origins: new Set(origins) });
const tab = (id, url = 'about:blank', isPrivate = false) => ({ id, url, isPrivate });

test('switching browser tabs restores independently assigned projects, even on the same origin', () => {
  const links = new AgentProjectTabs();
  const projects = [project('shop', 'http://localhost:3000'), project('admin', 'http://localhost:3000')];
  const shop = tab('a', 'http://localhost:3000/shop');
  const admin = tab('b', 'http://localhost:3000/admin');
  links.bind(shop, 'shop');
  links.bind(admin, 'admin');
  for (let i = 0; i < 3; i++) {
    assert.equal(links.projectFor(shop, projects), 'shop');
    assert.equal(links.projectFor(admin, projects), 'admin');
  }
  links.bind(admin, 'shop');
  assert.equal(links.projectFor(admin, projects), 'shop');
});

test('new tabs match a unique claimed origin and keep their project through navigation', () => {
  const links = new AgentProjectTabs();
  const projects = [project('shop', 'http://localhost:3000'), project('admin', 'http://localhost:5173')];
  assert.equal(links.projectFor(tab('a', 'http://localhost:3000/cart'), projects), 'shop');
  assert.equal(links.projectFor(tab('b', 'http://localhost:5173/login'), projects), 'admin');
  assert.equal(links.projectFor(tab('a', 'https://example.com/'), projects), 'shop');
  assert.equal(links.projectFor(tab('c', 'https://example.com/'), projects), null);
  assert.equal(links.projectFor(tab('d'), projects), null);
  assert.equal(links.projectFor(null, projects), null);
});

test('ambiguous origins and projects without claimed origins do not take unrelated tabs', () => {
  const links = new AgentProjectTabs();
  const projects = [project('one', 'http://localhost:3000'), project('two', 'http://localhost:3000'), project('empty')];
  assert.equal(links.projectFor(tab('a', 'http://localhost:3000/'), projects), null);
  assert.equal(links.projectFor(tab('b', 'http://localhost:5173/'), projects), null);
});

test('private tabs stay excluded while developer tabs can retain projects', () => {
  const links = new AgentProjectTabs();
  const projects = [project('shop', 'http://localhost:3000')];
  const privateTab = tab('a', 'http://localhost:3000/', true);
  links.bind(privateTab, 'shop');
  assert.equal(links.projectFor(privateTab, projects), null);
  assert.equal(links.projectFor(tab('a'), projects), null);
  links.bind(privateTab, 'shop', true);
  assert.equal(links.projectFor(privateTab, projects, true), 'shop');
  assert.equal(links.projectFor(privateTab, projects), null);
});

test('closed tabs and projects release their assignments without affecting other tabs', () => {
  const links = new AgentProjectTabs();
  const projects = [project('shop'), project('admin')];
  links.bind(tab('a'), 'shop');
  links.bind(tab('b'), 'admin');
  links.prune(new Set(['b']));
  assert.equal(links.projectFor(tab('a'), projects), null);
  assert.equal(links.projectFor(tab('b'), projects), 'admin');
  links.removeProject('admin');
  assert.equal(links.projectFor(tab('b'), projects), null);
  links.bind(tab('b'), 'shop');
  assert.equal(links.projectFor(tab('b'), [project('admin')]), null);
});
