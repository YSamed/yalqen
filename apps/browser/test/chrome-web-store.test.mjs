import assert from 'node:assert/strict';
import { test } from 'node:test';
import store from '../dist/main/chrome-web-store.js';

const { downloadCrx, MAX_CRX_BYTES } = store;
const STORE_ID = 'abcdefghijklmnopabcdefghijklmnop';

function streamingResponse(chunks, headers = {}) {
  let reads = 0;
  let cancelled = false;
  const response = new Response(
    new ReadableStream(
      {
        pull(controller) {
          const chunk = chunks[reads++];
          if (chunk) controller.enqueue(chunk);
          else controller.close();
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    ),
    { headers },
  );
  return { response, reads: () => reads, cancelled: () => cancelled };
}

test('extension downloads assemble streamed chunks and omit credentials', async () => {
  const file = Buffer.from('PK\x03\x04payload');
  const f = streamingResponse([file.subarray(0, 2), file.subarray(2, 5), file.subarray(5)]);
  const result = await downloadCrx(
    STORE_ID,
    async (url, init) => {
      assert.match(url, /clients2\.google\.com/);
      assert.equal(init.credentials, 'omit');
      return f.response;
    },
    '140.0.0.0',
  );
  assert.deepEqual(result, { zip: file, key: null });
  assert.equal(f.cancelled(), false);
  assert.equal(f.response.body.locked, false);
});

test('declared oversized extension downloads cancel before reading the body', async () => {
  const f = streamingResponse([Buffer.from('unused')], { 'Content-Length': String(MAX_CRX_BYTES + 1) });
  await assert.rejects(downloadCrx(STORE_ID, async () => f.response, '140.0.0.0'));
  assert.equal(f.reads(), 0);
  assert.equal(f.cancelled(), true);
});

test('unknown or understated lengths are bounded while streaming and release the reader', async () => {
  const oversized = new Uint8Array(MAX_CRX_BYTES);
  for (const headers of [{}, { 'Content-Length': '4' }]) {
    const f = streamingResponse([Buffer.from('PK\x03\x04'), oversized, Buffer.from('not downloaded')], headers);
    await assert.rejects(downloadCrx(STORE_ID, async () => f.response, '140.0.0.0'));
    assert.equal(f.reads(), 2);
    assert.equal(f.cancelled(), true);
    assert.equal(f.response.body.locked, false);
  }
});

test('a failed download keeps its original error and releases the reader', async () => {
  const failure = new Error('connection closed');
  const response = new Response(
    new ReadableStream({
      pull(controller) {
        controller.error(failure);
      },
    }),
  );
  await assert.rejects(
    downloadCrx(STORE_ID, async () => response, '140.0.0.0'),
    (error) => error === failure,
  );
  assert.equal(response.body.locked, false);
});
