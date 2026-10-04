import assert from 'node:assert/strict';
import { test } from 'node:test';
import auth from '../../../dist/main/agent-bridge/auth.js';

const { checkRequest, checkSource, generateToken, tokenMatches } = auth;
const PORT = 47823;
const TOKEN = 'secret-token';
const ok = { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` };

test('a request with the right host and token passes', () => {
  assert.equal(checkRequest(ok, PORT, TOKEN), null);
  assert.equal(checkRequest({ ...ok, host: `localhost:${PORT}` }, PORT, TOKEN), null);
});

test('a missing or wrong token is rejected', () => {
  assert.equal(checkRequest({ host: ok.host }, PORT, TOKEN), 'token');
  assert.equal(checkRequest({ ...ok, authorization: 'Bearer wrong' }, PORT, TOKEN), 'token');
  assert.equal(checkRequest({ ...ok, authorization: TOKEN }, PORT, TOKEN), 'token');
  assert.equal(checkRequest(ok, PORT, ''), 'token');
});

test('any Origin header is rejected, even a local one', () => {
  assert.equal(checkRequest({ ...ok, origin: 'http://localhost:3000' }, PORT, TOKEN), 'origin');
  assert.equal(checkRequest({ ...ok, origin: 'null' }, PORT, TOKEN), 'origin');
});

test('a foreign Host is rejected (DNS rebinding)', () => {
  assert.equal(checkRequest({ ...ok, host: `evil.example:${PORT}` }, PORT, TOKEN), 'host');
  assert.equal(checkRequest({ ...ok, host: '127.0.0.1:1' }, PORT, TOKEN), 'host');
  assert.equal(checkRequest({ ...ok, host: undefined }, PORT, TOKEN), 'host');
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
