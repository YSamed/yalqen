import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import chatModule from '../../../dist/main/agent-bridge/agent-chat.js';

const { AgentChat } = chatModule;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const result = (extra = {}) => ({ type: 'result', subtype: 'success', is_error: false, result: '', ...extra });
const assistant = (id, content) => ({ type: 'assistant', parent_tool_use_id: null, message: { id, content } });
const stream = (event) => ({ type: 'stream_event', parent_tool_use_id: null, event });

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-chat-'));
  const calls = { queries: [], updates: [], states: [], connect: 0 };
  let chat;
  const query = (params) => {
    const messages = [];
    let waiter;
    let ended = false;
    const client = {
      params,
      closed: 0,
      interrupted: 0,
      input: params.prompt[Symbol.asyncIterator](),
      emit(message) {
        if (waiter) {
          const next = waiter;
          waiter = null;
          next({ value: message, done: false });
        } else messages.push(message);
      },
      interrupt: async () => {
        client.interrupted++;
        client.emit(result());
      },
      close() {
        client.closed++;
        ended = true;
        waiter?.({ done: true });
        waiter = null;
      },
      [Symbol.asyncIterator]() {
        return {
          next: () =>
            messages.length
              ? Promise.resolve({ value: messages.shift(), done: false })
              : ended
                ? Promise.resolve({ done: true })
                : new Promise((resolve) => {
                    waiter = resolve;
                  }),
        };
      },
    };
    calls.queries.push(client);
    return client;
  };
  chat = new AgentChat({
    connect: async () => {
      calls.connect++;
      return { url: 'http://127.0.0.1:47823/mcp', token: 'chat-secret' };
    },
    onState: () => calls.states.push(chat.state()),
    onUpdate: (snapshot) => calls.updates.push(snapshot),
    loadClient: async () => ({
      query,
      executable: '/test/claude',
      env: { PATH: '/test/bin', ELECTRON_RUN_AS_NODE: '1', CLAUDECODE: '1' },
    }),
    ...overrides,
  });
  chat.selectDirectory(directory);
  t.after(() => {
    chat.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { chat, calls, directory };
}

test('starts a persistent Claude conversation lazily with the installed CLI and manual permission requests', async (t) => {
  const { chat, calls, directory } = fixture(t);
  assert.equal(calls.queries.length, 0);
  const context = { id: 'tab-1', title: 'Local page', url: 'http://localhost:3000/' };
  assert.equal(await chat.send(null, 'Explain the project', context), true);
  const client = calls.queries[0];
  const { options } = client.params;
  assert.equal(options.pathToClaudeCodeExecutable, '/test/claude');
  assert.equal(options.cwd, directory);
  assert.equal(options.permissionMode, 'default');
  assert.equal(options.includePartialMessages, true);
  assert.deepEqual(options.settingSources, ['user', 'project', 'local']);
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(options.env.CLAUDECODE, undefined);
  assert.equal(options.env.YALQEN_MCP_TOKEN, 'chat-secret');
  assert.equal(options.mcpServers.yalqen.headers.Authorization, 'Bearer ${YALQEN_MCP_TOKEN}');
  assert.doesNotMatch(JSON.stringify(chat.snapshot()), /chat-secret/);
  const input = await client.input.next();
  assert.match(input.value.message.content, /Explain the project/);
  assert.match(input.value.message.content, /"tab_id":"tab-1"/);
  assert.deepEqual(chat.snapshot().messages[0].context, context);
  assert.equal(await chat.send(chat.state().id, 'Concurrent message'), false);
  client.emit({ type: 'system', subtype: 'init', session_id: 'cli-id', model: 'test-model' });
  client.emit(result({ result: 'Project explained.' }));
  await tick();
  assert.equal(chat.state().status, 'ready');
  assert.equal(chat.state().model, 'test-model');
  assert.equal(await chat.send(chat.state().id, 'Follow up'), true);
  assert.equal(calls.queries.length, 1);
  assert.equal((await client.input.next()).value.session_id, 'cli-id');
});

test('tells Claude which elements the user selected and keeps them on the message', async (t) => {
  const { chat, calls } = fixture(t);
  const elements = [
    {
      id: 'yk_a1b2c3',
      tabId: 'tab-1',
      url: 'http://localhost:3000/',
      label: 'button.btn "Save"',
      component: 'SaveButton',
      source: 'src/SaveButton.tsx:12',
    },
  ];
  assert.equal(await chat.send(null, 'Make this larger', null, elements), true);
  const { content } = (await calls.queries[0].input.next()).value.message;
  assert.match(content, /Make this larger/);
  assert.match(content, /"selection_id":"yk_a1b2c3"/);
  assert.match(content, /"component":"SaveButton"/);
  assert.match(content, /get_selected_element/);
  assert.deepEqual(chat.snapshot().messages[0].elements, elements);
  assert.doesNotMatch(content, /"tabId"/);
});

test('a message without selections adds no element context', async (t) => {
  const { chat, calls } = fixture(t);
  await chat.send(null, 'Hello');
  assert.doesNotMatch((await calls.queries[0].input.next()).value.message.content, /selected elements/);
  assert.deepEqual(chat.snapshot().messages[0].elements, []);
});

test('streams text once and updates tool cards with their actual results', async (t) => {
  const { chat, calls } = fixture(t);
  await chat.send(null, 'Read the file');
  const client = calls.queries[0];
  client.emit(stream({ type: 'message_start', message: { id: 'reply' } }));
  client.emit(stream({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
  client.emit(stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reading' } }));
  client.emit(assistant('reply', [{ type: 'text', text: 'Reading the file.' }]));
  client.emit(
    stream({
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'read-1', name: 'Read', input: {} },
    }),
  );
  client.emit(
    stream({
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"file_path":"README.md"}' },
    }),
  );
  client.emit(
    assistant('reply', [{ type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'README.md' } }]),
  );
  client.emit({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'File contents', is_error: false }] },
  });
  client.emit({
    ...assistant('child-reply', [{ type: 'text', text: 'Should not appear' }]),
    parent_tool_use_id: 'parent-tool',
  });
  client.emit(result());
  await tick();
  const reply = chat.snapshot().messages.find((message) => message.id === 'reply');
  assert.equal(reply.parts.filter((part) => part.type === 'text').length, 1);
  assert.equal(reply.parts[0].text, 'Reading the file.');
  assert.equal(reply.parts.filter((part) => part.type === 'tool').length, 1);
  assert.equal(reply.parts[1].status, 'done');
  assert.equal(reply.parts[1].output, 'File contents');
  assert.match(reply.parts[1].input, /README.md/);
  assert.equal(
    chat.snapshot().messages.some((message) => message.id === 'child-reply'),
    false,
  );
});

test('keeps consecutive streamed text blocks distinct when they share a prefix', async (t) => {
  const { chat, calls } = fixture(t);
  await chat.send(null, 'Explain');
  const client = calls.queries[0];
  client.emit(stream({ type: 'message_start', message: { id: 'shared-prefix' } }));
  for (const [index, text] of ['Hello', 'Hello again'].entries()) {
    client.emit(stream({ type: 'content_block_start', index, content_block: { type: 'text', text: '' } }));
    client.emit(stream({ type: 'content_block_delta', index, delta: { type: 'text_delta', text } }));
    client.emit(assistant('shared-prefix', [{ type: 'text', text }]));
  }
  client.emit(result());
  await tick();
  assert.deepEqual(
    chat
      .snapshot()
      .messages.find((message) => message.id === 'shared-prefix')
      .parts.map((part) => part.text),
    ['Hello', 'Hello again'],
  );
});

test('holds tool approval for the current request and allows it once without changing its input', async (t) => {
  const { chat, calls } = fixture(t);
  await chat.send(null, 'Edit the file');
  const controller = new AbortController();
  const input = { file_path: 'app.ts', content: 'new code' };
  const pending = calls.queries[0].params.options.canUseTool('Write', input, {
    signal: controller.signal,
    title: 'Write app.ts',
  });
  assert.equal(chat.state().status, 'approval');
  const request = chat.snapshot().permissions[0];
  chat.respond('old-session', request.id, true, {});
  chat.respond(chat.state().id, 'old-request', true, {});
  chat.respond(chat.state().id, request.id, 'true', {});
  assert.equal(chat.snapshot().permissions.length, 1);
  chat.respond(chat.state().id, request.id, true, { content: 'renderer cannot replace tool input' });
  assert.deepEqual(await pending, { behavior: 'allow', updatedInput: input });
  assert.equal(chat.snapshot().permissions.length, 0);
  assert.equal(chat.state().status, 'thinking');
});

test('collects answers to Claude questions and rejects incomplete answers', async (t) => {
  const { chat, calls } = fixture(t);
  await chat.send(null, 'Choose a database');
  const input = {
    questions: [
      {
        question: 'Which database?',
        options: [
          { label: 'SQLite', description: 'Local' },
          { label: 'Postgres', description: 'Shared' },
        ],
        multiSelect: false,
      },
    ],
  };
  const pending = calls.queries[0].params.options.canUseTool('AskUserQuestion', input, {
    signal: new AbortController().signal,
  });
  const request = chat.snapshot().permissions[0];
  chat.respond(chat.state().id, request.id, true, {});
  assert.equal(chat.snapshot().permissions.length, 1);
  chat.respond(chat.state().id, request.id, true, { 'Which database?': 'SQLite', injected: 'ignored' });
  assert.deepEqual(await pending, {
    behavior: 'allow',
    updatedInput: { ...input, answers: { 'Which database?': 'SQLite' } },
  });
});

test('interrupts a turn, cancels approvals and keeps the conversation usable', async (t) => {
  const { chat, calls } = fixture(t);
  await chat.send(null, 'Write code');
  const client = calls.queries[0];
  const pending = client.params.options.canUseTool(
    'Bash',
    { command: 'npm test' },
    { signal: new AbortController().signal },
  );
  await chat.interrupt('old-session');
  assert.equal(client.interrupted, 0);
  await chat.interrupt(chat.state().id);
  assert.equal((await pending).behavior, 'deny');
  await tick();
  assert.equal(client.interrupted, 1);
  assert.equal(client.closed, 0);
  assert.equal(chat.state().status, 'ready');
  assert.equal(await chat.send(chat.state().id, 'Try a different approach'), true);
});

test('aborted approval callbacks and callbacks from a closed conversation cannot affect a new conversation', async (t) => {
  const { chat, calls } = fixture(t);
  await chat.send(null, 'First');
  const old = calls.queries[0];
  const controller = new AbortController();
  const pending = old.params.options.canUseTool('Write', {}, { signal: controller.signal });
  controller.abort();
  assert.equal((await pending).behavior, 'deny');
  chat.reset(chat.state().id);
  assert.equal(old.closed, 1);
  assert.equal(chat.snapshot().messages.length, 0);
  await chat.send(null, 'Second');
  const late = await old.params.options.canUseTool('Bash', {}, { signal: new AbortController().signal });
  assert.equal(late.behavior, 'deny');
  assert.equal(chat.snapshot().permissions.length, 0);
  old.emit(assistant('late', [{ type: 'text', text: 'Old output' }]));
  await tick();
  assert.equal(chat.snapshot().messages.length, 1);
});

test('resetting or disposing during startup prevents a late CLI from launching', async (t) => {
  let release;
  const { chat, calls } = fixture(t, {
    loadClient: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = chat.send(null, 'First');
  while (!release) await tick();
  chat.reset(chat.state().id);
  release({
    query: () => {
      throw new Error('Must not launch');
    },
    executable: '/test/claude',
  });
  assert.equal(await pending, false);
  assert.equal(calls.connect, 0);
  assert.equal(chat.state().status, 'idle');
  assert.equal(chat.state().id, null);
});

test('reports missing CLI and invalid project errors without leaking environment details', async (t) => {
  const { chat, calls } = fixture(t, {
    loadClient: async () => {
      throw Object.assign(new Error('sensitive details'), { code: 127 });
    },
  });
  assert.equal(await chat.send(null, 'Hello'), false);
  assert.equal(chat.state().error, 'claude-not-found');
  assert.doesNotMatch(JSON.stringify(chat.snapshot()), /sensitive details/);
  assert.equal(calls.connect, 0);
  chat.selectDirectory('/does/not/exist');
  assert.equal(await chat.send(null, 'Hello'), false);
  assert.equal(chat.state().error, 'invalid-directory');
});

test('validates user input and bounds the conversation replay', async (t) => {
  const { chat, calls } = fixture(t);
  for (const input of ['', '   ', {}, 'x'.repeat(65537)]) assert.equal(await chat.send(null, input), false);
  assert.equal(calls.queries.length, 0);
  await chat.send(null, 'Hello');
  const client = calls.queries[0];
  for (let index = 0; index < 140; index++)
    client.emit(assistant('message-' + index, [{ type: 'text', text: 'x'.repeat(100000) }]));
  client.emit(result());
  await tick();
  const snapshot = chat.snapshot();
  assert.ok(snapshot.messages.length <= 120);
  assert.ok(JSON.stringify(snapshot.messages).length < 1024 * 1024 + 1024);
  assert.ok(snapshot.messages.every((message) => message.parts[0].text.length <= 65536));
  const count = calls.updates.length;
  chat.dispose();
  assert.equal(client.closed, 1);
  client.emit(result());
  await tick();
  assert.equal(calls.updates.length, count);
});
