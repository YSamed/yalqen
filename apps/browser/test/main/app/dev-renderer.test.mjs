import assert from 'node:assert/strict';
import { test } from 'node:test';
import { devRendererUrl, devServerEnabled, loadRenderer } from '../../../dist/main/app/dev-renderer.js';

const VARIABLE = 'YALQEN_DEV_SERVER_URL';

// The module reads the variable per call rather than caching it at import, so a plain assignment
// is enough to move between the dev-server and build paths.
function withServer(value, run) {
  const previous = process.env[VARIABLE];
  if (value === undefined) delete process.env[VARIABLE];
  else process.env[VARIABLE] = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env[VARIABLE];
    else process.env[VARIABLE] = previous;
  }
}

test('no address means the build is loaded, not a server', () => {
  withServer(undefined, () => {
    assert.equal(devServerEnabled(), false);
    assert.equal(devRendererUrl('index.html'), null);
  });
});

test('an empty address is treated as no address', () => {
  withServer('   ', () => {
    assert.equal(devServerEnabled(), false);
    assert.equal(devRendererUrl('index.html'), null);
  });
});

test('only the page name is taken, so an absolute build path resolves at the server root', () => {
  withServer('http://127.0.0.1:5173', () => {
    assert.equal(devServerEnabled(), true);
    assert.equal(devRendererUrl('/home/app/dist/renderer/index.html'), 'http://127.0.0.1:5173/index.html');
  });
});

test('a missing trailing slash does not drop the last segment of the origin', () => {
  withServer('http://127.0.0.1:5173', () => {
    assert.equal(devRendererUrl('find.html'), 'http://127.0.0.1:5173/find.html');
  });
});

test('an origin with a sub-path keeps that path', () => {
  withServer('http://127.0.0.1:8080/app', () => {
    assert.equal(devRendererUrl('index.html'), 'http://127.0.0.1:8080/app/index.html');
  });
});

test('query values are carried onto the address', () => {
  withServer('http://localhost:5173', () => {
    assert.equal(
      devRendererUrl('welcome.html', { lang: 'nl', docked: '1' }),
      'http://localhost:5173/welcome.html?lang=nl&docked=1',
    );
  });
});

test('a non-http address is rejected rather than loaded', () => {
  withServer('file:///tmp/renderer', () => {
    assert.throws(() => devServerEnabled(), /YALQEN_DEV_SERVER_URL is not an http address/);
  });
});

test('loadRenderer goes to the server when one is up and to the file otherwise', async () => {
  const contents = {
    calls: [],
    loadURL(url) {
      this.calls.push(['url', url]);
      return Promise.resolve();
    },
    loadFile(page, options) {
      this.calls.push(['file', page, options]);
      return Promise.resolve();
    },
  };

  await withServer(undefined, () => loadRenderer(contents, '/x/dist/renderer/index.html', { lang: 'fr' }));
  assert.deepEqual(contents.calls, [['file', '/x/dist/renderer/index.html', { query: { lang: 'fr' } }]]);

  contents.calls = [];
  await withServer('http://127.0.0.1:5173', () =>
    loadRenderer(contents, '/x/dist/renderer/index.html', { lang: 'fr' }),
  );
  assert.deepEqual(contents.calls, [['url', 'http://127.0.0.1:5173/index.html?lang=fr']]);
});
