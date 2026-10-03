import assert from 'node:assert/strict';
import { test } from 'node:test';
import translate from '../dist/main/tabs/translate.js';

const {
  applyScript,
  applySelectionScript,
  chunkTexts,
  normalizeLanguage,
  parseCollected,
  parseTranslation,
  translatePage,
  translateSelection,
  translateTexts,
} = translate;

const reply = (lines, source = 'en') => ({
  ok: true,
  json: async () => [[[lines.join('\n'), 'original', null, null, 1]], null, source],
});

test('texts are grouped by size and count', () => {
  assert.deepEqual(chunkTexts(['a', 'b', 'c']), [[0, 1, 2]]);
  assert.deepEqual(chunkTexts(['x'.repeat(3000), 'y'.repeat(3000)]), [[0], [1]]);
  const many = Array.from({ length: 120 }, () => 'w');
  assert.deepEqual(
    chunkTexts(many).map((chunk) => chunk.length),
    [50, 50, 20],
  );
  assert.deepEqual(chunkTexts([]), []);
});

test('engine responses are joined and their source language read', () => {
  assert.deepEqual(
    parseTranslation([
      [
        ['Merhaba ', 'Hello '],
        ['dünya', 'world'],
      ],
      null,
      'en',
    ]),
    {
      text: 'Merhaba dünya',
      source: 'en',
    },
  );
  assert.equal(parseTranslation('nope'), null);
  assert.equal(parseTranslation([]), null);
  assert.equal(normalizeLanguage('EN'), null);
  assert.equal(normalizeLanguage('en'), 'en');
  assert.equal(normalizeLanguage(null), null);
});

test('collected pages are validated', () => {
  assert.deepEqual(parseCollected({ token: 't', texts: ['a'] }), { token: 't', texts: ['a'] });
  assert.equal(parseCollected({ token: 't', texts: [1] }), null);
  assert.equal(parseCollected(null), null);
});

test('a batch maps back to its texts', async () => {
  const requests = [];
  const fetchLike = async (url, init) => {
    requests.push({ url, body: init.body });
    return reply(['Bir', 'İki', 'Üç']);
  };
  const result = await translateTexts(fetchLike, ['One', 'Two', 'Three'], 'tr');
  assert.deepEqual(result, { texts: ['Bir', 'İki', 'Üç'], source: 'en' });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /tl=tr/);
  assert.equal(requests[0].body, `q=${encodeURIComponent('One\nTwo\nThree')}`);
});

test('a batch the engine reshaped is retried one text at a time', async () => {
  let calls = 0;
  const fetchLike = async (_url, init) => {
    calls++;
    const q = decodeURIComponent(init.body.slice(2));
    return q.includes('\n') ? reply(['Hepsi tek satırda']) : reply([`çeviri:${q}`]);
  };
  const result = await translateTexts(fetchLike, ['a', 'b'], 'tr');
  assert.deepEqual(result.texts, ['çeviri:a', 'çeviri:b']);
  assert.equal(calls, 3);
});

test('a failing engine rejects', async () => {
  await assert.rejects(translateTexts(async () => ({ ok: false, json: async () => null }), ['a'], 'tr'));
});

test('duplicate texts are translated once and mapped back in their original order', async () => {
  const requests = [];
  const input = Array.from({ length: 120 }, (_, index) => (index % 2 ? 'Two' : 'One'));
  const result = await translateTexts(
    async (_url, init) => {
      requests.push(decodeURIComponent(init.body.slice(2)));
      return reply(['Bir', 'İki']);
    },
    input,
    'tr',
  );
  assert.deepEqual(requests, ['One\nTwo']);
  assert.deepEqual(
    result.texts,
    input.map((text) => (text === 'One' ? 'Bir' : 'İki')),
  );

  const again = await translateTexts(async () => reply(['Un', 'Deux'], 'fr'), ['One', 'Two'], 'en');
  assert.deepEqual(again.texts, ['Un', 'Deux']);
});

test('cancellation stops line-by-line retries after a reshaped batch', async () => {
  let cancelled = false;
  let calls = 0;
  const result = await translateTexts(
    async () => {
      calls++;
      cancelled = true;
      return reply(['merged']);
    },
    ['a', 'b'],
    'tr',
    () => cancelled,
  );
  assert.equal(calls, 1);
  assert.deepEqual(result.texts, ['a', 'b']);
});

test('cancellation during a single retry stops the rest of the batch', async () => {
  let calls = 0;
  const result = await translateTexts(
    async () => {
      calls++;
      return reply([calls === 1 ? 'merged' : 'translated']);
    },
    ['a', 'b', 'c'],
    'tr',
    () => calls >= 2,
  );
  assert.equal(calls, 2);
  assert.deepEqual(result.texts, ['a', 'b', 'c']);
});

test('a failed worker prevents other workers from retrying or starting queued chunks', async () => {
  const pending = [];
  let calls = 0;
  const result = translateTexts(
    async () => {
      calls++;
      if (calls === 1) throw new Error('engine failed');
      return new Promise((resolve) => pending.push(resolve));
    },
    Array.from({ length: 250 }, (_, index) => `text ${index}`),
    'tr',
  );
  await assert.rejects(result, /engine failed/);
  assert.equal(calls, 4);
  pending.forEach((resolve) => resolve(reply(['merged'])));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 4);
});

test('a cancelled run applies nothing', async () => {
  const scripts = [];
  const target = {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: async (_id, [{ code }]) => {
      scripts.push(code);
      return { token: 'tok', texts: ['Hello'] };
    },
  };
  const result = await translatePage(target, async () => reply(['Merhaba']), 'tr', { cancelled: () => true });
  assert.equal(result, null);
  assert.equal(scripts.length, 1);
});

test('a finished run applies its translations under the page token', async () => {
  const scripts = [];
  const target = {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: async (_id, [{ code }]) => {
      scripts.push(code);
      return scripts.length === 1 ? { token: 'tok', texts: ['Hello'] } : true;
    },
  };
  const result = await translatePage(target, async () => reply(['Merhaba']), 'tr', { cancelled: () => false });
  assert.deepEqual(result, { source: 'en' });
  assert.equal(scripts[1], applyScript('tok', ['Merhaba']));
});

test('a page with nothing to translate is an error', async () => {
  const target = {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: async () => ({ token: 'tok', texts: [] }),
  };
  await assert.rejects(translatePage(target, async () => reply([]), 'tr', { cancelled: () => false }));
});

test('a translated selection is applied under its own token', async () => {
  const scripts = [];
  const target = {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: async (_id, [{ code }]) => {
      scripts.push(code);
      return scripts.length === 1 ? { token: 'sel', texts: ['Hello', 'world'] } : true;
    },
  };
  assert.equal(await translateSelection(target, async () => reply(['Merhaba', 'dünya']), 'tr'), true);
  assert.equal(scripts[1], applySelectionScript('sel', ['Merhaba', 'dünya']));
  assert.notEqual(scripts[1], applyScript('sel', ['Merhaba', 'dünya']));
});

test('an empty selection is an error', async () => {
  const target = {
    isDestroyed: () => false,
    executeJavaScriptInIsolatedWorld: async () => ({ token: 'sel', texts: [] }),
  };
  await assert.rejects(translateSelection(target, async () => reply([]), 'tr'));
});
