import assert from 'node:assert/strict';
import { test } from 'node:test';
import webStoreApi from '../../../dist/main/extensions/web-store-api.js';

const { storeIcon } = webStoreApi;
const png = Buffer.from('89504e470d0a1a0a', 'hex');
const reply =
  (type, body = png, ok = true) =>
  async () =>
    new Response(body, { status: ok ? 200 : 404, headers: { 'content-type': type } });

test('install prompts show the store icon only from Google image hosts or inline images', async () => {
  const inline = `data:image/png;base64,${png.toString('base64')}`;
  assert.equal(await storeIcon(inline), inline);
  assert.equal(await storeIcon('data:image/svg+xml;base64,PHN2Zz4='), null);
  assert.equal(await storeIcon('https://lh3.googleusercontent.com/icon=s128', reply('image/png')), inline);
  assert.equal(await storeIcon('https://evil.example/icon.png', reply('image/png')), null);
  assert.equal(await storeIcon('http://lh3.googleusercontent.com/icon', reply('image/png')), null);
  assert.equal(await storeIcon('https://lh3.googleusercontent.com/x', reply('text/html')), null);
  assert.equal(await storeIcon('https://lh3.googleusercontent.com/x', reply('image/png', png, false)), null);
  assert.equal(
    await storeIcon('https://lh3.googleusercontent.com/x', reply('image/png', Buffer.alloc(300 * 1024))),
    null,
  );
  assert.equal(await storeIcon(undefined), null);
});
