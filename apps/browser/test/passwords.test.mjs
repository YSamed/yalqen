import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import passwords from '../dist/main/passwords.js';

const { PasswordStore, passwordOrigin, sanitizeCredential } = passwords;
const SITE = 'https://github.com';

const cipher = {
  available: () => true,
  encrypt: (text) => Buffer.from(text).reverse().toString('base64'),
  decrypt: (secret) => Buffer.from(secret, 'base64').reverse().toString(),
};

function withStore(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-passwords-'));
  try {
    run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('only secure pages and local servers can save passwords', () => {
  assert.equal(passwordOrigin('https://github.com/login?return_to=/'), SITE);
  assert.equal(passwordOrigin('http://localhost:3000/login'), 'http://localhost:3000');
  assert.equal(passwordOrigin('http://127.0.0.1:8080/'), 'http://127.0.0.1:8080');
  assert.equal(passwordOrigin('http://example.com/login'), null);
  assert.equal(passwordOrigin('yalqen://settings/'), null);
  assert.equal(passwordOrigin('file:///tmp/login.html'), null);
  assert.equal(passwordOrigin(undefined), null);
});

test('submitted credentials need a password and are bounded', () => {
  assert.deepEqual(sanitizeCredential({ username: ' ada@example.com ', password: 'secret' }), {
    username: 'ada@example.com',
    password: 'secret',
  });
  assert.deepEqual(sanitizeCredential({ username: '', password: 'secret' }), { username: '', password: 'secret' });
  assert.equal(sanitizeCredential({ username: 'ada', password: '' }), null);
  assert.equal(sanitizeCredential({ username: 'ada', password: 'x'.repeat(5000) }), null);
  assert.equal(sanitizeCredential({ username: 1, password: 'secret' }), null);
  assert.equal(sanitizeCredential(null), null);
});

test('a new login is offered for saving, a known one only when its password changed', () => {
  withStore((dir) => {
    const store = new PasswordStore(dir, cipher);
    const login = { username: 'ada', password: 'first' };
    assert.equal(store.offer(SITE, login), 'save');
    store.save(SITE, login, 1);
    assert.equal(store.offer(SITE, login), null);
    assert.equal(store.offer(SITE, { username: 'ada', password: 'second' }), 'update');
    assert.equal(store.offer(SITE, { username: 'grace', password: 'first' }), 'save');
    assert.equal(store.offer('https://gitlab.com', login), 'save');

    store.save(SITE, { username: 'ada', password: 'second' }, 2);
    const { passwords: saved } = store.view();
    assert.equal(saved.length, 1);
    assert.deepEqual(saved[0], { id: saved[0].id, origin: SITE, username: 'ada', updatedAt: 2 });
    assert.equal(store.reveal(saved[0].id), 'second');
  });
});

test('passwords are stored encrypted and survive a restart', () => {
  withStore((dir) => {
    const store = new PasswordStore(dir, cipher);
    store.save(SITE, { username: 'ada', password: 'hunter2-secret' });
    store.neverSave('https://bank.example.com');
    store.saveNow();

    const file = fs.readFileSync(path.join(dir, 'passwords.json'), 'utf8');
    assert.ok(!file.includes('hunter2-secret'));

    const reloaded = new PasswordStore(dir, cipher);
    const { passwords: saved, neverSave } = reloaded.view();
    assert.equal(saved.length, 1);
    assert.equal(reloaded.reveal(saved[0].id), 'hunter2-secret');
    assert.deepEqual(neverSave, ['https://bank.example.com']);
  });
});

test('sites on the never list are not offered until allowed again', () => {
  withStore((dir) => {
    const store = new PasswordStore(dir, cipher);
    const login = { username: 'ada', password: 'secret' };
    store.neverSave(SITE);
    assert.equal(store.offer(SITE, login), null);
    store.allowSaving(SITE);
    assert.equal(store.offer(SITE, login), 'save');
  });
});

test('nothing is offered when encryption is unavailable', () => {
  const store = new PasswordStore(null, { ...cipher, available: () => false });
  assert.equal(store.offer(SITE, { username: 'ada', password: 'secret' }), null);
  assert.equal(store.view().available, false);
});

test('removing a password forgets it', () => {
  withStore((dir) => {
    const store = new PasswordStore(dir, cipher);
    store.save(SITE, { username: 'ada', password: 'secret' });
    const [entry] = store.view().passwords;
    store.remove(entry.id);
    assert.deepEqual(store.view().passwords, []);
    assert.equal(store.reveal(entry.id), null);
  });
});

test('damaged or foreign entries are dropped on load', () => {
  withStore((dir) => {
    fs.writeFileSync(
      path.join(dir, 'passwords.json'),
      JSON.stringify({
        version: 1,
        passwords: [
          { id: 'a', origin: SITE, username: 'ada', secret: cipher.encrypt('ok'), createdAt: 1, updatedAt: 1 },
          { id: 'b', origin: 'http://example.com', username: 'x', secret: 'y', createdAt: 1, updatedAt: 1 },
          { id: 'c', origin: SITE, username: 'x', secret: '', createdAt: 1, updatedAt: 1 },
          'junk',
        ],
        neverSave: [SITE, 'not a url', 42],
      }),
    );
    const store = new PasswordStore(dir, cipher);
    assert.deepEqual(
      store.view().passwords.map((entry) => entry.id),
      ['a'],
    );
    assert.deepEqual(store.view().neverSave, [SITE]);
  });
});
