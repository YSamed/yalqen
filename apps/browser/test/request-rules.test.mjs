import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import requestRules from '../dist/main/request-rules.js';
import pageOverrides from '../dist/main/page-overrides.js';

const {
  RequestRuleStore,
  interceptPatterns,
  matchRequestRule,
  newRequestRule,
  parseHeaderLines,
  pausedRequestCommand,
  sanitizeRequestRules,
} = requestRules;
const { NO_OVERRIDES, overrideCommands } = pageOverrides;

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

test('rules persist across restarts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-rules-'));
  const store = new RequestRuleStore(directory);
  assert.deepEqual(store.list(), []);
  store.save([rule({ id: 'keep', pattern: 'https://a.test/*' })]);
  store.saveNow();
  assert.equal(new RequestRuleStore(directory).list()[0].id, 'keep');
  fs.rmSync(directory, { recursive: true, force: true });
});
