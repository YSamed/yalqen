import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import dnr from '../../../dist/main/extensions/declarative-net-request.js';
import registry from '../../../dist/main/extensions/dnr-registry.js';

const { DnrRuleset, dnrResourceType } = dnr;
const EXT = 'abcdefghijklmnopabcdefghijklmnop';
const rule = (id, action, condition, priority = 1) => ({ id, priority, action, condition });
const block = (condition, priority) => rule(1, { type: 'block' }, condition, priority);
const request = (url, type = 'script', initiator = 'https://site.example', method = 'GET') => ({
  url,
  method,
  type,
  initiator,
});
const result = (rules, req, floor) => new DnrRuleset(rules, EXT).match(req, floor);

test('url filters honour domain anchors, separators, wildcards and end anchors', () => {
  const rules = [block({ urlFilter: '||ads.example^' })];
  assert.equal(result(rules, request('https://ads.example/x.js')).type, 'block');
  assert.equal(result(rules, request('https://cdn.ads.example/x.js')).type, 'block');
  assert.equal(result(rules, request('https://badads.example/x.js')), null);
  assert.equal(result(rules, request('https://ads.example.org/x.js')), null);
  assert.equal(
    result([block({ urlFilter: '/banner/*.gif|' })], request('https://a.test/banner/x/y.gif')).type,
    'block',
  );
  assert.equal(result([block({ urlFilter: '/banner/*.gif|' })], request('https://a.test/banner/x.gif?v=1')), null);
  assert.equal(result([block({ urlFilter: '|http://' })], request('http://a.test/')).type, 'block');
  assert.equal(result([block({ urlFilter: '|http://' })], request('https://a.test/?u=http://')), null);
  assert.equal(result([block({ urlFilter: 'track^' })], request('https://a.test/track?x')).type, 'block');
  assert.equal(result([block({ urlFilter: 'track^' })], request('https://a.test/tracker')), null);
  assert.equal(
    result([block({ urlFilter: '/Ads/', isUrlFilterCaseSensitive: true })], request('https://a.test/ads/')),
    null,
  );
  assert.equal(result([block({ urlFilter: '/Ads/' })], request('https://a.test/ads/')).type, 'block');
});

test('domain, initiator, party, type and method conditions narrow a rule', () => {
  const domains = [block({ requestDomains: ['tracker.test'], excludedRequestDomains: ['ok.tracker.test'] })];
  assert.equal(result(domains, request('https://x.tracker.test/a')).type, 'block');
  assert.equal(result(domains, request('https://ok.tracker.test/a')), null);
  const initiators = [block({ urlFilter: '/pixel', initiatorDomains: ['news.test'] })];
  assert.equal(result(initiators, request('https://cdn.test/pixel', 'image', 'https://www.news.test')).type, 'block');
  assert.equal(result(initiators, request('https://cdn.test/pixel', 'image', 'https://blog.test')), null);
  assert.equal(result(initiators, request('https://cdn.test/pixel', 'image', null)), null);
  const thirdParty = [block({ urlFilter: '/collect', domainType: 'thirdParty' })];
  assert.equal(result(thirdParty, request('https://stats.site.example/collect')), null);
  assert.equal(result(thirdParty, request('https://stats.other.test/collect')).type, 'block');
  const anyType = [block({ urlFilter: '||evil.test^' })];
  assert.equal(result(anyType, request('https://evil.test/', 'main_frame')), null);
  assert.equal(
    result(
      [block({ urlFilter: '||evil.test^', resourceTypes: ['main_frame'] })],
      request('https://evil.test/', 'main_frame'),
    ).type,
    'block',
  );
  assert.equal(
    result(
      [block({ urlFilter: '||evil.test^', excludedResourceTypes: ['image'] })],
      request('https://evil.test/a', 'image'),
    ),
    null,
  );
  assert.equal(
    result([block({ urlFilter: '/api', requestMethods: ['post'] })], request('https://a.test/api', 'xmlhttprequest')),
    null,
  );
  assert.equal(
    result(
      [block({ urlFilter: '/api', requestMethods: ['post'] })],
      request('https://a.test/api', 'xmlhttprequest', null, 'POST'),
    ).type,
    'block',
  );
});

test('the highest priority wins and allow beats block at equal priority', () => {
  const rules = [
    block({ urlFilter: '||ads.test^' }, 10),
    rule(2, { type: 'allow' }, { urlFilter: '||ads.test/ok' }, 10),
  ];
  assert.equal(result(rules, request('https://ads.test/ok.js')).type, 'allow');
  assert.equal(result(rules, request('https://ads.test/no.js')).type, 'block');
  rules.push(block({ urlFilter: '/ok.js' }, 20));
  assert.equal(result(rules, request('https://ads.test/ok.js')).type, 'block');
});

test('an allow-all floor lets only higher priority rules act', () => {
  const rules = [block({ urlFilter: '||ads.test^' }, 10), block({ urlFilter: '||malware.test^' }, 50)];
  assert.equal(result(rules, request('https://ads.test/a.js'), 30), null);
  assert.equal(result(rules, request('https://malware.test/a.js'), 30).type, 'block');
});

test('redirects point at extension files, rewritten URLs and upgraded schemes', () => {
  const surrogate = rule(
    1,
    { type: 'redirect', redirect: { extensionPath: '/web_accessible_resources/noop.js' } },
    { urlFilter: '/ga.js' },
  );
  assert.deepEqual(result([surrogate], request('https://www.google-analytics.com/ga.js')), {
    type: 'redirect',
    priority: 1,
    url: `chrome-extension://${EXT}/web_accessible_resources/noop.js`,
  });
  const strip = rule(
    1,
    { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: ['utm_source', 'fbclid'] } } } },
    { urlFilter: 'utm_source=', resourceTypes: ['main_frame'] },
  );
  assert.equal(
    result([strip], request('https://a.test/p?utm_source=x&id=2&fbclid=y', 'main_frame')).url,
    'https://a.test/p?id=2',
  );
  const regex = rule(
    1,
    { type: 'redirect', redirect: { regexSubstitution: 'https://\\1.test/clean' } },
    { regexFilter: '^https://(\\w+)\\.example/track' },
  );
  assert.equal(result([regex], request('https://shop.example/track?id=1')).url, 'https://shop.test/clean');
  const upgrade = rule(1, { type: 'upgradeScheme' }, { requestDomains: ['plain.test'] });
  assert.equal(result([upgrade], request('http://plain.test/a.js')).url, 'https://plain.test/a.js');
  assert.equal(result([upgrade], request('https://plain.test/a.js')), null);
  const loop = rule(
    1,
    { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: ['x'] } } } },
    { urlFilter: '/same' },
  );
  assert.equal(result([loop], request('https://a.test/same')), null);
});

test('rules that cannot be evaluated faithfully are skipped', () => {
  const rules = [
    rule(1, { type: 'modifyHeaders', responseHeaders: [] }, { urlFilter: '/a' }),
    block({ urlFilter: '/a', tabIds: [1] }),
    block({ regexFilter: '(' }),
    block({ urlFilter: '/a', regexFilter: '/a' }),
    rule(1, { type: 'redirect' }, { urlFilter: '/a' }),
    null,
  ];
  const ruleset = new DnrRuleset(rules, EXT);
  assert.equal(ruleset.size, 0);
  assert.equal(ruleset.match(request('https://x.test/a')), null);
});

test('Electron resource types map to declarativeNetRequest types', () => {
  assert.equal(dnrResourceType('mainFrame'), 'main_frame');
  assert.equal(dnrResourceType('xhr'), 'xmlhttprequest');
  assert.equal(dnrResourceType('webSocket'), 'websocket');
  assert.equal(dnrResourceType('somethingNew'), 'other');
});

function extensionFixture(t, manifest, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-dnr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), JSON.stringify(content));
  }
  return { dir, extension: { id: EXT, path: dir, manifest } };
}

const until = async (check) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(check());
};

const details = (url, resourceType = 'script', extra = {}) => ({
  url,
  method: 'GET',
  resourceType,
  initiatorOrigin: 'https://site.example',
  webContentsId: 7,
  ...extra,
});

test('the registry applies enabled rulesets, mirrors updates and persists dynamic rules', async (t) => {
  const manifest = {
    permissions: ['declarativeNetRequest'],
    declarative_net_request: {
      rule_resources: [
        { id: 'ads', enabled: true, path: 'rules/ads.json' },
        { id: 'extra', enabled: false, path: 'rules/extra.json' },
        { id: 'escape', enabled: true, path: '../../etc/passwd' },
      ],
    },
  };
  const { dir, extension } = extensionFixture(t, manifest, {
    'rules/ads.json': [block({ urlFilter: '||ads.test^' })],
    'rules/extra.json': [block({ urlFilter: '||extra.test^' })],
  });
  const file = path.join(dir, 'state.json');
  const rules = new registry.DeclarativeNetRequest(file);
  rules.load(extension);
  await until(() => rules.decide(details('https://ads.test/a.js'))?.cancel === true);
  assert.equal(rules.decide(details('https://extra.test/a.js')), null);
  assert.equal(
    rules.decide(details('https://ads.test/a.js', 'script', { initiatorOrigin: `chrome-extension://${EXT}` })),
    null,
  );

  const trusted = rule(
    9,
    { type: 'allowAllRequests' },
    { requestDomains: ['trusted.test'], resourceTypes: ['main_frame'] },
    100,
  );
  rules.update(EXT, { dynamic: [], session: [] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(rules.decide(details('https://ads.test/a.js'))?.cancel, true);
  rules.update(EXT, {
    rulesets: { enableRulesetIds: ['extra', 'unknown'], disableRulesetIds: ['ads'] },
    dynamic: [trusted],
    session: [],
  });
  await until(() => rules.decide(details('https://extra.test/a.js'))?.cancel === true);
  assert.equal(rules.decide(details('https://ads.test/a.js')), null);

  rules.update(EXT, {
    rulesets: { enableRulesetIds: ['ads'], disableRulesetIds: ['extra'] },
    dynamic: [trusted],
    session: [],
  });
  await until(() => rules.decide(details('https://ads.test/a.js'))?.cancel === true);
  assert.equal(rules.decide(details('https://trusted.test/', 'mainFrame', { initiatorOrigin: undefined })), null);
  assert.equal(rules.decide(details('https://ads.test/a.js')), null);
  rules.decide(details('https://other.test/', 'mainFrame', { initiatorOrigin: undefined }));
  assert.equal(rules.decide(details('https://ads.test/a.js'))?.cancel, true);

  rules.update(EXT, { dynamic: 'nope', session: [] });
  rules.saveNow();
  const restarted = new registry.DeclarativeNetRequest(file);
  restarted.load(extension);
  await until(() => restarted.decide(details('https://ads.test/a.js'))?.cancel === true);
  assert.equal(restarted.decide(details('https://trusted.test/', 'mainFrame', { initiatorOrigin: undefined })), null);
  assert.equal(restarted.decide(details('https://ads.test/a.js')), null);
});

test('extensions without the permission are ignored', async (t) => {
  const { extension } = extensionFixture(
    t,
    { declarative_net_request: { rule_resources: [{ id: 'a', enabled: true, path: 'a.json' }] } },
    {
      'a.json': [block({ urlFilter: '||ads.test^' })],
    },
  );
  const rules = new registry.DeclarativeNetRequest(path.join(os.tmpdir(), `yalqen-dnr-none-${process.pid}.json`));
  rules.load(extension);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(rules.decide(details('https://ads.test/a.js')), null);
});
