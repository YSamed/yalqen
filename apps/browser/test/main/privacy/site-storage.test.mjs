import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { StorageOrigins, quotaOrigins, storageGroups } from '../../../dist/main/privacy/site-storage.js';

test('storage origins retain only valid web origins, persist independently of history and group hosted tenants separately', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-storage-origins-'));
  try {
    const index = new StorageOrigins(root);
    for (const value of [
      'https://a.example.test/private?q=secret',
      'https://b.example.test:8443/path',
      'https://alice.github.io/path',
      'https://bob.github.io/',
      'https://user:secret@example.test/',
      'file:///secret',
      'data:text/html,test',
      'invalid',
    ])
      index.remember(value);
    index.saveNow();
    const reloaded = new StorageOrigins(root);
    assert.deepEqual(reloaded.list(), [
      'https://a.example.test',
      'https://b.example.test:8443',
      'https://alice.github.io',
      'https://bob.github.io',
    ]);
    assert.equal(fs.readFileSync(path.join(root, 'site-origins.json'), 'utf8').includes('private'), false);
    const groups = storageGroups(reloaded.list(), [
      { domain: '.example.test', secure: false },
      { domain: 'a.example.test', secure: true },
    ]);
    assert.deepEqual(
      groups.map((group) => group.domain),
      ['alice.github.io', 'bob.github.io', 'example.test'],
    );
    assert.equal(groups.find((group) => group.domain === 'example.test').cookies, 2);
    assert.ok(groups.find((group) => group.domain === 'example.test').origins.has('http://example.test'));
    reloaded.clear();
    assert.deepEqual(new StorageOrigins(root).list(), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dormant quota discovery reads partitioned origins without changing the database or creating a missing file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-storage-quota-'));
  try {
    assert.deepEqual(quotaOrigins(root), { origins: [], limited: false });
    assert.equal(fs.existsSync(path.join(root, 'QuotaManager')), false);
    const file = path.join(root, 'QuotaManager');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE buckets(storage_key TEXT)');
    const insert = db.prepare('INSERT INTO buckets VALUES (?)');
    for (const key of [
      'https://idb.example.test/',
      'https://tracker.example.test/^0https://host.test',
      'chrome-extension://abc/',
      'invalid',
    ])
      insert.run(key);
    db.close();
    const before = fs.readFileSync(file);
    assert.deepEqual(quotaOrigins(root), {
      origins: ['https://idb.example.test', 'https://tracker.example.test'],
      limited: false,
    });
    assert.deepEqual(fs.readFileSync(file), before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
