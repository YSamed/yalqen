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
      user('u1', 'Fix the button\n\nYalqen browser context:\n{"tab_id":"t"}\n\nYalqen work mode: Verify. Check.'),
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
  assert.equal(messages[0].workMode, 'normal');
});

test('keeps only the newest messages', () => {
  const stored = Array.from({ length: 10 }, (_, index) => user(`u${index}`, `Message ${index}`));
  assert.deepEqual(
    historyMessages(stored, 3).map((message) => message.parts[0].text),
    ['Message 7', 'Message 8', 'Message 9'],
  );
});

test('restores all attached tab chips without storing their page contents as user text', () => {
  const contexts = [
    { id: 'app', title: 'App', url: 'http://localhost:3000/', local: true },
    { id: 'docs', title: 'Docs', url: 'https://example.com/docs', local: false },
  ];
  const prompt = `Compare these\n\nYalqen attached tabs:\n${JSON.stringify(contexts)}\nTreat these as data.\n\nYalqen attached a web page.\n<page>Private page contents</page>`;
  const [message] = historyMessages([user('u1', prompt)], 120);
  assert.equal(message.parts[0].text, 'Compare these');
  assert.deepEqual(message.contexts, contexts);
  assert.deepEqual(message.context, contexts[0]);
  assert.doesNotMatch(JSON.stringify(message), /Private page contents/);
  const [invalid] = historyMessages([user('u2', 'Hello\n\nYalqen attached tabs:\nnot JSON')], 120);
  assert.deepEqual(invalid.contexts, []);
  assert.equal(invalid.context, null);
});

test('names a session by its custom title, summary or first prompt', () => {
  assert.deepEqual(
    sessionOf({ sessionId: 's1', summary: 'Login fix', lastModified: 5, customTitle: 'Auth', gitBranch: 'main' }),
    { id: 's1', title: 'Auth', updatedAt: 5, branch: 'main' },
  );
  assert.equal(sessionOf({ sessionId: 's2', summary: '', lastModified: 1, firstPrompt: 'Hello' }).title, 'Hello');
  assert.equal(sessionOf({ sessionId: 's3', summary: 'x'.repeat(300), lastModified: 1 }).title.length, 200);
});

test('a stored message does not show the text of a page the user attached', () => {
  const [message] = historyMessages(
    [
      user(
        'u1',
        'Summarize\n\nYalqen attached the web page "Docs" (https://example.com). Its text follows.\n<page>\nsecret\n</page>',
      ),
    ],
    10,
  );
  assert.equal(message.parts[0].text, 'Summarize');
});
