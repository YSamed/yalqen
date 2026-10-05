import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentProviderId } from '../../shared/types.js';
import { findCommand } from './shell-command.js';

const LOGIN_COMMANDS: Partial<Record<AgentProviderId, { command: string; args: string[]; logout: string[] }>> = {
  claude: { command: 'claude', args: ['auth', 'login'], logout: ['auth', 'logout'] },
  codex: { command: 'codex', args: ['login'], logout: ['logout'] },
};
const LOGOUT_TIMEOUT_MS = 30_000;
const LOGIN_TIMEOUT_MS = 10 * 60_000;
const BROWSER_WAIT_MS = 3000;
const POLL_MS = 250;

// The CLIs open their sign-in page through $BROWSER. This stand-in records the URL instead, so the page
// opens in a Yalqen tab and the CLI's localhost callback completes the login there.
export const BROWSER_SCRIPT = '#!/bin/sh\nprintf \'%s\\n\' "$1" > "$YALQEN_LOGIN_URL_FILE"\n';

export function loginUrlIn(output: string): string | null {
  return /https:\/\/[^\s"'<>]+/.exec(output)?.[0] ?? null;
}

export async function signIn(provider: AgentProviderId, openUrl: (url: string) => void): Promise<boolean> {
  const login = LOGIN_COMMANDS[provider];
  if (!login) return false;
  let command: Awaited<ReturnType<typeof findCommand>>;
  try {
    command = await findCommand(login.command);
  } catch {
    return false;
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'yalqen-login-'));
  const browser = path.join(directory, 'browser');
  const urlFile = path.join(directory, 'url');
  await fs.writeFile(browser, BROWSER_SCRIPT, { mode: 0o700 });
  try {
    return await new Promise<boolean>((resolve) => {
      const child = spawn(command.executable, login.args, {
        env: { ...command.env, BROWSER: browser, YALQEN_LOGIN_URL_FILE: urlFile },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const started = Date.now();
      let output = '';
      let opened = false;
      const collect = (chunk: Buffer) => {
        if (output.length < 64 * 1024) output += chunk.toString();
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      // A URL the CLI handed to the browser carries the localhost callback; the printed one may not.
      const poll = setInterval(() => {
        if (opened) return;
        void fs.readFile(urlFile, 'utf8').then(
          (text) => open(loginUrlIn(text)),
          () => {
            if (Date.now() - started >= BROWSER_WAIT_MS) open(loginUrlIn(output));
          },
        );
      }, POLL_MS);
      const open = (url: string | null) => {
        if (opened || !url) return;
        opened = true;
        openUrl(url);
      };
      // claude auth login ignores SIGTERM while it waits for the callback.
      const timeout = setTimeout(() => child.kill('SIGKILL'), LOGIN_TIMEOUT_MS);
      const finish = (succeeded: boolean) => {
        clearInterval(poll);
        clearTimeout(timeout);
        resolve(succeeded);
      };
      child.once('error', () => finish(false));
      child.once('exit', (code) => finish(code === 0));
    });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function signOut(provider: AgentProviderId): Promise<boolean> {
  const login = LOGIN_COMMANDS[provider];
  if (!login) return false;
  try {
    const { executable, env } = await findCommand(login.command);
    return await new Promise<boolean>((resolve) => {
      execFile(executable, login.logout, { env, timeout: LOGOUT_TIMEOUT_MS }, (error) => resolve(!error));
    });
  } catch {
    return false;
  }
}
