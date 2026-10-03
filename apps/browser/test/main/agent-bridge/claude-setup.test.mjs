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
