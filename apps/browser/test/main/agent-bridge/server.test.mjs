import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import serverModule from '../../../dist/main/agent-bridge/server.js';
import { fakeHost } from './fake-host.mjs';

const { startBridgeServer } = serverModule;
const TOKEN = 'test-token';
let server;
let url;

before(async () => {
  server = await startBridgeServer({ host: fakeHost(), token: () => TOKEN, version: '0.0.0' }, 0);
  url = `http://127.0.0.1:${server.port}/mcp`;
});

after(() => server.close());

const post = (body, headers = {}) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}`, ...headers },
    body: JSON.stringify(body),
  });

test('the official MCP client connects, lists tools and calls one', async () => {
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } } }),
  );
  assert.equal(client.getServerVersion().name, 'yalqen');
  const { tools } = await client.listTools();
  assert.ok(tools.some((tool) => tool.name === 'get_console_errors'));
  const result = await client.callTool({ name: 'list_tabs', arguments: {} });
  assert.equal(JSON.parse(result.content[0].text).length, 2);
  await client.close();
});

test('requests without the token are refused', async () => {
  const response = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Authorization: 'Bearer nope' });
  assert.equal(response.status, 401);
});

test('requests from a web page are refused', async () => {
  const response = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'http://localhost:3000' });
  assert.equal(response.status, 403);
});

test('notifications get 202, unknown methods a JSON-RPC error, GET 405', async () => {
  assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const unknown = await (await post({ jsonrpc: '2.0', id: 2, method: 'resources/list' })).json();
  assert.equal(unknown.error.code, -32601);
  const get = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(get.status, 405);
});

test('invalid JSON and wrong paths are rejected', async () => {
  const broken = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}` }, body: '{' });
  assert.equal(broken.status, 400);
  const other = await fetch(url.replace('/mcp', '/other'), { headers: { Authorization: `Bearer ${TOKEN}` } });
  assert.equal(other.status, 404);
});

test('a taken port falls back to the next one', async () => {
  const second = await startBridgeServer({ host: fakeHost(), token: () => TOKEN, version: '0.0.0' }, server.port);
  try {
    assert.notEqual(second.port, server.port);
  } finally {
    await second.close();
  }
});
