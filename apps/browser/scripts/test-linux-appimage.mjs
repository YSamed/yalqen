import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

assert.equal(process.platform, 'linux', 'Run this smoke test on Linux');
const image = path.resolve(process.argv[2]);
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'yalqen-appimage-'));

function launch(name, args) {
  const child = spawn(image, args, {
    detached: true,
    env: {
      ...process.env,
      APPIMAGE_EXTRACT_AND_RUN: '1',
      XDG_CONFIG_HOME: path.join(root, name, 'config'),
      XDG_CACHE_HOME: path.join(root, name, 'cache'),
      ELECTRON_RUN_AS_NODE: undefined,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (data) => (log += data));
  child.stderr.on('data', (data) => (log += data));
  const exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', (error) => resolve({ error }));
  });
  return { child, exited, log: () => log };
}

async function stop(run) {
  try {
    process.kill(-run.child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
  await run.exited;
}

async function renderers(parentPid) {
  const entries = await fs.readdir('/proc');
  const processes = await Promise.all(
    entries
      .filter((entry) => /^\d+$/.test(entry))
      .map(async (pid) => {
        try {
          const [status, command] = await Promise.all([
            fs.readFile(`/proc/${pid}/status`, 'utf8'),
            fs.readFile(`/proc/${pid}/cmdline`, 'utf8'),
          ]);
          return { pid: Number(pid), parent: Number(status.match(/^PPid:\s+(\d+)/m)[1]), status, command };
        } catch {
          return null;
        }
      }),
  );
  const descendants = new Set([parentPid]);
  let previousSize;
  do {
    previousSize = descendants.size;
    for (const entry of processes) {
      if (entry && descendants.has(entry.parent)) descendants.add(entry.pid);
    }
  } while (descendants.size !== previousSize);
  return processes.filter((entry) => entry && descendants.has(entry.pid) && entry.command.includes('--type=renderer'));
}

try {
  const rejected = launch('no-sandbox', ['--no-sandbox']);
  try {
    const result = await Promise.race([rejected.exited, delay(30_000, undefined, { ref: false }).then(() => null)]);
    assert.equal(result?.code, 1, `An unsandboxed launch must fail: ${rejected.log()}`);
    assert.match(rejected.log(), /Yalqen requires the Chromium sandbox/);
  } finally {
    await stop(rejected);
  }

  const normal = launch('sandbox', []);
  try {
    let found = [];
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const exit = await Promise.race([normal.exited, delay(500).then(() => null)]);
      assert.equal(exit, null, `AppImage exited before opening: ${normal.log()}`);
      found = await renderers(normal.child.pid);
      if (
        found.length >= 2 &&
        found.every((renderer) => /^NoNewPrivs:\s+1$/m.test(renderer.status) && /^Seccomp:\s+2$/m.test(renderer.status))
      )
        break;
    }
    assert.ok(found.length >= 2, `Expected the packaged browser to start renderers: ${normal.log()}`);
    for (const renderer of found) {
      assert.doesNotMatch(renderer.command, /--no-sandbox/);
      assert.match(renderer.status, /^NoNewPrivs:\s+1$/m);
      assert.match(renderer.status, /^Seccomp:\s+2$/m);
    }
    console.log(`AppImage launched with ${found.length} sandboxed renderers; --no-sandbox was rejected.`);
  } finally {
    await stop(normal);
  }
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
