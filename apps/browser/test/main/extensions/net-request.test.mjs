import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import rulesModule from '../../../dist/main/extensions/net-request-rules.js';
import netRequestModule from '../../../dist/main/extensions/net-request.js';

const { RuleIndex, bestMatch, redirectTarget, urlFilterSource, validateRule } = rulesModule;
const { NetRequestRules } = netRequestModule;
const ID = 'b'.repeat(32);

const request = (url, extra = {}) => ({
  url,
  method: 'GET',
  type: 'script',
  initiator: 'https://news.example/',
  tabId: 3,
  ...extra,
});
const rule = (id, condition, action = { type: 'block' }, priority) => ({ id, condition, action, priority });
const match = (rules, req) => bestMatch([new RuleIndex(rules)], req)?.rule.id ?? null;

test('urlFilter anchors, wildcards and separators match like Chrome', () => {
  const test = (filter, url) => new RegExp(urlFilterSource(filter), 'i').test(url);
  assert.equal(test('||ads.com^', 'https://cdn.ads.com/x.js'), true);
  assert.equal(test('||ads.com^', 'https://notads.com/x.js'), false);
  assert.equal(test('||ads.com^', 'https://ads.com.evil/x.js'), false);
  assert.equal(test('|https://a.com/*.gif|', 'https://a.com/p/x.gif'), true);
  assert.equal(test('|https://a.com/*.gif|', 'https://a.com/p/x.gif?y'), false);
  assert.equal(test('track^', 'https://x.com/track?id=1'), true);
  assert.equal(test('track^', 'https://x.com/tracker'), false);
});

test('index finds host-anchored, token and generic rules', () => {
  const rules = [
    rule(1, { urlFilter: '||ads.example^' }),
    rule(2, { urlFilter: '/banner/' }),
    rule(3, { regexFilter: 'pixel\\d+\\.gif' }),
    rule(4, { urlFilter: '||example.co' }),
    rule(5, { urlFilter: '/cdn/', responseHeaders: [{ header: 'location' }] }),
  ];
  assert.equal(match(rules, request('https://cdn.ads.example/a.js')), 1);
  assert.equal(match(rules, request('https://site.test/img/banner/1.png')), 2);
  assert.equal(match(rules, request('https://site.test/pixel42.gif')), 3);
  assert.equal(match(rules, request('https://www.example.com/')), 4);
  assert.equal(match(rules, request('https://site.test/clean.js')), null);
  assert.equal(match(rules, request('https://site.test/cdn/lib.js')), null);
});

test('conditions filter by resource type, domains and party', () => {
  const rules = [
    rule(1, { urlFilter: 'evil', resourceTypes: ['image'] }),
    rule(2, { urlFilter: 'tracker', domainType: 'thirdParty' }),
    rule(3, { urlFilter: 'ad', initiatorDomains: ['blog.test'], excludedRequestDomains: ['ok.test'] }),
    rule(4, { urlFilter: 'page' }),
  ];
  assert.equal(match(rules, request('https://x.test/evil.js')), null);
  assert.equal(match(rules, request('https://x.test/evil.png', { type: 'image' })), 1);
  assert.equal(match(rules, request('https://www.news.example/tracker.js')), null);
  assert.equal(match(rules, request('https://other.test/tracker.js')), 2);
  assert.equal(match(rules, request('https://x.test/ad.js', { initiator: 'https://www.blog.test/' })), 3);
  assert.equal(match(rules, request('https://ok.test/ad.js', { initiator: 'https://blog.test/' })), null);
  assert.equal(match(rules, request('https://x.test/page', { type: 'main_frame' })), null);
});

test('higher priority wins and allow beats block at equal priority', () => {
  const rules = [
    rule(1, { urlFilter: '||cdn.test^' }),
    rule(2, { urlFilter: '||cdn.test^' }, { type: 'allow' }),
    rule(3, { urlFilter: '||cdn.test/lib' }, { type: 'block' }, 2),
  ];
  assert.equal(match(rules, request('https://cdn.test/app.js')), 2);
  assert.equal(match(rules, request('https://cdn.test/lib.js')), 3);
});

test('redirects build the target from url, path, regex and transform', () => {
  const target = (action, condition, url) => {
    const found = bestMatch([new RuleIndex([rule(1, condition, action)])], request(url));
    return found && redirectTarget(found, request(url), (path) => `chrome-extension://${ID}${path}`);
  };
  assert.equal(
    target(
      { type: 'redirect', redirect: { extensionPath: '/web_accessible_resources/noop.js' } },
      { urlFilter: 'ga.js' },
      'https://g.test/ga.js',
    ),
    `chrome-extension://${ID}/web_accessible_resources/noop.js`,
  );
  assert.equal(
    target(
      { type: 'redirect', redirect: { regexSubstitution: 'https://\\1.test/$x' } },
      { regexFilter: '^https://www\\.(\\w+)\\.org/.*' },
      'https://www.site.org/a',
    ),
    'https://site.test/$x',
  );
  assert.equal(
    target(
      { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: ['utm_source'] } } } },
      { urlFilter: 'utm_source=' },
      'https://s.test/p?utm_source=x&id=2',
    ),
    'https://s.test/p?id=2',
  );
  assert.equal(
    target({ type: 'upgradeScheme' }, { urlFilter: '||plain.test^' }, 'http://plain.test/'),
    'https://plain.test/',
  );
});

test('invalid rules are refused', () => {
  assert.throws(() => validateRule({ id: 0, action: { type: 'block' }, condition: {} }));
  assert.throws(() => validateRule({ id: 1, action: { type: 'explode' }, condition: {} }));
  assert.throws(() => validateRule({ id: 1, action: { type: 'block' }, condition: { regexFilter: '(' } }));
  assert.throws(() =>
    validateRule({ id: 1, action: { type: 'block' }, condition: { urlFilter: 'a', regexFilter: 'b' } }),
  );
});

function fakeSession(manifest, files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-dnr-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(root, name), JSON.stringify(content));
  const extension = { id: ID, path: root, manifest };
  const listeners = {};
  const session = {
    extensions: {
      on: (name, listener) => (listeners[name] = listener),
      getAllExtensions: () => [extension],
      getExtension: (id) => (id === ID ? extension : null),
    },
  };
  return { session, root, listeners };
}

const details = (url, extra = {}) => ({
  url,
  method: 'GET',
  resourceType: 'script',
  referrer: '',
  webContentsId: 3,
  frame: { url: 'https://page.test/', origin: 'https://page.test', parent: null },
  ...extra,
});

test('static rulesets, dynamic rules and frame allow rules decide requests', async () => {
  const manifest = {
    permissions: ['declarativeNetRequest'],
    declarative_net_request: {
      rule_resources: [
        { id: 'ads', enabled: true, path: 'ads.json' },
        { id: 'extra', enabled: false, path: 'extra.json' },
      ],
    },
  };
  const { session, root } = fakeSession(manifest, {
    'ads.json': [rule(1, { urlFilter: '||ads.test^' }), { id: 2, broken: true }],
    'extra.json': [rule(1, { urlFilter: '||extra.test^' })],
  });
  const state = path.join(root, 'state.json');
  const rules = new NetRequestRules(session, state);
  assert.deepEqual(await rules.call(ID, 'getEnabledRulesets', []), ['ads']);
  assert.deepEqual(rules.decide(session, details('https://ads.test/a.js')), { cancel: true });
  assert.equal(rules.decide({}, details('https://ads.test/a.js')), null);
  assert.equal(rules.decide(session, details('https://extra.test/a.js')), null);

  await rules.call(ID, 'updateEnabledRulesets', [{ enableRulesetIds: ['extra'], disableRulesetIds: ['ads'] }]);
  assert.deepEqual(rules.decide(session, details('https://extra.test/a.js')), { cancel: true });
  assert.equal(rules.decide(session, details('https://ads.test/a.js')), null);

  await rules.call(ID, 'updateDynamicRules', [
    {
      addRules: [
        rule(7, { requestDomains: ['page.test'], resourceTypes: ['main_frame'] }, { type: 'allowAllRequests' }, 5),
      ],
    },
  ]);
  const inPage = details('https://extra.test/a.js');
  assert.equal(rules.decide(session, inPage), null);
  await assert.rejects(rules.call(ID, 'updateDynamicRules', [{ addRules: [rule(7, {})] }]));
  assert.equal((await rules.call(ID, 'getDynamicRules', [])).length, 1);

  await rules.call(ID, 'updateStaticRules', [{ rulesetId: 'extra', disableRuleIds: [1] }]);
  assert.deepEqual(await rules.call(ID, 'getDisabledRuleIds', [{ rulesetId: 'extra' }]), [1]);
  assert.equal(rules.decide(session, details('https://extra.test/a.js', { frame: null })), null);
});

test('redirects need host access and the state survives a restart', async () => {
  const manifest = {
    permissions: ['declarativeNetRequest'],
    host_permissions: ['https://*.allowed.test/*'],
    web_accessible_resources: [{ resources: ['/stubs/*.js'], matches: ['<all_urls>'], use_dynamic_url: true }],
  };
  const { session, root } = fakeSession(manifest, {});
  const state = path.join(root, 'state.json');
  const rules = new NetRequestRules(session, state);
  await rules.call(ID, 'updateDynamicRules', [
    {
      addRules: [
        rule(1, { urlFilter: 'old.js' }, { type: 'redirect', redirect: { url: 'https://cdn.allowed.test/new.js' } }),
      ],
    },
  ]);
  assert.deepEqual(rules.decide(session, details('https://www.allowed.test/old.js')), {
    redirectURL: 'https://cdn.allowed.test/new.js',
  });
  assert.equal(rules.decide(session, details('https://elsewhere.test/old.js')), null);
  const dynamicId = '0e3b6c1a-7a59-4d2c-9a43-2f1d5c0b9e11';
  await rules.call(ID, 'useDynamicId', [dynamicId]);
  await rules.call(ID, 'updateDynamicRules', [
    {
      addRules: [rule(3, { urlFilter: 'ads.js' }, { type: 'redirect', redirect: { extensionPath: '/stubs/noop.js' } })],
    },
  ]);
  assert.deepEqual(rules.decide(session, details('https://www.allowed.test/ads.js')), {
    redirectURL: `chrome-extension://${dynamicId}/stubs/noop.js`,
  });
  await rules.call(ID, 'updateSessionRules', [{ addRules: [rule(2, { urlFilter: 'gone' })] }]);

  await new Promise((resolve) => setTimeout(resolve, 700));
  const restarted = new NetRequestRules(session, state);
  assert.equal((await restarted.call(ID, 'getDynamicRules', [])).length, 2);
  assert.deepEqual(await restarted.call(ID, 'getSessionRules', []), []);
  assert.deepEqual(await restarted.call(ID, 'isRegexSupported', [{ regex: '[' }]), {
    isSupported: false,
    reason: 'syntaxError',
  });
});
