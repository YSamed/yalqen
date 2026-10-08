import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import lists from '../../../dist/main/privacy/threat-lists.js';
import guard from '../../../dist/main/privacy/threat-guard.js';

const { LocalThreatLists, parseThreatDomains, parseThreatHashes, threatDomain, DOMAIN_FEED, HASH_FEED, HASH_SOURCE } =
  lists;
const { ThreatGuard } = guard;
function fixture(t, fetcher, enabled = () => true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-threats-'));
  const service = new LocalThreatLists(dir, enabled, () => {}, fetcher);
  t.after(() => {
    service.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, service };
}

test('domain lists normalize IDN and match host boundaries including descendants', () => {
  const domains = parseThreatDomains('# source\nBAD.Example\nşüpheli.example\nbad.example\n');
  assert.equal(domains.size, 2);
  for (const url of ['https://bad.example/a?x=1', 'http://sub.bad.example/', 'https://BAD.example./'])
    assert.equal(threatDomain(url, domains), 'bad.example');
  assert.ok(threatDomain('https://şüpheli.example/', domains));
  for (const url of [
    'https://notbad.example/',
    'https://bad.example.evil/',
    'https://good.example/?url=bad.example',
    'file://bad.example/',
    'not a URL',
  ])
    assert.equal(threatDomain(url, domains), null);
  for (const text of [
    '',
    '<html>server error</html>',
    'bad.example\nhttps://bad.example/',
    'a..example',
    'bad.example\n*',
  ])
    assert.throws(() => parseThreatDomains(text));
});

test('hash list accepts only MD5/SHA1/SHA256 records and ignores comments', () => {
  const hash = 'A'.repeat(64);
  assert.deepEqual(
    [...parseThreatHashes(`# comment\n${hash};description;more\n${'b'.repeat(32)};MD5\n`)],
    [hash.toLowerCase(), 'b'.repeat(32)],
  );
  for (const value of ['', 'no hashes', '<html>login</html>', `${hash};ok\nxyz;bad`])
    assert.throws(() => parseThreatHashes(value));
});

test('updates request only public feed URLs, cache atomically and keep prior lists on failures', async (t) => {
  const calls = [];
  let failed = false;
  const { dir, service } = fixture(t, async (url, options) => {
    calls.push({ url, options });
    if (failed) return new Response('<html>unavailable</html>');
    return new Response(url === DOMAIN_FEED ? 'bad.example\n' : `${'a'.repeat(64)};malicious\n`);
  });
  await Promise.all([service.update(true), service.update(true)]);
  assert.equal(calls.length, 2, 'concurrent refreshes share one fetch');
  assert.deepEqual(calls.map(({ url }) => url).sort(), [DOMAIN_FEED, HASH_FEED].sort());
  assert.ok(calls.every(({ options }) => options.credentials === 'omit' && options.redirect === 'error'));
  assert.equal(service.domain('https://bad.example/'), 'bad.example');
  assert.equal(service.view().hashes, 1);
  const original = fs.readFileSync(path.join(dir, 'threat-lists/domains.txt'), 'utf8');
  failed = true;
  await service.update(true);
  assert.equal(service.view().failed, true);
  assert.equal(fs.readFileSync(path.join(dir, 'threat-lists/domains.txt'), 'utf8'), original);
  assert.equal(service.domain('http://bad.example/'), 'bad.example');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'threat-lists')).sort(), ['domains.txt', 'hashes.txt']);
  const offline = new LocalThreatLists(dir, () => true);
  assert.equal(offline.domain('https://sub.bad.example/'), 'bad.example');
  assert.equal(offline.view().hashes, 1);
  offline.stop();
});

test('independent feed failures preserve coverage and disabled protection performs no network', async (t) => {
  let enabled = false;
  let calls = 0;
  const { service } = fixture(
    t,
    async (url) => {
      calls++;
      if (url === HASH_FEED) throw new Error('offline');
      return new Response('bad.example');
    },
    () => enabled,
  );
  await service.update(true);
  assert.equal(calls, 0);
  enabled = true;
  await service.update(true);
  assert.equal(service.view().failed, true);
  assert.equal(service.view().domains, 1);
  assert.equal(service.view().hashes, 0);
  enabled = false;
  assert.equal(service.domain('https://bad.example/'), null);
});

test('a successful update replaces removed domains and enforces response size limits', async (t) => {
  let text = 'old.example';
  const { service } = fixture(t, async (url) =>
    url === DOMAIN_FEED ? new Response(text) : new Response(`${'a'.repeat(64)};file`),
  );
  await service.update(true);
  text = 'new.example';
  await service.update(true);
  assert.equal(service.domain('https://old.example/'), null);
  assert.equal(service.domain('https://new.example/'), 'new.example');
  service.fetcher = async () =>
    new Response('bad.example', { headers: { 'content-length': String(33 * 1024 * 1024) } });
  await service.update(true);
  assert.equal(service.view().failed, true);
  assert.equal(service.domain('https://new.example/'), 'new.example');
});

test('file verification streams bytes and matches all supported hash algorithms without uploading', async (t) => {
  for (const algorithm of ['md5', 'sha1', 'sha256']) {
    let calls = 0;
    const payload = Buffer.alloc(2 * 1024 * 1024, 42);
    const hash = createHash(algorithm).update(payload).digest('hex');
    const { dir, service } = fixture(t, async (url) => {
      calls++;
      return new Response(url === DOMAIN_FEED ? 'bad.example' : `${hash};fixture`);
    });
    await service.update(true);
    const file = path.join(dir, 'fixture.bin');
    fs.writeFileSync(file, payload);
    assert.equal(await service.checkFile(file), HASH_SOURCE);
    fs.writeFileSync(file, 'different harmless data');
    assert.equal(await service.checkFile(file), null);
    assert.equal(calls, 2, 'checking files never contacts a remote service');
    await assert.rejects(service.checkFile(path.join(dir, 'missing')));
  }
});

test('warning tokens cannot be forged, replayed in another tab, or applied after navigating away', () => {
  const checker = new ThreatGuard({
    domain: (url) => (new URL(url).hostname.endsWith('bad.example') ? 'bad.example' : null),
  });
  let url = 'https://bad.example/login';
  const contents = { isDestroyed: () => false, getURL: () => url };
  const other = { ...contents };
  const request = (target, webContents = contents, resourceType = 'mainFrame') => ({
    url: target,
    webContents,
    resourceType,
  });
  assert.equal(checker.blocked(request(url)), true);
  const warning = checker.warning(contents, url);
  assert.ok(warning);
  assert.equal(checker.proceed(contents, 'forged', url), null);
  assert.equal(checker.proceed(other, warning.token, url), null);
  assert.equal(checker.proceed(contents, warning.token, 'https://good.example/'), null);
  checker.navigating(contents, `${guard.PROCEED_THREAT_URL}${warning.token}`);
  assert.equal(checker.proceed(contents, warning.token, url), url);
  assert.equal(checker.proceed(contents, warning.token, url), null);
  assert.equal(checker.blocked(request(url)), false);
  assert.equal(checker.blocked(request('https://bad.example/asset', contents, 'script')), false);
  assert.equal(checker.blocked(request('https://other.bad.example/asset', contents, 'script')), true);
  assert.equal(checker.blocked(request(url, other)), true);
  assert.equal(checker.blocked(request('https://good.example/')), false);
  assert.equal(checker.blocked(request(url)), true, 'leaving the page revokes its grant');
  const latest = checker.warning(contents, url);
  checker.warnings.get(contents).createdAt -= 6 * 60 * 1000;
  assert.equal(checker.proceed(contents, latest.token, url), null);
});
