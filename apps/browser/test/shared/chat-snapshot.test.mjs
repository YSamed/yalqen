import assert from 'node:assert/strict';
import { test } from 'node:test';
import chat from '../../dist/shared/chat-snapshot.js';

const { reuseChatSnapshot } = chat;
const message = (id, role, parts) => ({
  id,
  role,
  parts,
  context: null,
  elements: [],
  episode: null,
  images: [],
  reverted: false,
  workMode: 'normal',
});
const tool = (id, output) => ({
  type: 'tool',
  id,
  name: 'Read',
  input: '{"file_path":"/src/a.ts"}',
  output,
  status: 'done',
  verification: null,
  task: null,
  steps: [],
});
const snapshot = (revision, reply) => ({
  state: { id: 'chat', directory: '/work', status: 'thinking', model: null, error: null },
  revision,
  messages: [
    message('u1', 'user', [{ type: 'text', text: 'Fix the header' }]),
    message('a1', 'assistant', [{ type: 'text', text: 'Reading the file.' }, tool('t1', 'export const a = 1;')]),
    message('a2', 'assistant', [tool('t2', 'ok'), { type: 'text', text: reply }]),
  ],
  queue: [],
  permissions: [],
});
const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

test('a streamed reply replaces only its own message and text part', () => {
  const previous = freeze(snapshot(1, 'The header'));
  const next = freeze(snapshot(2, 'The header is fixed.'));
  const result = reuseChatSnapshot(previous, next);
  assert.deepEqual(result, next);
  assert.equal(result.messages[0], previous.messages[0]);
  assert.equal(result.messages[1], previous.messages[1]);
  assert.notEqual(result.messages[2], previous.messages[2]);
  assert.equal(result.messages[2].parts[0], previous.messages[2].parts[0]);
  assert.notEqual(result.messages[2].parts[1], previous.messages[2].parts[1]);
  assert.equal(result.queue, previous.queue);
  assert.equal(result.permissions, previous.permissions);
});

test('messages keep their identity when older ones are trimmed or new ones arrive', () => {
  const previous = freeze(snapshot(1, 'Done'));
  const next = snapshot(2, 'Done');
  next.messages.shift();
  next.messages.push(message('u2', 'user', [{ type: 'text', text: 'Thanks' }]));
  const result = reuseChatSnapshot(previous, freeze(next));
  assert.deepEqual(result, next);
  assert.equal(result.messages[0], previous.messages[1]);
  assert.equal(result.messages[1], previous.messages[2]);
});

test('changed tool results, added parts and type changes reach the chat', () => {
  const previous = freeze(snapshot(1, 'Done'));
  const next = snapshot(2, 'Done');
  next.messages[1].parts[1].output = 'export const a = 2;';
  next.messages[1].parts.push({ type: 'text', text: 'Updated.' });
  next.messages[2].parts[0] = { type: 'text', text: 'ok' };
  next.permissions = [{ id: 'p1', tool: 'Bash', input: 'npm test', questions: [], plan: null }];
  const result = reuseChatSnapshot(previous, freeze(next));
  assert.deepEqual(result, next);
  assert.equal(result.messages[1].parts[0], previous.messages[1].parts[0]);
  assert.notEqual(result.messages[1].parts[1], previous.messages[1].parts[1]);
  assert.notEqual(result.messages[2].parts[0], previous.messages[2].parts[0]);
  assert.equal(result.messages[2].parts[1], previous.messages[2].parts[1]);
});
