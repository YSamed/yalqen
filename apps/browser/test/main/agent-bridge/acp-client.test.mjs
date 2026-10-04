import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import acpModule from '../../../dist/main/agent-bridge/acp-client.js';

const { AcpQuery } = acpModule;
const tick = () => new Promise((resolve) => setImmediate(resolve));
const agent = { label: 'Gemini CLI', command: 'gemini', args: async () => [] };

function prompts() {
  const items = [];
  let waiter;
  return {
    push(text) {
      const message = { type: 'user', message: { role: 'user', content: text } };
      if (waiter) {
        const next = waiter;
        waiter = null;
        next({ value: message, done: false });
      } else items.push(message);
    },
    [Symbol.asyncIterator]() {
      return {
        next: () =>
          items.length
            ? Promise.resolve({ value: items.shift(), done: false })
            : new Promise((resolve) => (waiter = resolve)),
      };
    },
  };
}

function fixture(t, { http = true, canUseTool } = {}) {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    signalCode: null,
    killed: [],
    kill(signal) {
      this.killed.push(signal);
      this.signalCode = signal;
    },
  });
  const calls = { initialize: [], newSession: [], prompt: [], cancel: [] };
  let client;
  let finishPrompt;
  const connection = {
    initialize: async (params) => {
      calls.initialize.push(params);
      return {
        protocolVersion: 1,
        agentCapabilities: { mcpCapabilities: { http }, promptCapabilities: { image: true } },
      };
    },
    newSession: async (params) => {
      calls.newSession.push(params);
      return { sessionId: 'acp-session' };
    },
    prompt: (params) => {
      calls.prompt.push(params);
      return new Promise((resolve) => (finishPrompt = resolve));
    },
    cancel: async (params) => {
      calls.cancel.push(params);
      finishPrompt?.({ stopReason: 'cancelled' });
    },
  };
  const input = prompts();
  const query = new AcpQuery(
    agent,
    child,
    {
      cwd: '/project',
      env: { YALQEN_MCP_URL: 'http://127.0.0.1:47823/mcp', YALQEN_MCP_TOKEN: 'secret' },
      canUseTool,
    },
    input,
    async (toClient) => {
      client = toClient();
      return connection;
    },
  );
  const output = [];
  void (async () => {
    for await (const message of query) output.push(message);
  })();
  t.after(() => query.close());
  return {
    query,
    input,
    output,
    calls,
    child,
    client: () => client,
    finish: (stopReason = 'end_turn') => finishPrompt({ stopReason }),
  };
}

test('starts an ACP session in the project with the Yalqen MCP server and reports it as init', async (t) => {
  const { calls, output } = fixture(t);
  await tick();
  await tick();
  assert.equal(calls.initialize[0].clientCapabilities.terminal, false);
  assert.deepEqual(calls.newSession[0], {
    cwd: '/project',
    mcpServers: [
      {
        type: 'http',
        name: 'yalqen',
        url: 'http://127.0.0.1:47823/mcp',
        headers: [{ name: 'Authorization', value: 'Bearer secret' }],
      },
    ],
  });
  assert.deepEqual(output[0], {
    type: 'system',
    subtype: 'init',
    session_id: 'acp-session',
    model: 'Gemini CLI',
    permissionMode: 'default',
  });
});

test('skips the MCP server when the agent cannot use HTTP servers', async (t) => {
  const { calls } = fixture(t, { http: false });
  await tick();
  await tick();
  assert.deepEqual(calls.newSession[0].mcpServers, []);
});

test('turns streamed text, edits and tool results into chat messages', async (t) => {
  const { input, output, calls, client, finish } = fixture(t);
  input.push('Rename the button');
  await tick();
  await tick();
  assert.deepEqual(calls.prompt[0].prompt, [{ type: 'text', text: 'Rename the button' }]);
  const update = (value) => client().sessionUpdate({ sessionId: 'acp-session', update: value });
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Edit' } });
  update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ing.' } });
  update({
    sessionUpdate: 'tool_call',
    toolCallId: 'call-1',
    title: 'Edit Button.tsx',
    kind: 'edit',
    status: 'pending',
  });
  update({
    sessionUpdate: 'tool_call_update',
    toolCallId: 'call-1',
    status: 'completed',
    content: [{ type: 'diff', path: '/project/Button.tsx', oldText: 'Save', newText: 'Store' }],
  });
  update({
    sessionUpdate: 'available_commands_update',
    availableCommands: [{ name: 'memory', description: 'Memory' }],
  });
  finish();
  await tick();
  const texts = output.filter((message) => message.type === 'assistant').map((message) => message.message.content[0]);
  assert.deepEqual(texts[1], { type: 'text', text: 'Editing.' });
  assert.deepEqual(texts.at(-1), {
    type: 'tool_use',
    id: 'call-1',
    name: 'Edit',
    input: { file_path: '/project/Button.tsx', old_string: 'Save', new_string: 'Store' },
  });
  const toolResult = output.find((message) => message.type === 'user').message.content[0];
  assert.equal(toolResult.tool_use_id, 'call-1');
  assert.equal(toolResult.is_error, false);
  assert.deepEqual(output.at(-1), {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: '',
    total_cost_usd: 0,
  });
});

test('asks Yalqen for permission and picks the matching agent option', async (t) => {
  const decisions = [
    { behavior: 'allow', updatedInput: {}, updatedPermissions: [{ type: 'addRules' }] },
    { behavior: 'allow', updatedInput: {} },
    { behavior: 'deny', message: 'no' },
  ];
  const asked = [];
  const { input, client } = fixture(t, {
    canUseTool: async (name, toolInput, options) => {
      asked.push({ name, toolInput, suggestions: options.suggestions.length });
      return decisions.shift();
    },
  });
  input.push('Run tests');
  await tick();
  await tick();
  const request = {
    sessionId: 'acp-session',
    toolCall: { toolCallId: 'call-2', title: 'npm test', rawInput: { command: 'npm test' } },
    options: [
      { optionId: 'once', name: 'Allow', kind: 'allow_once' },
      { optionId: 'always', name: 'Always', kind: 'allow_always' },
      { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
    ],
  };
  assert.deepEqual(await client().requestPermission(request), { outcome: { outcome: 'selected', optionId: 'always' } });
  assert.deepEqual(await client().requestPermission(request), { outcome: { outcome: 'selected', optionId: 'once' } });
  assert.deepEqual(await client().requestPermission(request), { outcome: { outcome: 'selected', optionId: 'reject' } });
  assert.deepEqual(asked[0], { name: 'npm test', toolInput: { command: 'npm test' }, suggestions: 1 });
});

test('interrupting cancels the turn and closing stops the agent process', async (t) => {
  const { query, input, output, calls, child } = fixture(t);
  input.push('Long task');
  await tick();
  await tick();
  await query.interrupt();
  await tick();
  assert.deepEqual(calls.cancel, [{ sessionId: 'acp-session' }]);
  assert.equal(output.at(-1).type, 'result');
  assert.deepEqual(await query.supportedModels(), []);
  assert.equal((await query.rewindFiles()).canRewind, false);
  query.close();
  assert.deepEqual(child.killed, ['SIGTERM']);
});
