import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import tokenStore from '../../../dist/main/agent-bridge/token-store.js';

const { AgentTokenStore } = tokenStore;
const fakeCipher = (available = true) => ({
  available: () => available,
  encrypt: (text) => `enc:${Buffer.from(text).toString('base64')}`,
  decrypt: (secret) => Buffer.from(secret.slice(4), 'base64').toString(),
});
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-token-'));

test('the token is saved encrypted and survives a restart', () => {
  const dir = tempDir();
  const token = new AgentTokenStore(dir, fakeCipher()).get();
  const saved = fs.readFileSync(path.join(dir, 'agent-bridge.json'), 'utf8');
  assert.equal(saved.includes(token), false);
  assert.equal(new AgentTokenStore(dir, fakeCipher()).get(), token);
});

test('regenerating replaces the saved token', () => {
  const dir = tempDir();
  const store = new AgentTokenStore(dir, fakeCipher());
  const first = store.get();
  const second = store.regenerate();
  assert.notEqual(first, second);
  assert.equal(new AgentTokenStore(dir, fakeCipher()).get(), second);
});

test('without encryption nothing is written and the token stays in memory', () => {
  const dir = tempDir();
  const store = new AgentTokenStore(dir, fakeCipher(false));
  assert.equal(store.get(), store.get());
  assert.equal(fs.existsSync(path.join(dir, 'agent-bridge.json')), false);
});
