import assert from 'node:assert/strict';
import { test } from 'node:test';
import pageModule from '../../../dist/main/agent-bridge/page-text.js';

const { parsePageText } = pageModule;

test('parsePageText tidies blank lines and caps the page text', () => {
  assert.deepEqual(parsePageText({ text: '  Title\n\n\n\nBody  ', selection: ' part ' }), {
    text: 'Title\n\nBody',
    selection: 'part',
    truncated: false,
  });
  const long = parsePageText({ text: 'x'.repeat(50_001), selection: '' });
  assert.equal(long.text.length, 50_000);
  assert.equal(long.truncated, true);
});

test('parsePageText rejects anything that is not page text', () => {
  for (const value of [null, 'text', { text: 1, selection: '' }, { text: '' }])
    assert.equal(parsePageText(value), null);
});
