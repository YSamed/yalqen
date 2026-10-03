import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { IPty, IPtyForkOptions } from 'node-pty';
import { EMPTY_AGENT_SESSION, isAgentTerminalSize } from '../../shared/agent-panel.js';
import type { AgentSessionState, AgentTerminalOutput, AgentTerminalSnapshot } from '../../shared/types.js';

const MAX_REPLAY_LENGTH = 1024 * 1024;
const MAX_INPUT_LENGTH = 64 * 1024;
const OUTPUT_INTERVAL_MS = 16;
const SCRIPT = [
  'cd -- "$YALQEN_AGENT_DIRECTORY" || exit 126',
  'command -v claude >/dev/null 2>&1 || exit 127',
  'exec claude --mcp-config "$YALQEN_MCP_CONFIG"',
].join('\n');

export interface AgentConnection {
  url: string;
  token: string;
}

export interface AgentPtyHost {
  spawn(file: string, args: string[], options: IPtyForkOptions): IPty;
  terminate(terminal: IPty): void;
}

export interface AgentSessionOptions {
  connect(): Promise<AgentConnection>;
  onState(): void;
  onOutput(output: AgentTerminalOutput): void;
  loadPty?(): Promise<AgentPtyHost>;
  shell?: string;
  env?: NodeJS.ProcessEnv;
}

async function loadPty(): Promise<AgentPtyHost> {
  const { spawn } = await import('node-pty');
  return {
    spawn,
    terminate: (terminal) => {
      // forkpty gives this session its own process group; close its child commands too.
      const kill = (signal: NodeJS.Signals) => {
        try {
          if (process.platform === 'win32') terminal.kill();
          else process.kill(-terminal.pid, signal);
        } catch {}
      };
      const timer = setTimeout(() => kill('SIGKILL'), 1500);
      timer.unref();
      const listener = terminal.onExit(() => {
        clearTimeout(timer);
        listener.dispose();
      });
      kill('SIGHUP');
    },
  };
}

export class AgentSession {
  private view: AgentSessionState = { ...EMPTY_AGENT_SESSION };
  private terminal: IPty | null = null;
  private ptyHost: AgentPtyHost | null = null;
  private listeners: { dispose(): void }[] = [];
  private output: string[] = [];
  private outputLength = 0;
  private pending = '';
  private sequence = 0;
  private outputTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly options: AgentSessionOptions) {}

  state(): AgentSessionState {
    return { ...this.view };
  }

  snapshot(): AgentTerminalSnapshot {
    this.flushOutput();
    return { state: this.state(), sequence: this.sequence, data: this.output.join('') };
  }

  get active(): boolean {
    return this.view.status === 'starting' || this.view.status === 'running';
  }

  selectDirectory(directory: string): void {
    if (this.disposed || this.active) return;
    this.view = { ...EMPTY_AGENT_SESSION, directory };
    this.output = [];
    this.outputLength = 0;
    this.sequence = 0;
    this.options.onState();
  }

  async start(size: unknown): Promise<AgentSessionState> {
    if (this.disposed || this.active) return this.state();
    const directory = this.view.directory;
    if (!directory) {
      this.fail('invalid-directory');
      return this.state();
    }
    const id = randomUUID();
    this.output = [];
    this.outputLength = 0;
    this.pending = '';
    this.sequence = 0;
    this.view = { id, directory, status: 'starting', exitCode: null, error: null };
    this.options.onState();
    const current = () => !this.disposed && this.view.id === id && this.view.status === 'starting';

    try {
      if (!(await fs.stat(directory)).isDirectory()) throw new Error('Not a directory');
    } catch {
      if (current()) this.fail('invalid-directory');
      return this.state();
    }
    if (!current()) return this.state();
    let host: AgentPtyHost;
    try {
      host = await (this.options.loadPty ?? loadPty)();
    } catch {
      if (current()) this.fail('terminal-unavailable');
      return this.state();
    }
    if (!current()) return this.state();
    let connection: AgentConnection;
    try {
      connection = await this.options.connect();
    } catch {
      if (current()) this.fail('connection-failed');
      return this.state();
    }
    if (!current()) return this.state();

    const env = { ...(this.options.env ?? process.env) };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.ELECTRON_NO_ASAR;
    delete env.CLAUDECODE;
    env.COLORTERM = 'truecolor';
    env.TERM_PROGRAM = 'Yalqen';
    env.YALQEN_AGENT_DIRECTORY = directory;
    env.YALQEN_MCP_URL = connection.url;
    env.YALQEN_MCP_TOKEN = connection.token;
    // Credentials stay in the child environment, outside command arguments and renderer state.
    env.YALQEN_MCP_CONFIG = JSON.stringify({
      mcpServers: {
        yalqen: {
          type: 'http',
          url: '${YALQEN_MCP_URL}',
          headers: { Authorization: 'Bearer ${YALQEN_MCP_TOKEN}' },
        },
      },
    });
    const dimensions = isAgentTerminalSize(size) ? size : { cols: 80, rows: 24 };
    try {
      const terminal = host.spawn(this.options.shell ?? env.SHELL ?? '/bin/zsh', ['-ilc', SCRIPT], {
        name: 'xterm-256color',
        ...dimensions,
        cwd: directory,
        env,
      });
      this.terminal = terminal;
      this.ptyHost = host;
      this.listeners = [
        terminal.onData((data) => {
          if (this.terminal !== terminal) return;
          this.pending += data;
          this.outputTimer ??= setTimeout(() => this.flushOutput(), OUTPUT_INTERVAL_MS);
        }),
        terminal.onExit(({ exitCode }) => {
          if (this.terminal !== terminal) return;
          this.flushOutput();
          this.terminal = null;
          this.clearListeners();
          this.view = {
            ...this.view,
            status: exitCode === 127 ? 'error' : 'exited',
            exitCode,
            error: exitCode === 127 ? 'claude-not-found' : null,
          };
          this.options.onState();
        }),
      ];
      this.view = { ...this.view, status: 'running' };
      this.options.onState();
    } catch {
      this.stop(id);
      this.fail('start-failed');
    }
    return this.state();
  }

  write(sessionId: unknown, data: unknown): void {
    if (sessionId !== this.view.id || typeof data !== 'string' || data.length > MAX_INPUT_LENGTH) return;
    try {
      this.terminal?.write(data);
    } catch {}
  }

  resize(sessionId: unknown, size: unknown): void {
    if (sessionId !== this.view.id || !isAgentTerminalSize(size)) return;
    try {
      this.terminal?.resize(size.cols, size.rows);
    } catch {}
  }

  stop(sessionId: unknown): void {
    if (sessionId !== this.view.id || !this.active) return;
    this.flushOutput();
    const terminal = this.terminal;
    this.terminal = null;
    this.clearListeners();
    if (terminal) this.ptyHost?.terminate(terminal);
    this.view = { ...this.view, status: 'exited', exitCode: null, error: null };
    if (!this.disposed) this.options.onState();
  }

  dispose(): void {
    this.disposed = true;
    this.stop(this.view.id);
    this.clearListeners();
    this.output = [];
    this.pending = '';
  }

  private fail(error: AgentSessionState['error']): void {
    this.view = { ...this.view, status: 'error', error };
    this.options.onState();
  }

  private clearListeners(): void {
    for (const listener of this.listeners) listener.dispose();
    this.listeners = [];
  }

  private flushOutput(): void {
    if (this.outputTimer) clearTimeout(this.outputTimer);
    this.outputTimer = null;
    if (!this.pending || !this.view.id) return;
    const data = this.pending;
    this.pending = '';
    this.output.push(data);
    this.outputLength += data.length;
    while (this.outputLength > MAX_REPLAY_LENGTH && this.output.length > 1) {
      this.outputLength -= this.output.shift()!.length;
    }
    if (this.outputLength > MAX_REPLAY_LENGTH) {
      this.output[0] = this.output[0].slice(-MAX_REPLAY_LENGTH);
      this.outputLength = MAX_REPLAY_LENGTH;
    }
    const output = { sessionId: this.view.id, sequence: ++this.sequence, data };
    if (!this.disposed) this.options.onOutput(output);
  }
}
