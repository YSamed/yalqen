import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import profileStores from '../../../dist/main/privacy/profile-stores.js';
import passwords from '../../../dist/main/privacy/passwords.js';
import autofill from '../../../dist/main/privacy/autofill.js';
import permissions from '../../../dist/main/privacy/permissions.js';

const { ProfileStores, partitionDataProfile } = profileStores;
const cipher = { available: () => true, encrypt: (text) => `x${text}`, decrypt: (secret) => secret.slice(1) };
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ORIGIN = 'https://login.example';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-profile-stores-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const shared = {
    passwords: new passwords.PasswordStore(root, cipher),
    autofill: new autofill.AutofillStore(root, cipher),
    permissions: new permissions.PermissionStore(root),
  };
  return { root, shared, stores: new ProfileStores(root, cipher, shared) };
}

test('only space partitions with a profile id resolve to a data profile', () => {
  assert.equal(partitionDataProfile(`persist:space-${A}`), A);
  assert.equal(partitionDataProfile('persist:daily'), null);
  assert.equal(partitionDataProfile('persist:space-../../etc'), null);
  assert.equal(partitionDataProfile(`persist:space-${A}x`), null);
});

test('a password saved in one profile is not offered in another, and forgetting a profile deletes its data', (t) => {
  const { root, shared, stores } = fixture(t);
  assert.equal(stores.get(null), shared);
  assert.equal(stores.get('../outside'), null);
  const first = stores.get(A);
  assert.equal(stores.get(A), first);
  first.passwords.save(ORIGIN, { username: 'ada', password: 'secret' });
  first.permissions.set(ORIGIN, ['camera'], 'allow');
  assert.equal(stores.get(A).passwords.choices(ORIGIN).length, 1);
  assert.equal(stores.get(B).passwords.choices(ORIGIN).length, 0);
  assert.equal(shared.passwords.choices(ORIGIN).length, 0);
  assert.equal(stores.get(B).permissions.decide(ORIGIN, ['camera']), 'ask');

  stores.saveAll();
  const directory = path.join(root, 'space-data', A);
  assert.equal(fs.existsSync(path.join(directory, 'passwords.json')), true);
  stores.forget(A);
  assert.equal(fs.existsSync(directory), false);
  assert.equal(stores.get(A).passwords.choices(ORIGIN).length, 0);
});
