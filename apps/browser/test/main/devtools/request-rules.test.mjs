import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import requestRules from '../../../dist/main/devtools/request-rules.js';
import pageOverrides from '../../../dist/main/devtools/page-overrides.js';
import requestRule from '../../../dist/shared/request-rule.js';

const {
  RequestRuleStore,
  interceptPatterns,
  matchRequestRule,
  parseHeaderLines,
  pausedRequestCommand,
  sanitizeRequestRules,
} = requestRules;
const { NO_OVERRIDES, overrideCommands } = pageOverrides;
const { newRequestRule } = requestRule;

const rule = (overrides) => ({ ...newRequestRule(), ...overrides });
const paused = (url, headers = {}) => ({ requestId: 'r1', request: { url, headers } });

test('saved rules are sanitized', () => {
  const [clean] = sanitizeRequestRules([
    { id: 'a', pattern: '  https://a.test/*  ', action: 'nuke', status: 99, contentType: '', enabled: 'yes' },
  ]);
  assert.deepEqual(
    [clean.id, clean.pattern, clean.action, clean.status, clean.contentType, clean.enabled],
    ['a', 'https://a.test/*', 'block', 200, 'text/plain', true],
  );
  assert.deepEqual(sanitizeRequestRules('nope'), []);
  assert.equal(sanitizeRequestRules(Array.from({ length: 150 }, () => ({}))).length, 100);
});

test('wildcards match whole addresses, first active rule wins', () => {
  const rules = [
    rule({ id: 'off', pattern: '*', enabled: false }),
    rule({ id: 'api', pattern: 'https://api.test/v1/*' }),
    rule({ id: 'any', pattern: '*.png' }),
    rule({ id: 'bad-redirect', pattern: '*', action: 'redirect', redirectUrl: 'javascript:alert(1)' }),
  ];
  assert.equal(matchRequestRule(rules, 'https://api.test/v1/users?id=1').id, 'api');
  assert.equal(matchRequestRule(rules, 'https://cdn.test/logo.png').id, 'any');
  assert.equal(matchRequestRule(rules, 'https://api.test/v2/users'), null);
  assert.equal(matchRequestRule([rule({ pattern: 'https://a.test/x.js' })], 'https://a.test/xxjs'), null);
});

test('cached matchers follow edits, disabling, and rule replacement', () => {
  const edited = rule({ pattern: 'https://old.test/*' });
  assert.equal(matchRequestRule([edited], 'https://old.test/one'), edited);
  assert.equal(matchRequestRule([edited], 'HTTPS://OLD.TEST/two'), edited);
  edited.pattern = 'https://new.test/?literal=*';
  assert.equal(matchRequestRule([edited], 'https://old.test/one'), null);
  assert.equal(matchRequestRule([edited], 'https://new.test/?literal=yes'), edited);
  assert.equal(matchRequestRule([edited], 'https://new.test/xliteral=yes'), null);
  edited.enabled = false;
  assert.equal(matchRequestRule([edited], 'https://new.test/?literal=yes'), null);
  const replacement = rule({ id: edited.id, pattern: 'https://replacement.test/*' });
  assert.equal(matchRequestRule([replacement], 'https://replacement.test/one'), replacement);
  assert.equal(matchRequestRule([replacement], 'https://new.test/?literal=yes'), null);
});

test('only active rules become interception patterns, with protocol wildcards escaped', () => {
  assert.deepEqual(
    interceptPatterns([
      rule({ pattern: 'https://a.test/?q=*' }),
      rule({ pattern: '*', enabled: false }),
      rule({ pattern: '' }),
    ]),
    [{ urlPattern: 'https://a.test/\\?q=*', requestStage: 'Request' }],
  );
});

test('interception follows the tab switch and never enables with no patterns', () => {
  const rules = [rule({ pattern: 'https://a.test/*' })];
  const fetchOf = (overrides, list) =>
    overrideCommands(overrides, { userAgent: '', platform: '' }, list).find((c) => c.method.startsWith('Fetch.'));
  assert.equal(fetchOf({ ...NO_OVERRIDES, requestRules: true }, rules).method, 'Fetch.enable');
  assert.deepEqual(fetchOf({ ...NO_OVERRIDES, requestRules: true }, []), { method: 'Fetch.disable', optional: true });
  assert.equal(fetchOf(NO_OVERRIDES, rules).method, 'Fetch.disable');
});

test('paused requests get the reply of their rule', () => {
  const rules = [
    rule({ pattern: 'https://ads.test/*', action: 'block' }),
    rule({
      pattern: 'https://api.test/me',
      action: 'mock',
      status: 201,
      contentType: 'application/json',
      body: '{"ok":true}',
    }),
    rule({ pattern: 'https://cdn.test/app.js', action: 'redirect', redirectUrl: 'http://localhost:5173/app.js' }),
    rule({
      pattern: 'https://api.test/*',
      action: 'headers',
      headers: 'Authorization: Bearer x\ncookie:\nbad header: 1',
    }),
  ];
  assert.deepEqual(pausedRequestCommand(rules, paused('https://ads.test/a.js')), {
    method: 'Fetch.failRequest',
    params: { requestId: 'r1', errorReason: 'BlockedByClient' },
  });
  const mock = pausedRequestCommand(rules, paused('https://api.test/me'));
  assert.equal(mock.params.responseCode, 201);
  assert.equal(Buffer.from(mock.params.body, 'base64').toString(), '{"ok":true}');
  assert.deepEqual(mock.params.responseHeaders[0], { name: 'Content-Type', value: 'application/json' });
  const redirect = pausedRequestCommand(rules, paused('https://cdn.test/app.js'));
  assert.equal(redirect.params.responseCode, 307);
  assert.deepEqual(redirect.params.responseHeaders[0], { name: 'Location', value: 'http://localhost:5173/app.js' });
  const headers = pausedRequestCommand(rules, paused('https://api.test/list', { Accept: '*/*', Cookie: 'a=1' }));
  assert.deepEqual(headers, {
    method: 'Fetch.continueRequest',
    params: {
      requestId: 'r1',
      headers: [
        { name: 'Accept', value: '*/*' },
        { name: 'Authorization', value: 'Bearer x' },
      ],
    },
  });
  assert.deepEqual(pausedRequestCommand(rules, paused('https://other.test/')), {
    method: 'Fetch.continueRequest',
    params: { requestId: 'r1' },
  });
});

test('header lines set values, empty values remove, invalid names are skipped', () => {
  assert.deepEqual(parseHeaderLines('X-A: 1\n  \nX-B:\nnot valid: 2\nX-C'), [
    { name: 'X-A', value: '1' },
    { name: 'X-B', value: null },
    { name: 'X-C', value: null },
  ]);
});

test('prepared mock responses follow body edits, metadata edits, and replacement rules', () => {
  const edited = rule({ pattern: 'https://api.test/*', action: 'mock', body: 'İlk yanıt 🌍' });
  const reply = () => pausedRequestCommand([edited], paused('https://api.test/data'));
  assert.equal(Buffer.from(reply().params.body, 'base64').toString(), 'İlk yanıt 🌍');
  assert.equal(reply().params.body, Buffer.from(edited.body).toString('base64'));

  edited.body = 'Yeni yanıt';
  edited.status = 202;
  edited.contentType = 'text/plain';
  const updated = reply();
  assert.equal(Buffer.from(updated.params.body, 'base64').toString(), 'Yeni yanıt');
  assert.equal(updated.params.responseCode, 202);
  assert.deepEqual(updated.params.responseHeaders[0], { name: 'Content-Type', value: 'text/plain' });

  edited.body = '';
  assert.equal(reply().params.body, '');
  const replacement = rule({ id: edited.id, pattern: edited.pattern, action: 'mock', body: 'Replacement' });
  assert.equal(
    Buffer.from(pausedRequestCommand([replacement], paused('https://api.test/data')).params.body, 'base64').toString(),
    'Replacement',
  );
});

test('mock body cache evicts at its budget and follows Unicode edits after eviction', () => {
  const rules = ['ğ', 'ş', 'ü'].map((character) =>
    rule({ pattern: 'https://api.test/*', action: 'mock', body: character.repeat(1024 * 1024) }),
  );
  const changedBody = 'Yeni yanıt 🌍';
  const encodings = new Map([...rules.map(({ body }) => body), changedBody].map((body) => [body, 0]));
  const from = Buffer.from;
  Buffer.from = (value, ...args) => {
    if (encodings.has(value)) encodings.set(value, encodings.get(value) + 1);
    return from(value, ...args);
  };
  try {
    const reply = (selected) => pausedRequestCommand([selected], paused('https://api.test/data')).params.body;
    const first = reply(rules[0]);
    assert.equal(reply(rules[0]), first);
    assert.equal(encodings.get(rules[0].body), 1);
    reply(rules[1]);
    reply(rules[2]);
    // Three 1 Mi-character two-byte UTF-8 bodies exceed the 8 Mi-character Base64 budget.
    assert.equal(reply(rules[0]), first);
    assert.equal(encodings.get(rules[0].body), 2);
    rules[0].body = changedBody;
    assert.equal(from(reply(rules[0]), 'base64').toString(), changedBody);
    assert.equal(from(reply(rules[0]), 'base64').toString(), changedBody);
    assert.equal(encodings.get(changedBody), 1);
    assert.equal(from(reply(rules[2]), 'base64').toString(), rules[2].body);
    assert.equal(encodings.get(rules[2].body), 1);
  } finally {
    Buffer.from = from;
  }
});

test('a mock body larger than the cache budget is returned without retaining it', () => {
  const large = rule({ pattern: 'https://api.test/*', action: 'mock', body: 'ğ'.repeat(4 * 1024 * 1024) });
  const from = Buffer.from;
  let encodings = 0;
  Buffer.from = (value, ...args) => {
    if (value === large.body) encodings++;
    return from(value, ...args);
  };
  try {
    for (let index = 0; index < 2; index++) {
      const response = pausedRequestCommand([large], paused('https://api.test/data'));
      assert.equal(from(response.params.body, 'base64').toString(), large.body);
    }
    assert.equal(encodings, 2);
  } finally {
    Buffer.from = from;
  }
});

test('prepared header edits follow source changes and do not share output objects between requests', () => {
  const edited = rule({
    pattern: 'https://api.test/*',
    action: 'headers',
    headers: 'X-A: first\nx-a: last\nCookie:\nInvalid Header: ignored',
  });
  const requestHeaders = { Accept: '*/*', Cookie: 'secret=1' };
  const reply = () => pausedRequestCommand([edited], paused('https://api.test/data', requestHeaders));
  const expected = [
    { name: 'Accept', value: '*/*' },
    { name: 'x-a', value: 'last' },
  ];
  const first = reply();
  assert.deepEqual(first.params.headers, expected);
  first.params.headers[0].value = 'changed original header';
  first.params.headers[1].value = 'changed rule header';
  first.params.headers.push({ name: 'Injected', value: 'unexpected' });
  assert.deepEqual(reply().params.headers, expected);
  assert.deepEqual(requestHeaders, { Accept: '*/*', Cookie: 'secret=1' });

  edited.headers = 'Accept:\nCookie: public=2\nX-B: next';
  assert.deepEqual(reply().params.headers, [
    { name: 'Cookie', value: 'public=2' },
    { name: 'X-B', value: 'next' },
  ]);
  edited.headers = '';
  assert.deepEqual(reply().params.headers, [
    { name: 'Accept', value: '*/*' },
    { name: 'Cookie', value: 'secret=1' },
  ]);
  const replacement = rule({ id: edited.id, pattern: edited.pattern, action: 'headers', headers: 'X-C: replacement' });
  assert.deepEqual(pausedRequestCommand([replacement], paused('https://api.test/data')).params.headers, [
    { name: 'X-C', value: 'replacement' },
  ]);
});

test('rules persist across restarts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-rules-'));
  const store = new RequestRuleStore(directory);
  assert.deepEqual(store.list(), []);
  store.save([rule({ id: 'keep', pattern: 'https://a.test/*' })]);
  store.saveNow();
  assert.equal(new RequestRuleStore(directory).list()[0].id, 'keep');
  fs.rmSync(directory, { recursive: true, force: true });
});
