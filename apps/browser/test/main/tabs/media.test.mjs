import assert from 'node:assert/strict';
import { test } from 'node:test';
import media from '../../../dist/main/tabs/media.js';

const { parsePageMedia, mediaSeekScript, mediaSkipScript } = media;

test('page media keeps the trimmed title, the times and the track actions', () => {
  assert.deepEqual(
    parsePageMedia({
      title: '  Midnight City ',
      duration: 243.5,
      position: 61,
      paused: false,
      actions: 'nexttrack',
    }),
    {
      title: 'Midnight City',
      duration: 243.5,
      position: 61,
      paused: false,
      canPrevious: false,
      canNext: true,
    },
  );
});

test('page media drops untrusted shapes and non-finite times', () => {
  assert.equal(parsePageMedia(null), null);
  assert.equal(parsePageMedia('song'), null);
  assert.deepEqual(parsePageMedia({ title: 'x'.repeat(500), duration: Infinity, position: -1 }), {
    title: 'x'.repeat(300),
    duration: null,
    position: null,
    paused: true,
    canPrevious: false,
    canNext: false,
  });
  const tracks = parsePageMedia({ actions: 'previoustrack,nexttrack,seekto' });
  assert.deepEqual([tracks.canPrevious, tracks.canNext], [true, true]);
  assert.equal(parsePageMedia({ actions: ['nexttrack'] }).canNext, false);
});

test('the seek script embeds only the given number', () => {
  assert.match(mediaSeekScript(-10), /main\.currentTime \+ -10\)/);
});

test('the skip script runs only the two track actions', () => {
  assert.match(mediaSkipScript('next'), /detail: 'nexttrack'/);
  assert.match(mediaSkipScript('previous'), /detail: 'previoustrack'/);
});
