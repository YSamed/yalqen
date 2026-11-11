import assert from 'node:assert/strict';
import { test } from 'node:test';
import health from '../../../dist/shared/password-health.js';
import passwords from '../../../dist/main/privacy/passwords.js';
import tools from '../../../dist/main/privacy/password-tools.js';

const DAY = 24 * 60 * 60 * 1000;
const cipher = {
  available: () => true,
  encrypt: (text) => Buffer.from(text).toString('base64'),
  decrypt: (secret) => Buffer.from(secret, 'base64').toString(),
};

test('weak passwords are short, simple, numeric-only or common', () => {
  for (const weak of ['abc12', 'aaaaaaaaaaaa', '123456789012', 'Password', 'abcdefghij']) {
    assert.equal(health.isWeakPassword(weak), true, weak);
  }
  for (const strong of ['correct horse battery', 'Tr0ub4dor&3x', 'abcdefghijkl', 'Abcdef1!']) {
    assert.equal(health.isWeakPassword(strong), false, strong);
  }
});

test('generated passwords are never weak', () => {
  for (let i = 0; i < 200; i++) assert.equal(health.isWeakPassword(tools.generatePassword(12)), false);
});

test('issues flag weak, reused and year-old passwords', () => {
  const now = 400 * DAY;
  const issues = health.passwordIssues(
    [
      { id: 'a', password: 'Tr0ub4dor&3x', updatedAt: now },
      { id: 'b', password: 'Tr0ub4dor&3x', updatedAt: now - 365 * DAY },
      { id: 'c', password: 'Tr0ub4dor&3x2', updatedAt: now - 365 * DAY - 1 },
      { id: 'd', password: '1234', updatedAt: now },
    ],
    now,
  );
  assert.deepEqual(issues.get('a'), ['reused']);
  assert.deepEqual(issues.get('b'), ['reused']);
  assert.deepEqual(issues.get('c'), ['old']);
  assert.deepEqual(issues.get('d'), ['weak']);
});

test('the password view carries issue flags but never a password', () => {
  const store = new passwords.PasswordStore(null, cipher);
  store.save('https://a.example', { username: 'ada', password: 'Tr0ub4dor&3x' }, 1);
  store.save('https://b.example', { username: 'ada', password: 'Tr0ub4dor&3x' }, 2);
  store.save('https://c.example', { username: 'ada', password: 'abc' }, 2);
  const { passwords: saved } = store.view(2 + 400 * DAY);
  assert.deepEqual(
    saved.map(({ origin, issues }) => [origin, issues]),
    [
      ['https://a.example', ['reused', 'old']],
      ['https://b.example', ['reused', 'old']],
      ['https://c.example', ['weak', 'old']],
    ],
  );
  assert.equal(JSON.stringify(store.view()).includes('Tr0ub4dor'), false);
  const unavailable = new passwords.PasswordStore(null, { ...cipher, available: () => false });
  assert.deepEqual(unavailable.view().passwords, []);
});

test('a username is looked up by id only', () => {
  const store = new passwords.PasswordStore(null, cipher);
  store.save('https://a.example', { username: 'ada', password: 'Tr0ub4dor&3x' });
  const [{ id }] = store.view().passwords;
  assert.equal(store.username(id), 'ada');
  assert.equal(store.username('missing'), null);
});
