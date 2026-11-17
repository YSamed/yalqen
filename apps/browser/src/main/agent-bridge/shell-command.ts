import { execFile } from 'node:child_process';
import path from 'node:path';
import { IS_WIN, defaultShell, ensureExecutable } from '../platform.js';

export interface ShellCommand {
  executable: string;
  env: NodeJS.ProcessEnv;
}

const SCRIPT =
  'command -v "$YALQEN_COMMAND" >/dev/null 2>&1 || exit 127\nprintf "\\0%s\\0%s" "$(command -v "$YALQEN_COMMAND")" "$PATH"';

export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env = { ...base };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  delete env.CLAUDECODE;
  return env;
}

export async function findCommand(name: string): Promise<ShellCommand> {
  if (!/^[\w.-]+$/.test(name)) throw new Error('Invalid command name');
  const env = childEnv();
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      env.SHELL ?? defaultShell(),
      [IS_WIN ? '-lc' : '-ilc', SCRIPT],
      { env: { ...env, YALQEN_COMMAND: name }, timeout: 10_000, maxBuffer: 128 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
  const [, command, shellPath] = output.slice(output.indexOf('\0')).split('\0');
  if (!command || !path.isAbsolute(command)) throw Object.assign(new Error(`${name} not found`), { code: 127 });
  const executable = await ensureExecutable(command);
  if (shellPath) env.PATH = shellPath;
  return { executable, env };
}
