import { spawn as spawnProcess, type ChildProcess, type SpawnOptions } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EMPTY_PROJECT_RUN } from '../../shared/agent-panel.js';
import type { ProjectRunState } from '../../shared/types.js';

const SCRIPT_NAMES = ['dev', 'start', 'serve', 'preview'];
const SCRIPT_NAME_PATTERN = /^[\w:.-]+$/;
const MANAGERS = ['pnpm', 'yarn', 'bun', 'npm'] as const;
type Manager = (typeof MANAGERS)[number];
const LOCKFILES: [string, Manager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
];
const URL_PATTERN = /https?:\/\/(?:localhost|127\.0\.0\.1|\[::1?\]|0\.0\.0\.0):\d{2,5}/;
const ANSI_PATTERN = new RegExp(String.fromCharCode(27) + '\\[[0-9;?]*[ -/]*[@-~]', 'g');
const SCAN_LENGTH = 2048;
const URL_TIMEOUT_MS = 30_000;
const KILL_DELAY_MS = 1500;
const SCRIPT = [
  'cd -- "$YALQEN_RUN_DIRECTORY" || exit 126',
  'exec "$YALQEN_RUN_MANAGER" run "$YALQEN_RUN_SCRIPT"',
].join('\n');

interface ProjectCommand {
  manager: Manager;
  script: string;
}

interface ProjectRunnerOptions {
  onState(): void;
  onUrl(url: string): void;
  spawn?(command: string, args: string[], options: SpawnOptions): ChildProcess;
  shell?: string;
  env?: NodeJS.ProcessEnv;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function detectManager(directory: string, declared: unknown): Promise<Manager> {
  const name = typeof declared === 'string' ? declared.split('@')[0] : null;
  const match = MANAGERS.find((manager) => manager === name);
  if (match) return match;
  for (const [file, manager] of LOCKFILES) if (await exists(path.join(directory, file))) return manager;
  return 'npm';
}

export async function detectProjectCommand(directory: string): Promise<ProjectCommand | null> {
  try {
    const manifest: unknown = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    if (!manifest || typeof manifest !== 'object') return null;
    const { scripts, packageManager } = manifest as { scripts?: unknown; packageManager?: unknown };
    if (!scripts || typeof scripts !== 'object') return null;
    const script = SCRIPT_NAMES.find(
      (name) => typeof (scripts as Record<string, unknown>)[name] === 'string' && SCRIPT_NAME_PATTERN.test(name),
    );
    return script ? { manager: await detectManager(directory, packageManager), script } : null;
  } catch {
    return null;
  }
}

export function findLocalUrl(text: string): string | null {
  const match = URL_PATTERN.exec(text.replace(ANSI_PATTERN, ''));
  if (!match) return null;
  const url = new URL(match[0]);
  if (url.hostname === '0.0.0.0' || url.hostname === '[::]') url.hostname = 'localhost';
  return `${url.origin}/`;
}

export class ProjectRunner {
  private view: ProjectRunState = { ...EMPTY_PROJECT_RUN };
  private command: ProjectCommand | null = null;
  private child: ChildProcess | null = null;
  private stopping = false;
  private scan = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private selection = 0;
  private disposed = false;

  constructor(private readonly options: ProjectRunnerOptions) {}

  state(): ProjectRunState {
    return { ...this.view };
  }

  get active(): boolean {
    return this.view.status === 'starting' || this.view.status === 'running';
  }

  async selectDirectory(directory: string): Promise<void> {
    if (this.disposed || this.active) return;
    const selection = ++this.selection;
    this.command = null;
    this.view = { ...EMPTY_PROJECT_RUN, directory };
    this.options.onState();
    const command = await detectProjectCommand(directory);
    if (this.disposed || this.active || selection !== this.selection) return;
    this.command = command;
    this.view = { ...this.view, command: command ? `${command.manager} run ${command.script}` : null };
    this.options.onState();
  }

  start(): boolean {
    const { command } = this;
    const directory = this.view.directory;
    if (this.disposed || this.active || !command || !directory) return false;
    const env = { ...(this.options.env ?? process.env) };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_NO_ASAR;
    delete env.CLAUDECODE;
    env.BROWSER = 'none';
    env.FORCE_COLOR = '0';
    // Python's http.server prints its address with print(), which is buffered when piped.
    env.PYTHONUNBUFFERED = '1';
    env.YALQEN_RUN_DIRECTORY = directory;
    env.YALQEN_RUN_MANAGER = command.manager;
    env.YALQEN_RUN_SCRIPT = command.script;
    let child: ChildProcess;
    try {
      // A new process group lets stop() end the dev server together with its child processes.
      child = (this.options.spawn ?? spawnProcess)(this.options.shell ?? env.SHELL ?? '/bin/zsh', ['-ilc', SCRIPT], {
        cwd: directory,
        env,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      this.view = { ...this.view, status: 'error', url: null, exitCode: null };
      this.options.onState();
      return false;
    }
    this.child = child;
    this.stopping = false;
    this.scan = '';
    this.view = { ...this.view, status: 'starting', url: null, exitCode: null };
    this.options.onState();
    this.timer = setTimeout(() => this.settle(null), URL_TIMEOUT_MS);
    this.timer.unref();
    const read = (chunk: Buffer | string) => {
      if (this.child !== child || this.view.url) return;
      this.scan = (this.scan + chunk.toString()).slice(-SCAN_LENGTH);
      const url = findLocalUrl(this.scan);
      if (url) this.settle(url);
    };
    child.stdout?.on('data', read);
    child.stderr?.on('data', read);
    child.once('error', () => this.finish(child, null, true));
    child.once('exit', (code) => this.finish(child, code, false));
    return true;
  }

  stop(): void {
    const child = this.child;
    if (!child || !this.active) return;
    this.stopping = true;
    this.killGroup(child, 'SIGTERM');
    const timer = setTimeout(() => this.killGroup(child, 'SIGKILL'), KILL_DELAY_MS);
    timer.unref();
    child.once('exit', () => clearTimeout(timer));
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.clearTimer();
  }

  private settle(url: string | null): void {
    this.clearTimer();
    if (this.view.status !== 'starting') return;
    this.view = { ...this.view, status: 'running', url };
    this.options.onState();
    if (url) this.options.onUrl(url);
  }

  private finish(child: ChildProcess, code: number | null, failed: boolean): void {
    if (this.child !== child) return;
    this.child = null;
    this.clearTimer();
    const requested = this.stopping;
    this.stopping = false;
    this.view = {
      ...this.view,
      status: requested ? 'idle' : failed || code ? 'error' : 'exited',
      url: null,
      exitCode: requested ? null : code,
    };
    if (!this.disposed) this.options.onState();
  }

  private killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
    try {
      if (child.pid) return void process.kill(-child.pid, signal);
    } catch {}
    try {
      child.kill(signal);
    } catch {}
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
