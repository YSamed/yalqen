import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import codex from '../../../dist/main/agent-bridge/codex-setup.js';

const { addToCodex, codexConfigPath, codexConnection, codexRegistration, removeFromCodex, withYalqen, withoutYalqen } =
  codex;

const URL = 'http://127.0.0.1:47823/mcp';
const EXISTING = `model = "gpt-5"

[projects."/Users/me/app"]
trust_level = "trusted"

[mcp_servers.node_repl]
args = []
command = "/bin/node_repl"

[mcp_servers.node_repl.env]
NODE_PATH = "/bin/node"

[mcp_servers.computer-use]
command = "./client"
enabled = false
`;

function tempConfig(t, text) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-codex-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'config.toml');
  if (text !== undefined) fs.writeFileSync(file, text);
  return file;
}

test('the Yalqen table is appended after the existing settings, which keep their text', () => {
  const next = withYalqen(EXISTING, URL, 'secret');
  assert.ok(next.startsWith(EXISTING.trimEnd()));
  assert.ok(
    next.endsWith(`\n\n[mcp_servers.yalqen]\nurl = "${URL}"\nhttp_headers = { Authorization = "Bearer secret" }\n`),
  );
  assert.deepEqual(codexRegistration(next), { url: URL, token: 'secret' });
});

test('replacing the Yalqen table keeps a single copy and leaves other servers and subtables alone', () => {
  const middle = EXISTING.replace(
    '[mcp_servers.computer-use]',
    '[mcp_servers.yalqen]\nurl = "http://old"\n\n[mcp_servers.yalqen.env]\nX = "1"\n\n[mcp_servers.computer-use]',
  );
  assert.equal(withoutYalqen(middle), EXISTING.trimEnd());
  const next = withYalqen(middle, URL, 'new');
  assert.equal(next.match(/\[mcp_servers\.yalqen\]/g).length, 1);
  assert.doesNotMatch(next, /http:\/\/old|yalqen\.env/);
  assert.match(next, /\[mcp_servers\.node_repl\.env\]\nNODE_PATH = "\/bin\/node"/);
  assert.deepEqual(codexRegistration(next), { url: URL, token: 'new' });
});

test('quoted table names are recognised', () => {
  assert.equal(withoutYalqen('a = 1\n\n[mcp_servers."yalqen"]\nurl = "x"\n'), 'a = 1');
  assert.equal(codexRegistration('[mcp_servers.other]\nurl = "x"\n'), null);
});

test('connecting writes the config with a backup, and removing restores the other settings', async (t) => {
  const file = tempConfig(t, EXISTING);
  assert.equal(await codexConnection(URL, 'secret', file), 'missing');
  assert.deepEqual(await addToCodex(URL, 'secret', file), { ok: true });
  assert.equal(fs.readFileSync(`${file}.yalqen-backup`, 'utf8'), EXISTING);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(await codexConnection(URL, 'secret', file), 'connected');
  assert.equal(await codexConnection(URL, 'newer', file), 'stale');
  assert.deepEqual(await removeFromCodex(file), { ok: true });
  assert.equal(fs.readFileSync(file, 'utf8'), EXISTING);
  assert.equal(await codexConnection(URL, 'secret', file), 'missing');
});

test('connecting creates the config when Codex has none yet', async (t) => {
  const file = path.join(path.dirname(tempConfig(t)), 'nested', 'config.toml');
  assert.deepEqual(await addToCodex(URL, 'secret', file), { ok: true });
  assert.equal(fs.existsSync(`${file}.yalqen-backup`), false);
  assert.equal(await codexConnection(URL, 'secret', file), 'connected');
  assert.deepEqual(await removeFromCodex(path.join(path.dirname(file), 'absent.toml')), { ok: true });
});

test('the config lives in CODEX_HOME when it is set', () => {
  assert.equal(codexConfigPath({ CODEX_HOME: '/tmp/codex-home' }), '/tmp/codex-home/config.toml');
  assert.equal(codexConfigPath({}), path.join(os.homedir(), '.codex', 'config.toml'));
});
