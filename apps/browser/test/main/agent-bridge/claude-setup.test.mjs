import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import setupModule from '../../../dist/main/agent-bridge/claude-setup.js';

const { addToClaudeCode } = setupModule;

function sandbox(claudeScript) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-claude-setup-'));
  const bin = path.join(home, 'bin');
  fs.mkdirSync(bin);
  if (claudeScript) fs.writeFileSync(path.join(bin, 'claude'), `#!/bin/sh\n${claudeScript}\n`, { mode: 0o755 });
  const log = path.join(home, 'calls.log');
  return { env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, CALLS: log }, log };
}

test('replaces the yalqen server in the user scope', async () => {
  const { env, log } = sandbox('echo "$@" >> "$CALLS"');
  const result = await addToClaudeCode('http://127.0.0.1:47823/mcp', 'secret', { shell: '/bin/bash', env });
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), [
    'mcp remove yalqen --scope user',
    'mcp add --scope user --transport http yalqen http://127.0.0.1:47823/mcp --header Authorization: Bearer secret',
  ]);
});

test('reports a missing claude command', async () => {
  const { env } = sandbox(null);
  const result = await addToClaudeCode('http://x', 'secret', { shell: '/bin/bash', env });
  assert.deepEqual(result, { ok: false, reason: 'not-found', detail: '' });
});

test('reports a failure without the token', async () => {
  const { env } = sandbox('[ "$2" = add ] && { echo "bad header Bearer secret" >&2; exit 1; }; exit 0');
  const result = await addToClaudeCode('http://x', 'secret', { shell: '/bin/bash', env });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'failed');
  assert.equal(result.detail, 'bad header Bearer <token>');
});

const GET_OUTPUT = `yalqen:
  Scope: User config (available in all your projects)
  Status: ✔ Connected
  Type: http
  URL: http://127.0.0.1:47823/mcp
  Headers:
    Authorization: Bearer secret

To remove this server, run: claude mcp remove yalqen -s user`;

test('reads the registered address and token from claude mcp get', () => {
  assert.deepEqual(setupModule.claudeRegistration(GET_OUTPUT), {
    url: 'http://127.0.0.1:47823/mcp',
    token: 'secret',
  });
});

test('reports whether Claude Code is connected with the current address and token', async () => {
  const output = path.join(os.tmpdir(), `yalqen-claude-get-${process.pid}.txt`);
  fs.writeFileSync(output, GET_OUTPUT);
  const { env } = sandbox(`[ "$2" = get ] && cat "${output}"`);
  const options = { shell: '/bin/bash', env };
  assert.equal(await setupModule.claudeConnection('http://127.0.0.1:47823/mcp', 'secret', options), 'connected');
  assert.equal(await setupModule.claudeConnection('http://127.0.0.1:47823/mcp', 'newer', options), 'stale');
  assert.equal(await setupModule.claudeConnection('http://127.0.0.1:47824/mcp', 'secret', options), 'stale');
  fs.rmSync(output);
  const missing = sandbox('echo "No MCP server found" >&2; exit 1');
  assert.equal(
    await setupModule.claudeConnection('http://x', 'secret', { shell: '/bin/bash', env: missing.env }),
    'missing',
  );
  const absent = sandbox(null);
  assert.equal(
    await setupModule.claudeConnection('http://x', 'secret', { shell: '/bin/bash', env: absent.env }),
    'unavailable',
  );
});

test('removes the yalqen server from the user scope', async () => {
  const { env, log } = sandbox('echo "$@" >> "$CALLS"');
  assert.deepEqual(await setupModule.removeFromClaudeCode({ shell: '/bin/bash', env }), { ok: true });
  assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'), ['mcp remove yalqen --scope user']);
});
