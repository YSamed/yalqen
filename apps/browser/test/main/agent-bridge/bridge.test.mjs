import assert from 'node:assert/strict';
import { test } from 'node:test';
import bridgeModule from '../../../dist/main/agent-bridge/bridge.js';
import { fakeHost } from './fake-host.mjs';

const { AgentBridge, setupSnippet } = bridgeModule;

function bridge(state) {
  let changes = 0;
  const instance = new AgentBridge({
    enabled: () => state.enabled,
    host: fakeHost(),
    token: () => 'tok',
    version: '0.0.0',
    onChange: () => changes++,
    firstPort: 0,
  });
  return { instance, changes: () => changes };
}

test('the server runs only while the setting is on', async () => {
  const state = { enabled: false };
  const { instance } = bridge(state);
  await instance.sync();
  assert.equal(instance.port, null);
  assert.equal(instance.snippet('claude'), null);

  state.enabled = true;
  await instance.sync();
  const port = instance.port;
  assert.ok(port > 0);
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: 'POST',
    headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_tabs', arguments: {} } }),
  });
  assert.equal(response.status, 200);
  assert.equal(instance.status().calls, 1);

  state.enabled = false;
  await instance.sync();
  assert.equal(instance.port, null);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/mcp`));
});

test('setup snippets carry the port and token', () => {
  assert.equal(
    setupSnippet('claude', 47823, 'abc'),
    'claude mcp add --transport http yalqen http://127.0.0.1:47823/mcp --header "Authorization: Bearer abc"',
  );
  assert.match(
    setupSnippet('codex', 47823, 'abc'),
    /url = "http:\/\/127\.0\.0\.1:47823\/mcp"[\s\S]*YALQEN_MCP_TOKEN="abc"/,
  );
  assert.equal(setupSnippet('token', 1, 'abc'), 'abc');
});
