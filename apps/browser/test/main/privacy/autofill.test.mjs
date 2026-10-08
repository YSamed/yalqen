import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import stores from '../../../dist/main/privacy/autofill.js';
import fields from '../../../dist/shared/autofill.js';
const address = {
  kind: 'address',
  label: 'Home',
  givenName: 'Ada',
  additionalName: '',
  familyName: 'Lovelace',
  organization: '',
  streetAddress: '12 Main Street\nFlat 3',
  city: 'London',
  region: '',
  postalCode: 'NW1',
  country: 'GB',
  email: 'ada@example.test',
  tel: '+44 123456',
};
const card = {
  kind: 'card',
  label: 'Test card',
  name: 'Ada Lovelace',
  number: '4242 4242 4242 4242',
  month: '4',
  year: '2035',
};
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-autofill-unit-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const key = randomBytes(32);
  let fail = false;
  const cipher = {
    available: () => true,
    encrypt: (value) => {
      if (fail) throw Error('Encryption failed');
      const iv = randomBytes(12),
        crypt = createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([crypt.update(value, 'utf8'), crypt.final()]);
      return Buffer.concat([iv, crypt.getAuthTag(), data]).toString('base64');
    },
    decrypt: (value) => {
      const bytes = Buffer.from(value, 'base64'),
        crypt = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      crypt.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([crypt.update(bytes.subarray(28)), crypt.final()]).toString('utf8');
    },
  };
  const store = new stores.AutofillStore(root, cipher);
  return {
    root,
    cipher,
    store,
    fail: () => {
      fail = true;
    },
  };
}
test('autofill records are encrypted, contain no security code, persist edits and only expose masked card metadata', (t) => {
  const f = fixture(t);
  assert.equal(f.store.save({ id: null, data: address }), true);
  assert.equal(f.store.save({ id: null, data: { ...card, cvv: '999' } }), true);
  const disk = fs.readFileSync(f.store.file, 'utf8');
  for (const value of ['Ada Lovelace', '4242424242424242', '12 Main Street']) assert.equal(disk.includes(value), false);
  assert.equal(fs.statSync(f.store.file).mode & 0o777, 0o600);
  const info = f.store.choices('card')[0];
  assert.equal(info.detail, '•••• 4242 · 04/2035');
  assert.equal(JSON.stringify(f.store.view()).includes('4242424242424242'), false);
  const read = f.store.read(info.id);
  assert.equal(read.number, '4242424242424242');
  assert.equal('cvv' in read, false);
  const reloaded = new stores.AutofillStore(f.root, f.cipher);
  assert.deepEqual(reloaded.read(info.id), read);
  assert.equal(reloaded.save({ id: info.id, data: { ...card, label: 'Updated' } }), true);
  assert.equal(reloaded.choices('card')[0].label, 'Updated');
  assert.equal(reloaded.save({ id: info.id, data: address }), false);
  assert.equal(reloaded.remove(info.id), true);
  assert.equal(new stores.AutofillStore(f.root, f.cipher).choices('card').length, 0);
});
test('invalid cards, fields, missing identities and unavailable or failing encryption preserve stored data', (t) => {
  const f = fixture(t);
  assert.equal(f.store.save({ id: null, data: address }), true);
  const before = fs.readFileSync(f.store.file, 'utf8');
  for (const data of [
    { ...card, number: '4242424242424243' },
    { ...card, month: '13' },
    { ...card, number: '000000000000' },
    { ...address, country: 'United Kingdom' },
    { ...address, streetAddress: 'x'.repeat(4097) },
  ])
    assert.equal(f.store.save({ id: null, data }), false);
  assert.equal(f.store.save({ id: 'missing', data: address }), false);
  f.fail();
  assert.equal(f.store.save({ id: null, data: card }), false);
  assert.equal(fs.readFileSync(f.store.file, 'utf8'), before);
  const unavailable = new stores.AutofillStore(f.root, { ...f.cipher, available: () => false });
  assert.equal(unavailable.view().available, false);
  assert.deepEqual(unavailable.choices(), []);
  assert.equal(unavailable.save({ id: null, data: address }), false);
});
test('autocomplete sections keep shipping and billing apart and exclude security codes, passwords and off hints', () => {
  assert.deepEqual(fields.autofillField('section-checkout shipping address-line1'), {
    kind: 'address',
    field: 'address-line1',
    section: 'section-checkout shipping',
  });
  assert.deepEqual(fields.autofillField('billing cc-number'), { kind: 'card', field: 'cc-number', section: 'billing' });
  for (const hint of ['cc-csc', 'off', 'new-password', 'current-password', 'username', 'on', ''])
    assert.equal(fields.autofillField(hint), null);
  const values = fields.autofillValues(address, 'en');
  assert.equal(values.name, 'Ada Lovelace');
  assert.equal(values['address-line2'], 'Flat 3');
  assert.equal(values['country-name'], 'United Kingdom');
  const cardValues = fields.autofillValues(stores.sanitizeAutofill(card), 'en');
  assert.equal(cardValues['cc-exp'], '04/2035');
  assert.equal('cc-csc' in cardValues, false);
});
