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
      'take_screenshot',
      'get_selected_element',
      'list_selections',
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
