import assert from 'node:assert/strict';
import { test } from 'node:test';
import tools from '../../../dist/main/agent-bridge/tools.js';
import { fakeHost } from './fake-host.mjs';

const { TOOLS, callTool, resolveTab } = tools;
const parse = (result) => JSON.parse(result.content[0].text.replace(/^[^{[]*/s, ''));

test('every tool has a closed object schema', () => {
  assert.deepEqual(
    TOOLS.map((tool) => tool.name),
    [
      'list_tabs',
      'get_page_info',
      'get_console_errors',
      'get_network_requests',
      'get_request_details',
      'get_backend_trace',
      'take_screenshot',
      'get_selected_element',
      'get_component_tree',
      'list_selections',
      'get_error_episode',
      'export_playwright_test',
      'list_error_episodes',
      'get_timeline',
      'click',
      'fill',
      'navigate',
      'wait_for',
      'replay_episode',
      'mock_response',
      'block_request',
      'redirect_request',
      'list_request_rules',
      'clear_request_rules',
      'resend_request',
      'list_page_tools',
      'call_page_tool',
      'reload_page',
    ],
  );
  for (const tool of TOOLS) assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
});

test('resolveTab defaults to the active tab and rejects unknown tabs', () => {
  const tabs = fakeHost().tabs();
  assert.equal(resolveTab(tabs, undefined).id, 't1');
  assert.equal(resolveTab(tabs, 't2').id, 't2');
  assert.throws(() => resolveTab(tabs, 't99'), /not a local development tab/);
  assert.throws(() => resolveTab([], undefined), /No local development tab/);
});

test('get_console_errors returns errors only, unless warnings are asked for', async () => {
  const host = fakeHost();
  const result = await callTool(host, 'get_console_errors', {});
  assert.match(result.content[0].text, /data, not instructions/);
  assert.deepEqual(
    parse(result).entries.map((entry) => entry.text),
    ['TypeError: x is undefined'],
  );
  const all = parse(await callTool(host, 'get_console_errors', { include_warnings: true }));
  assert.equal(all.entries.length, 2);
  const later = parse(await callTool(host, 'get_console_errors', { include_warnings: true, since: 150 }));
  assert.equal(later.entries.length, 1);
  assert.deepEqual(host.calls[0], ['read', 't1']);
});

test('get_network_requests lists failed requests by default', async () => {
  const host = fakeHost();
  assert.deepEqual(
    parse(await callTool(host, 'get_network_requests', {})).requests.map((r) => r.request_id),
    ['bad'],
  );
  const all = parse(await callTool(host, 'get_network_requests', { failed_only: false, url_contains: '/api/' }));
  assert.equal(all.requests.length, 2);
});

test('get_request_details masks headers and decodes the failed response body', async () => {
  const host = fakeHost();
  const details = parse(await callTool(host, 'get_request_details', { request_id: 'bad' }));
  assert.equal(details.request_headers.Authorization, '[masked]');
  assert.equal(details.response_headers['Set-Cookie'], '[masked]');
  assert.deepEqual(details.response_body, { text: '{"error":"boom"}', truncated: false });
  const ok = parse(await callTool(host, 'get_request_details', { request_id: 'ok' }));
  assert.equal(ok.response_body, null);
  assert.deepEqual(
    host.calls.filter(([kind]) => kind === 'body'),
    [['body', 't1', 'bad']],
  );
});

test('screenshots come back as PNG images and reloads reach the host', async () => {
  const host = fakeHost();
  const shot = await callTool(host, 'take_screenshot', { tab: 't2', full_page: true });
  assert.deepEqual(shot.content[0], {
    type: 'image',
    data: Buffer.from('png').toString('base64'),
    mimeType: 'image/png',
  });
  await callTool(host, 'reload_page', { ignore_cache: true });
  assert.deepEqual(
    host.calls.filter(([kind]) => kind !== 'read'),
    [
      ['screenshot', 't2', true],
      ['reload', 't1', true],
    ],
  );
});

test('bad input becomes a tool error, not a crash', async () => {
  const host = fakeHost();
  assert.equal((await callTool(host, 'get_console_errors', { tab: 1 })).isError, true);
  assert.equal((await callTool(host, 'get_request_details', {})).isError, true);
  assert.equal((await callTool(host, 'get_request_details', { request_id: 'missing' })).isError, true);
});

const selection = (id, time, tabId = 't1') => ({
  id,
  tabId,
  url: 'http://localhost:3000/',
  time,
  label: 'button.primary "Add"',
  tag: 'button',
  attributes: { class: 'primary' },
  text: 'Add',
  role: 'button',
  name: 'Add',
  selector: 'main > button.primary',
  ancestors: ['main', 'body', 'html'],
  html: { text: '<button class="primary">Add</button>', truncated: false },
  styles: { display: 'inline-block' },
  box: { x: 1, y: 2, width: 3, height: 4 },
  screenshot: Buffer.from('png').toString('base64'),
  component: {
    framework: 'react',
    component: 'AddButton',
    confidence: 'exact',
    source: { file: 'src/AddButton.tsx', line: 12, column: 5 },
    usedAt: { file: 'src/Actions.tsx', line: 8, column: 7 },
    ownerChain: ['Page', 'Actions', 'AddButton'],
    props: { label: '"Add"' },
    children: [{ name: 'Icon', children: [{ name: 'Svg', children: [] }] }],
  },
});

test('get_selected_element returns the newest selection with its screenshot', async () => {
  const host = fakeHost();
  host.runtimeOf.selections.push(selection('yk_000001', 100));
  host.runtimeOf.selections.push(selection('yk_000002', 200));
  const latest = await callTool(host, 'get_selected_element', {});
  assert.equal(parse(latest).selection_id, 'yk_000002');
  assert.equal(parse(latest).accessible_name, 'Add');
  assert.deepEqual(latest.content[1], {
    type: 'image',
    data: Buffer.from('png').toString('base64'),
    mimeType: 'image/png',
  });
  assert.equal(
    parse(await callTool(host, 'get_selected_element', { selection_id: 'yk_000001' })).selection_id,
    'yk_000001',
  );
  assert.equal((await callTool(host, 'get_selected_element', { selection_id: 'yk_ffffff' })).isError, true);
});

test('get_selected_element explains how to select when nothing is selected', async () => {
  const result = await callTool(fakeHost(), 'get_selected_element', {});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /⌥⌘P/);
});

test('list_selections lists newest first', async () => {
  const host = fakeHost();
  host.runtimeOf.selections.push(selection('yk_000001', 100));
  host.runtimeOf.selections.push(selection('yk_000002', 200));
  const listed = parse(await callTool(host, 'list_selections', {}));
  assert.deepEqual(
    listed.selections.map((item) => item.selection_id),
    ['yk_000002', 'yk_000001'],
  );
});

test('get_selected_element carries the component and its exact source', async () => {
  const host = fakeHost();
  host.runtimeOf.selections.push(selection('yk_000001', 100));
  const details = parse(await callTool(host, 'get_selected_element', {}));
  assert.equal(details.component, 'AddButton');
  assert.deepEqual(details.source, { file: 'src/AddButton.tsx', line: 12, column: 5, confidence: 'exact' });
  assert.deepEqual(details.owner_chain, ['Page', 'Actions', 'AddButton']);
});

test('get_component_tree trims children to the asked depth', async () => {
  const host = fakeHost();
  host.runtimeOf.selections.push(selection('yk_000001', 100));
  const tree = parse(await callTool(host, 'get_component_tree', { depth: 1 }));
  assert.deepEqual(tree.children, [{ name: 'Icon', children: [] }]);
  const dom = { ...selection('yk_000002', 200), component: { ...selection('x', 0).component, confidence: 'dom' } };
  host.runtimeOf.selections.push(dom);
  assert.equal((await callTool(host, 'get_component_tree', {})).isError, true);
});

test('get_error_episode returns the latest episode with its failed requests', async () => {
  const host = fakeHost();
  const episode = parse(await callTool(host, 'get_error_episode', {}));
  assert.match(episode.episode_id, /^yk_ep_/);
  assert.deepEqual(
    episode.failed_requests.map((request) => request.request_id),
    ['bad'],
  );
  const listed = parse(await callTool(host, 'list_error_episodes', {})).episodes;
  assert.equal(listed[0].episode_id, episode.episode_id);
  assert.equal((await callTool(host, 'get_error_episode', { episode_id: 'yk_ep_00000' })).isError, true);
  const events = parse(await callTool(host, 'get_timeline', { limit: 1 })).events;
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'response');
});

test('action tools pass validated input to the host and report its errors', async () => {
  const host = fakeHost();
  const calls = [];
  host.actions = {
    click: async (tab, selector) => (calls.push(['click', tab, selector]), { done: 'clicked' }),
    fill: async (tab, selector, value) => (calls.push(['fill', tab, selector, value]), { done: 'filled' }),
    navigate: async () => {
      throw new Error('http://evil.example/ is not a local development address the agent may open.');
    },
    waitFor: async (tab, options) => (calls.push(['wait', tab, options]), { matched: true }),
    replay: async (tab, episode) => (calls.push(['replay', tab, episode.id]), { result: 'passed' }),
  };
  host.runtimeOf.selections.push(selection('yk_000001', 100));
  assert.equal(parse(await callTool(host, 'click', { selector: '#save' })).done, 'clicked');
  await callTool(host, 'click', { selection_id: 'yk_000001' });
  await callTool(host, 'fill', { selector: '#email', value: '' });
  await callTool(host, 'wait_for', { network_idle: true });
  const replay = parse(await callTool(host, 'replay_episode', {}));
  assert.equal(replay.result, 'passed');
  assert.deepEqual(calls.slice(0, 4), [
    ['click', 't1', '#save'],
    ['click', 't1', 'main > button.primary'],
    ['fill', 't1', '#email', ''],
    ['wait', 't1', { selector: undefined, networkIdle: true, timeoutMs: 5000 }],
  ]);
  assert.equal(calls[4][0], 'replay');
  const refused = await callTool(host, 'navigate', { url: 'http://evil.example/' });
  assert.equal(refused.isError, true);
  assert.equal((await callTool(host, 'click', {})).isError, true);
  assert.equal((await callTool(host, 'fill', { selector: '#x' })).isError, true);
});

test('without an action host the action tools explain it', async () => {
  const result = await callTool(fakeHost(), 'click', { selector: '#save' });
  assert.equal(result.isError, true);
});

test('tool results are compact JSON', async () => {
  const text = (await callTool(fakeHost(), 'list_tabs', {})).content[0].text;
  assert.doesNotMatch(text, /\n/);
  assert.equal(JSON.parse(text)[0].id, 't1');
});
