import assert from 'node:assert/strict';
import { test } from 'node:test';
import triggerModule from '../../dist/shared/composer-trigger.js';

const { complete, findTrigger } = triggerModule;

test('a slash at the start of the message opens commands', () => {
  assert.deepEqual(findTrigger('/com', 4), { kind: 'command', query: 'com', start: 0, end: 4 });
  assert.equal(findTrigger('/compact now', 12), null);
  assert.equal(findTrigger('see a/b', 7), null);
});

test('an @ after a space or at the start opens mentions', () => {
  assert.deepEqual(findTrigger('look at @src/ap', 15), { kind: 'mention', query: 'src/ap', start: 8, end: 15 });
  assert.deepEqual(findTrigger('@', 1), { kind: 'mention', query: '', start: 0, end: 1 });
  assert.equal(findTrigger('mail me@example.com', 19), null);
  assert.equal(findTrigger('@file done', 10), null);
});

test('completion replaces the typed token and adds one space', () => {
  const text = 'open @src/ap please';
  const trigger = findTrigger(text, 12);
  assert.deepEqual(complete(text, trigger, '@src/app.ts'), { text: 'open @src/app.ts please', caret: 16 });
  const command = findTrigger('/co', 3);
  assert.deepEqual(complete('/co', command, '/compact'), { text: '/compact ', caret: 9 });
  const tab = findTrigger('fix @', 5);
  assert.deepEqual(complete('fix @', tab, ''), { text: 'fix ', caret: 4 });
});
