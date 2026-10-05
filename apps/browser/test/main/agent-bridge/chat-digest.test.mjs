import assert from 'node:assert/strict';
import { test } from 'node:test';
import digestModule from '../../../dist/main/agent-bridge/chat-digest.js';

const { chatDigest } = digestModule;
const labels = { user: 'User', assistant: 'Assistant', omitted: '(older left out)' };
const message = (role, ...parts) => ({ role, parts, reverted: false });
const text = (value) => ({ type: 'text', text: value });

test('keeps the spoken text of each turn and skips tools and reverted messages', () => {
  const digest = chatDigest(
    [
      message('user', text('Add a login page')),
      message('assistant', text('Added it.'), { type: 'tool', name: 'Edit' }, text('  Tests pass.  ')),
      { ...message('user', text('never mind')), reverted: true },
      message('assistant', { type: 'tool', name: 'Bash' }),
    ],
    labels,
  );
  assert.equal(digest, 'User: Add a login page\n\nAssistant: Added it.\nTests pass.');
});

test('long chats keep their newest messages and say that older ones were left out', () => {
  const messages = Array.from({ length: 40 }, (_, index) => message('user', text(`${index} ${'x'.repeat(500)}`)));
  const digest = chatDigest(messages, labels);
  assert.ok(digest.startsWith('(older left out)'));
  assert.match(digest, /User: 39 x/);
  assert.doesNotMatch(digest, /User: 0 x/);
  assert.ok(digest.length < 9000);
  const long = chatDigest([message('user', text('y'.repeat(5000)))], labels);
  assert.equal(long, `User: ${'y'.repeat(1200)}…`);
});
