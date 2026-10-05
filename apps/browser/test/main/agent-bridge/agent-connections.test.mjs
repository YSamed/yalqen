import assert from 'node:assert/strict';
import { test } from 'node:test';
import connections from '../../../dist/main/agent-bridge/agent-connections.js';

const { connectionStates, isAgentClient, repairConnections } = connections;
const endpoint = { url: 'http://127.0.0.1:47823/mcp', token: 'secret' };

function targets(states, failing = []) {
  const connected = [];
  const target = (id) => ({
    state: async () => states[id],
    connect: async (value) => {
      connected.push([id, value]);
      return failing.includes(id) ? { ok: false, reason: 'failed', detail: 'nope' } : { ok: true };
    },
    disconnect: async () => ({ ok: true }),
  });
  return { targets: { claude: target('claude'), codex: target('codex') }, connected };
}

test('reports the state of each client', async () => {
  const { targets: all } = targets({ claude: 'connected', codex: 'missing' });
  assert.deepEqual(await connectionStates(endpoint, all), { claude: 'connected', codex: 'missing' });
});

test('only stale registrations are repaired, and only successful repairs are reported', async () => {
  const { targets: all, connected } = targets({ claude: 'stale', codex: 'stale' }, ['codex']);
  assert.deepEqual(await repairConnections(endpoint, all), ['claude']);
  assert.deepEqual(connected, [
    ['claude', endpoint],
    ['codex', endpoint],
  ]);
  const untouched = targets({ claude: 'missing', codex: 'connected' });
  assert.deepEqual(await repairConnections(endpoint, untouched.targets), []);
  assert.deepEqual(untouched.connected, []);
});

test('client ids are validated', () => {
  assert.equal(isAgentClient('codex'), true);
  assert.equal(isAgentClient('gemini'), false);
});
