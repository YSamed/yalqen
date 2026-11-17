import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { app } from 'electron';

if (process.platform === 'darwin') app.commandLine.appendSwitch('use-mock-keychain');

const beforeQuitTasks = [];
const willQuitTasks = [];
let isQuitting = false;

function registerBeforeQuit(fn) {
  beforeQuitTasks.push(fn);
}

function registerWillQuit(fn) {
  willQuitTasks.push(fn);
}

const sweeperScript = `
const fs = require('node:fs');
const parent = Number(process.argv[1]);
const targets = process.argv.slice(2);
const alive = () => {
  try {
    process.kill(parent, 0);
    return true;
  } catch {
    return false;
  }
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
(async () => {
  const giveUpAt = Date.now() + 60000;
  while (alive() && Date.now() < giveUpAt) await sleep(250);
  await sleep(500);
  for (const target of targets) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        await fs.promises.rm(target, { recursive: true, force: true });
        break;
      } catch (error) {
        if (attempt === 9) console.error(error);
        else await sleep(500 * (attempt + 1));
      }
    }
  }
})();
`;

function removeAfterExit(directories) {
  const child = spawn(process.execPath, ['-e', sweeperScript, String(process.pid), ...directories], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}

async function removeDirectory(directory) {
  if (process.platform !== 'win32') {
    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    return;
  }
  removeAfterExit([directory]);
}

app.on('before-quit', async (event) => {
  if (isQuitting) return;
  event.preventDefault();
  isQuitting = true;

  await Promise.all(beforeQuitTasks.map((fn) => fn()));
  app.quit();
});

let isWillQuitting = false;
app.on('will-quit', async (event) => {
  event.preventDefault();
  if (isWillQuitting) return;
  isWillQuitting = true;

  try {
    await Promise.all(willQuitTasks.map((fn) => fn()));
  } catch (error) {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  }
  app.exit(process.exitCode ?? 0);
});

export { registerBeforeQuit, registerWillQuit, removeDirectory };
