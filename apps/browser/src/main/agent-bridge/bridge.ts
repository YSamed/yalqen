import type { AgentSetupKind } from '../../shared/types.js';
import { DEFAULT_PORT, MCP_PATH, startBridgeServer, type BridgeServer } from './server.js';
import type { BridgeHost } from './tools.js';

export interface AgentBridgeStatus {
  enabled: boolean;
  port: number | null;
  error: string | null;
  lastCallAt: number | null;
  calls: number;
}

export interface AgentBridgeOptions {
  enabled(): boolean;
  host: BridgeHost;
  token(): string;
  version: string;
  onChange(): void;
  firstPort?: number;
}

export function mcpUrl(port: number): string {
  return `http://127.0.0.1:${port}${MCP_PATH}`;
}

export function setupSnippet(kind: AgentSetupKind, port: number, token: string): string {
  switch (kind) {
    case 'claude':
      return `claude mcp add --transport http yalqen ${mcpUrl(port)} --header "Authorization: Bearer ${token}"`;
    case 'codex':
      return [
        `# ~/.codex/config.toml`,
        `[mcp_servers.yalqen]`,
        `url = "${mcpUrl(port)}"`,
        `bearer_token_env_var = "YALQEN_MCP_TOKEN"`,
        ``,
        `# shell profile`,
        `export YALQEN_MCP_TOKEN="${token}"`,
      ].join('\n');
    case 'token':
      return token;
  }
}

export class AgentBridge {
  private server: BridgeServer | null = null;
  private error: string | null = null;
  private lastCallAt: number | null = null;
  private calls = 0;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly options: AgentBridgeOptions) {}

  get port(): number | null {
    return this.server?.port ?? null;
  }

  status(): AgentBridgeStatus {
    return {
      enabled: this.options.enabled(),
      port: this.port,
      error: this.error,
      lastCallAt: this.lastCallAt,
      calls: this.calls,
    };
  }

  snippet(kind: AgentSetupKind): string | null {
    return this.server ? setupSnippet(kind, this.server.port, this.options.token()) : null;
  }

  sync(): Promise<void> {
    this.pending = this.pending.then(() => this.apply(this.options.enabled()));
    return this.pending;
  }

  stop(): Promise<void> {
    this.pending = this.pending.then(() => this.apply(false));
    return this.pending;
  }

  private async apply(enabled: boolean): Promise<void> {
    if (enabled === (this.server !== null)) return;
    if (this.server) {
      const server = this.server;
      this.server = null;
      await server.close();
    } else {
      try {
        this.server = await startBridgeServer(
          {
            host: this.options.host,
            token: () => this.options.token(),
            version: this.options.version,
            onToolCall: () => {
              this.lastCallAt = Date.now();
              this.calls++;
              this.options.onChange();
            },
          },
          this.options.firstPort ?? DEFAULT_PORT,
        );
        this.error = null;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    }
    this.options.onChange();
  }
}
