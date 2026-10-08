import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import tools from '../../../dist/main/privacy/password-tools.js';
import passwords from '../../../dist/main/privacy/passwords.js';
const cipher = {
  available: () => true,
  encrypt: (value) => Buffer.from(value).toString('base64'),
  decrypt: (value) => Buffer.from(value, 'base64').toString(),
};
function fixture(t, crypto = cipher) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-password-tools-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, store: new passwords.PasswordStore(directory, crypto) };
}

test('generated passwords meet bounded length and include every character class with independent random results', () => {
  const generated = new Set();
  for (let i = 0; i < 500; i++) {
    const value = tools.generatePassword();
    assert.equal(value.length, 20);
    for (const pattern of [/[a-z]/, /[A-Z]/, /[0-9]/, /[!@#$%*_=+?-]/]) assert.match(value, pattern);
    generated.add(value);
  }
  assert.equal(generated.size, 500);
  assert.equal(tools.generatePassword(12).length, 12);
  assert.equal(tools.generatePassword(128).length, 128);
  for (const length of [0, 11, 129, 20.5, '20', null]) assert.equal(tools.generatePassword(length), null);
});
test('CSV supports Chrome/Firefox/Safari column names, quotes, commas, Unicode, newlines and BOM without executing data', () => {
  const records = [
    { origin: 'https://example.com', username: '=literal,user', password: 'quotation " and\nUnicode ş' },
    { origin: 'https://second.example', username: '@account', password: '+literal' },
  ];
  assert.deepEqual(tools.parsePasswordCsv(tools.serializePasswordCsv(records)), { records, skipped: 0 });
  assert.deepEqual(
    tools.parsePasswordCsv(
      '\uFEFFTitle,URL,Username,Password,Notes\r\nName,https://example.com/login,ada,secret,Note\r\n',
    ),
    { records: [{ origin: 'https://example.com', username: 'ada', password: 'secret' }], skipped: 0 },
  );
  assert.equal(
    tools.parsePasswordCsv(
      'url,username,password\nhttp://insecure.example,a,x\njavascript:alert(1),a,x\nhttps://example.com,a,\n',
    ).skipped,
    3,
  );
  for (const csv of [
    'url,username\nx,y',
    'url,username,password\n"unclosed',
    'url,username,password\n"closed"junk,x,y',
    'url,url,password\nx,y,z',
    'url,username,password\n' + 'x'.repeat(16385),
  ])
    assert.throws(() => tools.parsePasswordCsv(csv));
});
test('manual edits preserve blank passwords, refuse duplicate site/accounts and persist encrypted changes', (t) => {
  const { directory, store } = fixture(t);
  assert.equal(
    store.saveManual({ id: null, url: 'https://example.com/login', username: ' ada ', password: 'original password' }),
    true,
  );
  const id = store.view().passwords[0].id;
  assert.equal(store.saveManual({ id, url: 'https://example.com', username: 'grace', password: '' }), true);
  assert.deepEqual(new passwords.PasswordStore(directory, cipher).login('https://example.com', id), {
    username: 'grace',
    password: 'original password',
  });
  assert.equal(
    store.saveManual({ id: null, url: 'https://example.com', username: 'grace', password: 'replacement' }),
    false,
  );
  for (const value of [
    null,
    { id: 'missing', url: 'https://example.com', username: '', password: 'x' },
    { id: null, url: 'http://example.com', username: '', password: 'x' },
    { id: null, url: 'https://example.com', username: '', password: '' },
  ])
    assert.equal(store.saveManual(value), false);
  assert.equal(fs.readFileSync(path.join(directory, 'passwords.json'), 'utf8').includes('original password'), false);
});
test('CSV import preserves existing accounts, skips duplicates, and encrypts the entire batch before changing the store', (t) => {
  const { store } = fixture(t);
  store.save('https://example.com', { username: 'ada', password: 'keep' });
  assert.deepEqual(
    store.importCredentials([
      { origin: 'https://example.com', username: 'ada', password: 'replace' },
      { origin: 'https://example.com', username: 'grace', password: 'new' },
      { origin: 'https://example.com', username: 'grace', password: 'duplicate' },
    ]),
    { added: 1, skipped: 2 },
  );
  assert.equal(store.logins('https://example.com').find(({ username }) => username === 'ada').password, 'keep');
  const { store: failing } = fixture(t, {
    ...cipher,
    encrypt: (value) => {
      if (value === 'bad') throw new Error('Encryption unavailable');
      return cipher.encrypt(value);
    },
  });
  assert.throws(() =>
    failing.importCredentials([
      { origin: 'https://example.com', username: 'a', password: 'ok' },
      { origin: 'https://example.com', username: 'b', password: 'bad' },
    ]),
  );
  assert.deepEqual(failing.view().passwords, []);
});
test('CSV export writes a private atomic file and a failed target preserves data without temporary plaintext files', async (t) => {
  const { directory } = fixture(t);
  const file = path.join(directory, 'passwords.csv');
  const records = [{ origin: 'https://example.com', username: 'ada', password: 'secret' }];
  await tools.writePasswordCsv(file, records);
  assert.deepEqual(await tools.readPasswordCsv(file), { records, skipped: 0 });
  if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const folder = path.join(directory, 'do-not-replace');
  fs.mkdirSync(folder);
  fs.writeFileSync(path.join(folder, 'sentinel'), 'keep');
  await assert.rejects(tools.writePasswordCsv(folder, records));
  assert.equal(fs.readFileSync(path.join(folder, 'sentinel'), 'utf8'), 'keep');
  assert.equal(
    fs.readdirSync(directory).some((name) => name.endsWith('.tmp')),
    false,
  );
});
