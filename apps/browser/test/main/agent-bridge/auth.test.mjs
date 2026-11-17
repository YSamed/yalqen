import assert from 'node:assert/strict';
import { test } from 'node:test';
import auth from '../../../dist/main/agent-bridge/auth.js';

const { bearer, checkSource, generateToken, tokenMatches } = auth;
const PORT = 47823;
const TOKEN = 'secret-token';
const ok = { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` };

test('loopback hostnames on the bridge port are accepted', () => {
  assert.equal(checkSource(ok, PORT), null);
  assert.equal(checkSource({ ...ok, host: `localhost:${PORT}` }, PORT), null);
});

test('a missing or wrong token is rejected', () => {
  assert.equal(tokenMatches(bearer(ok.authorization), TOKEN), true);
  assert.equal(tokenMatches(bearer(undefined), TOKEN), false);
  assert.equal(tokenMatches(bearer('Bearer wrong'), TOKEN), false);
  assert.equal(tokenMatches(bearer(TOKEN), TOKEN), false);
  assert.equal(tokenMatches(bearer(ok.authorization), ''), false);
});

test('any Origin header is rejected, even a local one', () => {
  assert.equal(checkSource({ ...ok, origin: 'http://localhost:3000' }, PORT), 'origin');
  assert.equal(checkSource({ ...ok, origin: 'null' }, PORT), 'origin');
});

test('a foreign Host is rejected (DNS rebinding)', () => {
  assert.equal(checkSource({ ...ok, host: `evil.example:${PORT}` }, PORT), 'host');
  assert.equal(checkSource({ ...ok, host: '127.0.0.1:1' }, PORT), 'host');
  assert.equal(checkSource({ ...ok, host: undefined }, PORT), 'host');
});

test('tokens are random, url-safe and 32 bytes', () => {
  const a = generateToken();
  assert.match(a, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, generateToken());
  assert.equal(tokenMatches(a, a), true);
  assert.equal(tokenMatches(`${a}x`, a), false);
});

test('the source check ignores the token', () => {
  assert.equal(checkSource({ host: ok.host }, PORT), null);
  assert.equal(checkSource({ ...ok, origin: 'http://localhost:3000' }, PORT), 'origin');
  assert.equal(checkSource({ ...ok, host: `evil.example:${PORT}` }, PORT), 'host');
});
