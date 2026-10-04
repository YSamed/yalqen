import assert from 'node:assert/strict';
import { test } from 'node:test';
import historyModule from '../../../dist/main/agent-bridge/chat-history.js';

const { historyMessages, sessionOf } = historyModule;
const user = (uuid, content, extra = {}) => ({
  type: 'user',
  uuid,
  message: { role: 'user', content },
  parent_tool_use_id: null,
  ...extra,
});
const assistant = (uuid, id, content, extra = {}) => ({
  type: 'assistant',
  uuid,
  message: { id, role: 'assistant', content },
  parent_tool_use_id: null,
  ...extra,
});

test('rebuilds a stored conversation with tool results and without Yalqen context', () => {
  const messages = historyMessages(
    [
      user('u1', 'Fix the button\n\nYalqen browser context:\n{"tab_id":"t"}'),
      assistant('a1', 'msg-1', [{ type: 'text', text: 'Looking.' }]),
      assistant('a2', 'msg-1', [{ type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'a.ts' } }]),
      user('u2', [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file text' }]),
      assistant('a3', 'msg-2', [{ type: 'text', text: 'Done.' }]),
      assistant('child', 'msg-3', [{ type: 'text', text: 'Subagent' }], { parent_tool_use_id: 'task' }),
      user('u3', [{ type: 'text', text: '[The user reverted the files you changed since x.]\n\nAgain' }]),
      { type: 'system', uuid: 's', message: {}, parent_tool_use_id: null },
    ],
    120,
  );
  assert.deepEqual(
    messages.map((message) => [message.role, message.parts.map((part) => part.text ?? part.name)]),
    [
      ['user', ['Fix the button']],
      ['assistant', ['Looking.', 'Read']],
      ['assistant', ['Done.']],
      ['user', ['Again']],
    ],
  );
  const tool = messages[1].parts[1];
  assert.equal(tool.status, 'done');
  assert.equal(tool.output, 'file text');
  assert.match(tool.input, /a\.ts/);
  assert.equal(messages[0].reverted, false);
});

test('keeps only the newest messages', () => {
  const stored = Array.from({ length: 10 }, (_, index) => user(`u${index}`, `Message ${index}`));
  assert.deepEqual(
    historyMessages(stored, 3).map((message) => message.parts[0].text),
    ['Message 7', 'Message 8', 'Message 9'],
  );
});

test('names a session by its custom title, summary or first prompt', () => {
  assert.deepEqual(
    sessionOf({ sessionId: 's1', summary: 'Login fix', lastModified: 5, customTitle: 'Auth', gitBranch: 'main' }),
    { id: 's1', title: 'Auth', updatedAt: 5, branch: 'main' },
  );
  assert.equal(sessionOf({ sessionId: 's2', summary: '', lastModified: 1, firstPrompt: 'Hello' }).title, 'Hello');
  assert.equal(sessionOf({ sessionId: 's3', summary: 'x'.repeat(300), lastModified: 1 }).title.length, 200);
});
