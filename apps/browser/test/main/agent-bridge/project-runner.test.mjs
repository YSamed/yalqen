import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import runnerModule from '../../../dist/main/agent-bridge/project-runner.js';

const { ProjectRunner, detectProjectCommand, findLocalUrl } = runnerModule;

function project(t, files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yalqen-runner-'));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), content);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const manifest = (scripts, extra = {}) => JSON.stringify({ scripts, ...extra });

function fixture(t, files = { 'package.json': manifest({ dev: 'vite' }) }) {
  const directory = project(t, files);
  const calls = { spawn: [], urls: [], states: [], kill: [] };
  const children = [];
  let runner;
  runner = new ProjectRunner({
    onState: () => calls.states.push(runner.state()),
    onUrl: (url) => calls.urls.push(url),
    spawn: (...args) => {
      calls.spawn.push(args);
      const child = Object.assign(new EventEmitter(), {
        stdout: new EventEmitter(),
        stderr: new EventEmitter(),
        pid: undefined,
        kill: (signal) => {
          calls.kill.push(signal);
          child.emit('exit', null);
        },
      });
      children.push(child);
      return child;
    },
    shell: '/bin/zsh',
    env: { PATH: '/usr/bin:/bin', ELECTRON_RUN_AS_NODE: '1', CLAUDECODE: '1' },
  });
  t.after(() => runner.dispose());
  return { runner, calls, children, directory };
}

test('picks the dev script and the package manager from the project', async (t) => {
  assert.deepEqual(await detectProjectCommand(project(t, { 'package.json': manifest({ dev: 'a', start: 'b' }) })), {
    manager: 'npm',
    script: 'dev',
  });
  assert.deepEqual(
    await detectProjectCommand(project(t, { 'package.json': manifest({ start: 'a' }), 'pnpm-lock.yaml': '' })),
    { manager: 'pnpm', script: 'start' },
  );
  assert.deepEqual(
    await detectProjectCommand(
      project(t, { 'package.json': manifest({ dev: 'a' }, { packageManager: 'bun@1.2.0' }), 'yarn.lock': '' }),
    ),
    { manager: 'bun', script: 'dev' },
  );
  assert.equal(await detectProjectCommand(project(t, { 'package.json': manifest({ build: 'a' }) })), null);
  assert.equal(await detectProjectCommand(project(t, { 'package.json': '{' })), null);
  assert.equal(await detectProjectCommand(project(t, {})), null);
});

test('ignores unknown package managers so only a fixed set of executables can run', async (t) => {
  const directory = project(t, {
    'package.json': manifest({ dev: 'a' }, { packageManager: '../../bin/evil@1' }),
  });
  assert.equal((await detectProjectCommand(directory)).manager, 'npm');
});

test('finds local dev server addresses in colored output', () => {
  assert.equal(findLocalUrl('  \u001b[32m➜\u001b[39m  Local:   http://localhost:5173/'), 'http://localhost:5173/');
  assert.equal(findLocalUrl('listening on http://0.0.0.0:3000'), 'http://localhost:3000/');
  assert.equal(findLocalUrl('ready at http://127.0.0.1:8080/app'), 'http://127.0.0.1:8080/');
  assert.equal(findLocalUrl('see https://example.com:443'), null);
  assert.equal(findLocalUrl('no address yet'), null);
});

test('offers a command for the chosen project and nothing for a project without one', async (t) => {
  const { runner, directory } = fixture(t);
  assert.equal(runner.start(), false);
  await runner.selectDirectory(directory);
  assert.deepEqual(runner.state(), {
    directory,
    command: 'npm run dev',
    status: 'idle',
    url: null,
    exitCode: null,
  });

  const empty = fixture(t, { 'package.json': manifest({ build: 'x' }) });
  await empty.runner.selectDirectory(empty.directory);
  assert.equal(empty.runner.state().command, null);
  assert.equal(empty.runner.start(), false);
});

test('starts the script through the login shell with the script name outside the command text', async (t) => {
  const { runner, calls, directory } = fixture(t);
  await runner.selectDirectory(directory);
  assert.equal(runner.start(), true);
  const [shell, args, options] = calls.spawn[0];
  assert.equal(shell, '/bin/zsh');
  assert.equal(args[0], '-ilc');
  assert.ok(!args[1].includes('vite') && !args[1].includes('dev'));
  assert.equal(options.cwd, directory);
  assert.equal(options.detached, true);
  assert.equal(options.env.YALQEN_RUN_MANAGER, 'npm');
  assert.equal(options.env.YALQEN_RUN_SCRIPT, 'dev');
  assert.equal(options.env.BROWSER, 'none');
  assert.equal(options.env.ELECTRON_RUN_AS_NODE, undefined);
  assert.equal(options.env.CLAUDECODE, undefined);
  assert.equal(runner.state().status, 'starting');
});

test('opens the dev server once, even when the address is split across chunks', async (t) => {
  const { runner, calls, children, directory } = fixture(t);
  await runner.selectDirectory(directory);
  runner.start();
  children[0].stdout.emit('data', Buffer.from('VITE ready\n  Local: http://localh'));
  assert.equal(runner.state().status, 'starting');
  children[0].stdout.emit('data', Buffer.from('ost:5173/\n'));
  children[0].stdout.emit('data', Buffer.from('http://localhost:5174/\n'));
  assert.equal(runner.state().status, 'running');
  assert.equal(runner.state().url, 'http://localhost:5173/');
  assert.deepEqual(calls.urls, ['http://localhost:5173/']);
});

test('stop ends the process and returns to idle without reporting a failure', async (t) => {
  const { runner, calls, children, directory } = fixture(t);
  await runner.selectDirectory(directory);
  runner.start();
  children[0].stderr.emit('data', 'http://localhost:3000');
  assert.equal(runner.active, true);
  runner.stop();
  assert.deepEqual(calls.kill, ['SIGTERM']);
  assert.equal(runner.state().status, 'idle');
  assert.equal(runner.state().url, null);
  assert.equal(runner.state().exitCode, null);
  assert.equal(runner.active, false);
});

test('an unexpected exit is reported with its code and can be restarted', async (t) => {
  const { runner, children, directory } = fixture(t);
  await runner.selectDirectory(directory);
  runner.start();
  children[0].emit('exit', 1);
  assert.equal(runner.state().status, 'error');
  assert.equal(runner.state().exitCode, 1);
  assert.equal(runner.start(), true);
  children[1].emit('exit', 0);
  assert.equal(runner.state().status, 'exited');
});

test('a failed spawn is an error and a second start while running is ignored', async (t) => {
  const failing = fixture(t);
  await failing.runner.selectDirectory(failing.directory);
  failing.children.length = 0;
  const broken = new ProjectRunner({
    onState: () => undefined,
    onUrl: () => undefined,
    spawn: () => {
      throw new Error('no shell');
    },
  });
  t.after(() => broken.dispose());
  await broken.selectDirectory(failing.directory);
  assert.equal(broken.start(), false);
  assert.equal(broken.state().status, 'error');

  const { runner, calls, directory } = fixture(t);
  await runner.selectDirectory(directory);
  assert.equal(runner.start(), true);
  assert.equal(runner.start(), false);
  assert.equal(calls.spawn.length, 1);
});

test('the project cannot change while the server runs, and disposing stops it', async (t) => {
  const { runner, calls, children, directory } = fixture(t);
  await runner.selectDirectory(directory);
  runner.start();
  await runner.selectDirectory(os.tmpdir());
  assert.equal(runner.state().directory, directory);
  runner.dispose();
  assert.deepEqual(calls.kill, ['SIGTERM']);
  assert.equal(children.length, 1);
});
