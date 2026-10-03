import assert from 'node:assert/strict';
import { test } from 'node:test';
import redact from '../../../dist/main/agent-bridge/redact.js';

const { maskHeaders, truncateBytes } = redact;

test('sensitive headers are masked whatever their case', () => {
  assert.deepEqual(
    maskHeaders({
      Authorization: 'Bearer abc',
      cookie: 'sid=1',
      'Set-Cookie': 'sid=1',
      'Proxy-Authorization': 'Basic x',
      'X-Api-Key': 'k',
      'X-CSRF-Token': 't',
      'X-Client-Secret': 's',
      'Content-Type': 'application/json',
      Accept: '*/*',
    }),
    {
      Authorization: '[masked]',
      cookie: '[masked]',
      'Set-Cookie': '[masked]',
      'Proxy-Authorization': '[masked]',
      'X-Api-Key': '[masked]',
      'X-CSRF-Token': '[masked]',
      'X-Client-Secret': '[masked]',
      'Content-Type': 'application/json',
      Accept: '*/*',
    },
  );
});

test('missing headers give an empty object', () => {
  assert.deepEqual(maskHeaders(undefined), {});
});

test('truncateBytes cuts at the byte limit without breaking characters', () => {
  assert.deepEqual(truncateBytes('short', 64), { text: 'short', truncated: false });
  assert.deepEqual(truncateBytes('abcdef', 4), { text: 'abcd', truncated: true });
  assert.deepEqual(truncateBytes('ğğğ', 3), { text: 'ğ', truncated: true });
});
