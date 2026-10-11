import assert from 'node:assert/strict';
import { test } from 'node:test';
import media from '../../../dist/main/tabs/media.js';

const { parsePageMedia, mediaSeekScript } = media;

test('page media keeps the largest web artwork and trimmed metadata', () => {
  assert.deepEqual(
    parsePageMedia({
      title: '  Midnight City ',
      artist: 'M83',
      artwork: [
        { src: 'https://cdn.example/96.jpg', sizes: '96x96' },
        { src: 'https://cdn.example/512.jpg', sizes: '512x512' },
        { src: 'javascript:alert(1)', sizes: '1024x1024' },
        { src: 'data:image/png;base64,AAAA', sizes: '2048x2048' },
      ],
      duration: 243.5,
      position: 61,
      paused: false,
    }),
    {
      title: 'Midnight City',
      artist: 'M83',
      artwork: 'https://cdn.example/512.jpg',
      duration: 243.5,
      position: 61,
      paused: false,
    },
  );
});

test('page media drops untrusted shapes and non-finite times', () => {
  assert.equal(parsePageMedia(null), null);
  assert.equal(parsePageMedia('song'), null);
  assert.deepEqual(
    parsePageMedia({ title: 7, artist: 'x'.repeat(500), artwork: 'nope', duration: Infinity, position: -1 }),
    { title: '', artist: 'x'.repeat(300), artwork: null, duration: null, position: null, paused: true },
  );
});

test('the seek script embeds only the given number', () => {
  assert.match(mediaSeekScript(-10), /element\.currentTime \+ -10\)/);
});
