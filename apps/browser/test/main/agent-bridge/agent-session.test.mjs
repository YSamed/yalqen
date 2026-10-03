import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import sessionModule from '../../../dist/main/agent-bridge/agent-session.js';

const { AgentSession } = sessionModule;
const size = { cols: 72, rows: 30 };

function fixture(t, overrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-agent-session-'));
  const calls = { spawn: [], input: [], resize: [], terminate: [], states: [], output: [], connect: 0 };
  const terminals = [];
  let session;
  const host = {
    spawn: (...args) => {
      calls.spawn.push(args);
      const listeners = { data: new Set(), exit: new Set() };
      const subscribe = (kind, listener) => {
        listeners[kind].add(listener);
        return { dispose: () => listeners[kind].delete(listener) };
      };
      const terminal = {
        onData: (listener) => subscribe('data', listener),
        onExit: (listener) => subscribe('exit', listener),
        write: (data) => calls.input.push(data),
        resize: (...dimensions) => calls.resize.push(dimensions),
        data: (data) => listeners.data.forEach((listener) => listener(data)),
        exit: (exitCode) => listeners.exit.forEach((listener) => listener({ exitCode })),
        listeners,
      };
      terminals.push(terminal);
      return terminal;
    },
    terminate: (terminal) => calls.terminate.push(terminal),
  };
  session = new AgentSession({
    connect: async () => {
      calls.connect++;
      return { url: 'http://127.0.0.1:47823/mcp', token: 'test-secret' };
    },
    onState: () => calls.states.push(session.state()),
    onOutput: (output) => calls.output.push(output),
    loadPty: async () => host,
    shell: '/bin/zsh',
    env: { PATH: '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '1', CLAUDECODE: '1' },
    ...overrides,
  });
  session.selectDirectory(directory);
  t.after(() => {
    session.dispose();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { session, calls, host, terminals, directory };
}

test('launches one interactive Claude session in the chosen project with session-only MCP configuration', async (t) => {
  const { session, calls, directory } = fixture(t);
  const state = await session.start(size);
  assert.equal(state.status, 'running');
  assert.equal(state.directory, directory);
  assert.ok(state.id);
  await session.start(size);
  assert.equal(calls.spawn.length, 1);
  const [shell, args, options] = calls.spawn[0];
  assert.equal(shell, '/bin/zsh');
  assert.equal(args[0], '-ilc');
  assert.match(args[1], /exec claude --mcp-config "\$YALQEN_MCP_CONFIG"/);
  assert.doesNotMatch(args.join(' '), /test-secret|skip-permissions/);
  assert.equal(options.cwd, directory);
  assert.match(args[1], /cd -- "\$YALQEN_AGENT_DIRECTORY"/);
  assert.equal(options.env.YALQEN_AGENT_DIRECTORY, directory);
  assert.equal(options.cols, size.cols);
  assert.equal(options.rows, size.rows);
  assert.equal(options.name, 'xterm-256color');
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(options.env.CLAUDECODE, undefined);
  assert.equal(options.env.YALQEN_MCP_TOKEN, 'test-secret');
  assert.deepEqual(JSON.parse(options.env.YALQEN_MCP_CONFIG).mcpServers.yalqen, {
    type: 'http',
    url: '${YALQEN_MCP_URL}',
    headers: { Authorization: 'Bearer ${YALQEN_MCP_TOKEN}' },
  });
  assert.ok(calls.states.some((entry) => entry.status === 'starting'));
  assert.doesNotMatch(JSON.stringify(session.snapshot()), /test-secret/);
});

test('streams output and replays it once with sequence numbers after reconnecting', async (t) => {
  const { session, calls, terminals } = fixture(t);
  await session.start(size);
  terminals[0].data('hello\r\n');
  terminals[0].data('\x1b[32mClaude\x1b[0m');
  const snapshot = session.snapshot();
  assert.equal(snapshot.data, 'hello\r\n\x1b[32mClaude\x1b[0m');
  assert.equal(snapshot.sequence, 1);
  assert.deepEqual(calls.output, [{ sessionId: snapshot.state.id, sequence: 1, data: snapshot.data }]);
  assert.equal(session.snapshot().sequence, 1);
  terminals[0].data('next');
  terminals[0].exit(0);
  assert.equal(session.state().status, 'exited');
  assert.equal(calls.output[1].sequence, 2);
  assert.equal(session.snapshot().data, snapshot.data + 'next');
});

test('keeps replay memory bounded during a long-running terminal session', async (t) => {
  const { session, terminals } = fixture(t);
  await session.start(size);
  for (let index = 0; index < 20; index++) {
    terminals[0].data('x'.repeat(100000));
    session.snapshot();
  }
  terminals[0].data('tail');
  assert.ok(session.snapshot().data.length <= 1024 * 1024);
  assert.ok(session.snapshot().data.endsWith('tail'));
});

test('validates input and terminal dimensions and ignores messages from a previous session', async (t) => {
  const { session, calls } = fixture(t);
  const { id } = await session.start(size);
  session.write(id, 'hello\r');
  session.write(id, {});
  session.write(id, 'x'.repeat(65537));
  session.write('old', 'bad');
  session.resize(id, { cols: 90, rows: 40 });
  for (const invalid of [null, {}, { cols: NaN, rows: 20 }, { cols: 0, rows: 20 }, { cols: 20, rows: 501 }]) {
    session.resize(id, invalid);
  }
  session.resize('old', { cols: 99, rows: 40 });
  assert.deepEqual(calls.input, ['hello\r']);
  assert.deepEqual(calls.resize, [[90, 40]]);
  session.stop(id);
  const next = await session.start(size);
  assert.notEqual(next.id, id);
  session.stop(id);
  assert.equal(session.state().status, 'running');
});

test('disposal ends the session and detaches output listeners', async (t) => {
  const { session, calls, terminals } = fixture(t);
  await session.start(size);
  const oldListener = [...terminals[0].listeners.data][0];
  session.dispose();
  assert.equal(calls.terminate.length, 1);
  assert.equal(terminals[0].listeners.data.size, 0);
  oldListener('late output');
  assert.equal(calls.output.length, 0);
  await session.start(size);
  assert.equal(calls.spawn.length, 1);
});

test('stopping during asynchronous startup prevents a terminal from spawning later', async (t) => {
  let release;
  const { session, calls } = fixture(t, {
    connect: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const pending = session.start(size);
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  session.stop(session.state().id);
  release({ url: 'http://127.0.0.1:47823/mcp', token: 'test-secret' });
  await pending;
  assert.equal(calls.spawn.length, 0);
  assert.equal(session.state().status, 'exited');
});

test('reports missing Claude and permits retry without replacing global Claude configuration', async (t) => {
  const { session, terminals, calls } = fixture(t);
  await session.start(size);
  terminals[0].exit(127);
  assert.equal(session.state().error, 'claude-not-found');
  assert.equal(session.state().status, 'error');
  await session.start(size);
  assert.equal(calls.spawn.length, 2);
  assert.equal(session.state().error, null);
});

test('validates the directory before enabling the browser connection', async (t) => {
  const { session, directory, calls } = fixture(t);
  fs.rmSync(directory, { recursive: true });
  await session.start(size);
  assert.equal(session.state().error, 'invalid-directory');
  assert.equal(calls.connect, 0);
  assert.equal(calls.spawn.length, 0);
});

test('native terminal and browser connection failures leave the session retryable', async (t) => {
  for (const [overrides, reason] of [
    [
      {
        loadPty: async () => {
          throw new Error('binary');
        },
      },
      'terminal-unavailable',
    ],
    [
      {
        connect: async () => {
          throw new Error('secret');
        },
      },
      'connection-failed',
    ],
  ]) {
    const { session, calls } = fixture(t, overrides);
    await session.start(size);
    assert.equal(session.state().error, reason);
    assert.equal(calls.spawn.length, 0);
    assert.doesNotMatch(JSON.stringify(session.state()), /secret/);
  }
});

test('a different project clears the previous terminal replay; active projects cannot be replaced', async (t) => {
  const { session, terminals, directory } = fixture(t);
  const { id } = await session.start(size);
  session.selectDirectory('/different');
  assert.equal(session.state().directory, directory);
  terminals[0].data('old project');
  session.stop(id);
  session.selectDirectory('/different');
  assert.equal(session.state().id, null);
  assert.equal(session.snapshot().data, '');
});
