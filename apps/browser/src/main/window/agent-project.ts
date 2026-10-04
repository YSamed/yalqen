import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type {
  AgentChatSnapshot,
  AgentProjectSummary,
  AgentProviderId,
  AgentTerminalOutput,
} from '../../shared/types.js';
import { acpClient } from '../agent-bridge/acp-client.js';
import { AgentChat } from '../agent-bridge/agent-chat.js';
import { ACP_AGENTS } from '../agent-bridge/agent-providers.js';
import type { ChatPreferenceStore } from '../agent-bridge/chat-preferences.js';
import { AgentSession, type AgentConnection } from '../agent-bridge/agent-session.js';
import { ProjectRunner } from '../agent-bridge/project-runner.js';
import { originOf } from '../agent-bridge/tab-scope.js';

interface AgentProjectOptions {
  connect(project: AgentProject): Promise<AgentConnection>;
  preferences?: ChatPreferenceStore;
  onState(): void;
  onOutput(project: AgentProject, output: AgentTerminalOutput): void;
  onChatUpdate(project: AgentProject, snapshot: AgentChatSnapshot): void;
  onUrl(project: AgentProject, url: string): void;
}

// One project open in a window's agent panel: its own terminal session, chats and dev server. Projects
// in the same window run side by side, each with its own Yalqen connection.
export class AgentProject {
  readonly id = randomUUID();
  readonly session: AgentSession;
  readonly runner: ProjectRunner;
  // Origins of the tabs this project's agent may use: its dev server and tabs the user attached.
  readonly origins = new Set<string>();
  private readonly chats = new Map<AgentProviderId, AgentChat>();
  private provider: AgentProviderId = 'claude';

  constructor(private readonly options: AgentProjectOptions) {
    this.session = new AgentSession({
      connect: () => options.connect(this),
      onState: options.onState,
      onOutput: (output) => options.onOutput(this, output),
    });
    this.runner = new ProjectRunner({
      onState: options.onState,
      onUrl: (url) => {
        this.claim(url);
        options.onUrl(this, url);
      },
    });
  }

  get directory(): string | null {
    return this.session.state().directory;
  }

  get providerId(): AgentProviderId {
    return this.provider;
  }

  get chat(): AgentChat {
    let chat = this.chats.get(this.provider);
    if (!chat) {
      const provider = this.provider;
      chat = new AgentChat({
        provider,
        connect: () => this.options.connect(this),
        preferences: this.options.preferences,
        onState: this.options.onState,
        onUpdate: (snapshot) => {
          if (provider === this.provider) this.options.onChatUpdate(this, snapshot);
        },
        workspace: async () => {
          const directory = path.join(app.getPath('userData'), 'agent-workspace');
          await fs.mkdir(directory, { recursive: true });
          return directory;
        },
        ...(provider !== 'claude' && {
          loadClient: acpClient(ACP_AGENTS[provider]),
          loadSessions: async () => ({ listSessions: async () => [], getSessionMessages: async () => [] }),
        }),
      });
      const directory = this.directory;
      if (directory) chat.selectDirectory(directory);
      this.chats.set(provider, chat);
    }
    return chat;
  }

  get busy(): boolean {
    return this.session.active || this.runner.active || [...this.chats.values()].some((chat) => chat.active);
  }

  selectProvider(provider: AgentProviderId): boolean {
    if (this.chat.active) return false;
    this.provider = provider;
    return true;
  }

  selectDirectory(directory: string): void {
    this.session.selectDirectory(directory);
    for (const chat of this.chats.values()) chat.selectDirectory(directory);
    this.origins.clear();
    void this.runner.selectDirectory(directory);
  }

  claim(url: string): void {
    const origin = originOf(url);
    if (origin) this.origins.add(origin);
  }

  summary(): AgentProjectSummary {
    const chat = this.chats.get(this.provider)?.state();
    return {
      id: this.id,
      directory: this.directory,
      busy: this.busy,
      waiting: chat?.status === 'approval',
    };
  }

  dispose(): void {
    this.session.dispose();
    for (const chat of this.chats.values()) chat.dispose();
    this.runner.dispose();
  }
}
