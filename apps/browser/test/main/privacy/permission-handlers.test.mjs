import assert from 'node:assert/strict';
import { test } from 'node:test';
import handlers from '../../../dist/main/privacy/permission-handlers.js';
import permissions from '../../../dist/main/privacy/permissions.js';

const SITE = 'https://meet.example.com';

function fixture(isPrivate = false) {
  let request;
  let check;
  const store = new permissions.PermissionStore(null);
  handlers.installPermissionHandlers({
    sessions: [
      [
        {
          setPermissionRequestHandler: (handler) => (request = handler),
          setPermissionCheckHandler: (handler) => (check = handler),
        },
        isPrivate,
      ],
    ],
    storeFor: (privateSession) => {
      assert.equal(privateSession, isPrivate);
      return store;
    },
    parentOf: () => undefined,
  });
  const contents = { getURL: () => `${SITE}/room` };
  return {
    store,
    request: (permission, details = {}) =>
      new Promise((resolve) =>
        request(contents, permission, resolve, { requestingUrl: `${SITE}/room`, mediaTypes: [], ...details }),
      ),
    check: (permission, origin = SITE, details = {}) => check(contents, permission, origin, details),
  };
}

for (const isPrivate of [false, true]) {
  test(`display requests reach the source picker without granting device access (private=${isPrivate})`, async () => {
    const f = fixture(isPrivate);
    f.store.set(SITE, ['camera', 'microphone'], 'deny');
    assert.equal(await f.request('display-capture', { mediaTypes: ['video', 'audio'] }), true);
    assert.equal(await f.request('media'), false);
    assert.equal(f.check('display-capture'), true);
    assert.equal(await f.request('media', { mediaTypes: ['video'] }), false);
    assert.equal(await f.request('media', { mediaTypes: ['audio'] }), false);
    assert.equal(f.check('media', SITE, { mediaType: 'video' }), false);
    assert.equal(f.store.decide(SITE, ['camera', 'microphone']), 'deny');
    assert.equal(await f.request('midiSysex'), false);
  });
}

test('display permission does not bypass web origin checks', async () => {
  const f = fixture();
  for (const requestingUrl of ['https://other.example.com/', 'file:///tmp/test.html', undefined]) {
    assert.equal(await f.request('display-capture', { requestingUrl }), false);
    assert.equal(await f.request('media', { requestingUrl }), false);
  }
  assert.equal(f.check('display-capture', 'https://other.example.com'), false);
  assert.equal(f.check('display-capture', 'file:///tmp/test.html'), false);
  assert.equal(f.check('display-capture', SITE, { embeddingOrigin: 'https://other.example.com' }), false);
});
