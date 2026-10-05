import assert from 'node:assert/strict';
import { test } from 'node:test';
import cookies from '../../../dist/main/privacy/third-party-cookies.js';

const { headerValues, requestCookieNames, responseCookieNames, siteOf } = cookies;

test('sites are registrable domains, public suffixes included', () => {
  assert.equal(siteOf('https://www.example.com/a'), 'example.com');
  assert.equal(siteOf('https://a.b.gov.tr/'), 'b.gov.tr');
  assert.equal(siteOf('https://shop.example.co.uk/'), 'example.co.uk');
  assert.equal(siteOf('http://127.0.0.1:8080/'), '127.0.0.1');
  assert.equal(siteOf('http://localhost/'), 'localhost');
  assert.equal(siteOf('wss://chat.example.com/'), 'example.com');
  assert.equal(siteOf('yalqen://newtab/'), null);
  assert.equal(siteOf('data:text/plain,x'), null);
  assert.equal(siteOf('nope'), null);
});

test('subdomains share a site, other domains do not', () => {
  assert.equal(siteOf('https://cdn.example.com/x.js'), siteOf('https://www.example.com/'));
  assert.notEqual(siteOf('https://tracker.net/p'), siteOf('https://www.example.com/'));
  assert.notEqual(siteOf('https://a.gov.tr/'), siteOf('https://b.gov.tr/'));
});

test('private public suffixes keep hosted tenants separate', () => {
  assert.equal(siteOf('https://alice.github.io/'), 'alice.github.io');
  assert.equal(siteOf('https://static.alice.github.io/'), 'alice.github.io');
  assert.notEqual(siteOf('https://bob.github.io/script.js'), siteOf('https://alice.github.io/'));
  assert.equal(siteOf('https://static.alice.github.io/script.js'), siteOf('https://alice.github.io/'));
  assert.notEqual(siteOf('https://first.blogspot.com/'), siteOf('https://second.blogspot.com/'));
});

test('cookie names are read from request and response headers', () => {
  assert.deepEqual(requestCookieNames('a=1; b=two=2;  c='), ['a', 'b', 'c']);
  assert.deepEqual(responseCookieNames(['id=9; Path=/; HttpOnly', ' x = 1 ', '=nameless']), ['id', 'x']);
  assert.deepEqual(headerValues({ 'Set-Cookie': ['a=1'], 'set-cookie': 'b=2', Other: 'x' }, 'set-cookie'), [
    'a=1',
    'b=2',
  ]);
  assert.deepEqual(headerValues(undefined, 'set-cookie'), []);
});

test('cookie listeners are attached only while blocking is on', () => {
  const calls = [];
  const webRequest = Object.fromEntries(
    ['onBeforeSendHeaders', 'onCompleted', 'onErrorOccurred'].map((name) => [
      name,
      (...args) => calls.push([name, args.at(-1) !== null]),
    ]),
  );
  const session = { webRequest, cookies: { remove: async () => {} } };
  cookies.setThirdPartyCookieBlocking(session, false);
  assert.deepEqual(calls, []);
  cookies.setThirdPartyCookieBlocking(session, true);
  cookies.setThirdPartyCookieBlocking(session, true);
  assert.deepEqual(calls, [
    ['onBeforeSendHeaders', true],
    ['onCompleted', true],
    ['onErrorOccurred', true],
  ]);
  calls.length = 0;
  cookies.setThirdPartyCookieBlocking(session, false);
  assert.deepEqual(calls, [
    ['onBeforeSendHeaders', true],
    ['onCompleted', false],
    ['onErrorOccurred', false],
  ]);
});

function fixture() {
  const listeners = {};
  const removed = [];
  const session = {
    webRequest: Object.fromEntries(
      ['onBeforeSendHeaders', 'onCompleted', 'onErrorOccurred'].map((name) => [
        name,
        (...args) => {
          listeners[name] = args.at(-1);
        },
      ]),
    ),
    cookies: {
      remove: async (url, name) => {
        removed.push([url, name]);
      },
    },
  };
  let url = 'https://www.example.com/';
  let destroyed = false;
  const contents = { getURL: () => url, isDestroyed: () => destroyed };
  cookies.setThirdPartyCookieBlocking(session, true);
  const request = (requestUrl, extra = {}) => {
    const details = {
      id: 1,
      url: requestUrl,
      resourceType: 'script',
      requestHeaders: { Cookie: 'old=1', Accept: '*/*' },
      webContents: contents,
      ...extra,
    };
    let response;
    listeners.onBeforeSendHeaders(details, (value) => {
      response = value;
    });
    return response;
  };
  return {
    session,
    listeners,
    removed,
    request,
    navigate: (value) => {
      url = value;
    },
    destroy: () => {
      destroyed = true;
    },
  };
}

test('cached classification follows page navigation, schemes and unavailable contents', () => {
  const f = fixture();
  assert.deepEqual(f.request('https://cdn.example.com/a.js'), {});
  assert.deepEqual(f.request('https://tracker.net/a.js'), { requestHeaders: { Accept: '*/*' } });
  f.navigate('https://tracker.net/');
  assert.deepEqual(f.request('https://tracker.net/b.js'), {});
  assert.deepEqual(f.request('https://cdn.example.com/a.js'), { requestHeaders: { Accept: '*/*' } });
  assert.deepEqual(f.request('file://cdn.example.com/a.js'), {});
  assert.deepEqual(f.request('not a URL'), {});
  assert.deepEqual(f.request('https://example.com/', { resourceType: 'mainFrame' }), {});
  f.navigate('yalqen://newtab/');
  assert.deepEqual(f.request('https://tracker.net/c.js'), { requestHeaders: { Accept: '*/*' } });
  f.navigate('');
  assert.deepEqual(f.request('https://tracker.net/c.js'), {});
  f.navigate('https://example.com/');
  assert.deepEqual(f.request('https://tracker.net/c.js', { webContents: null }), {});
  f.destroy();
  assert.deepEqual(f.request('https://tracker.net/c.js'), {});
});

test('blocking keeps existing cookie names, removes new response cookies and cleans failed requests', () => {
  const f = fixture();
  const url = 'https://tracker.net/p';
  assert.deepEqual(f.request(url, { requestHeaders: { cOoKiE: 'old=1; keep=2', Other: 'x' } }), {
    requestHeaders: { Other: 'x' },
  });
  f.listeners.onCompleted({ id: 1, url, responseHeaders: { 'Set-Cookie': ['old=2', 'keep=3', 'fresh=4; Path=/'] } });
  assert.deepEqual(f.removed, [[url, 'fresh']]);
  f.request(url, { id: 2 });
  f.listeners.onErrorOccurred({ id: 2 });
  f.listeners.onCompleted({ id: 2, url, responseHeaders: { 'Set-Cookie': ['unexpected=1'] } });
  assert.equal(f.removed.length, 1);
  f.request(url, { id: 3, requestHeaders: {} });
  f.listeners.onCompleted({ id: 3, url, responseHeaders: { 'set-cookie': 'fresh=5' } });
  assert.equal(f.removed.length, 2);
});

test('cookie blocking distinguishes hosted tenants and follows tenant navigation', () => {
  const f = fixture();
  f.navigate('https://alice.github.io/');
  assert.deepEqual(f.request('https://bob.github.io/script.js'), { requestHeaders: { Accept: '*/*' } });
  assert.deepEqual(f.request('https://static.alice.github.io/script.js'), {});
  f.navigate('https://bob.github.io/');
  assert.deepEqual(f.request('https://bob.github.io/script.js'), {});
  assert.deepEqual(f.request('https://alice.github.io/script.js'), { requestHeaders: { Accept: '*/*' } });
});

test('a third-party request redirected to the page site keeps first-party response cookies', () => {
  const f = fixture();
  f.request('https://tracker.net/redirect');
  assert.deepEqual(f.request('https://www.example.com/final'), {});
  f.listeners.onCompleted({
    id: 1,
    url: 'https://www.example.com/final',
    responseHeaders: { 'Set-Cookie': ['first-party=1'] },
  });
  assert.deepEqual(f.removed, []);

  f.request('https://www.example.com/redirect', { id: 2 });
  f.request('https://tracker.net/final', { id: 2 });
  f.listeners.onCompleted({ id: 2, url: 'https://tracker.net/final', responseHeaders: { 'Set-Cookie': ['fresh=1'] } });
  assert.deepEqual(f.removed, [['https://tracker.net/final', 'fresh']]);
});

test('domain eviction and independently enabled sessions preserve classification', () => {
  const a = fixture();
  const b = fixture();
  b.navigate('https://tracker.net/');
  for (let index = 0; index < 600; index++) {
    assert.deepEqual(a.request(`https://host${index}.example.com/`, { id: index + 10 }), {});
  }
  assert.deepEqual(a.request('https://tracker.net/p'), { requestHeaders: { Accept: '*/*' } });
  assert.deepEqual(b.request('https://tracker.net/p'), {});
  cookies.setThirdPartyCookieBlocking(a.session, false);
  assert.equal(a.listeners.onCompleted, null);
  a.navigate('https://tracker.net/');
  cookies.setThirdPartyCookieBlocking(a.session, true);
  assert.deepEqual(a.request('https://tracker.net/p'), {});
  assert.deepEqual(a.request('https://example.com/p'), { requestHeaders: { Accept: '*/*' } });
});
