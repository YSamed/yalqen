import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type {
  AgentBackgroundChat,
  AgentChatState,
  AgentProjectSummary,
  AgentProviderId,
  AgentTerminalOutput,
} from '../../shared/agent.js';
import type { AgentChatComposer } from '../../shared/agent-panel.js';
import { acpClient } from './acp-client.js';
import { AgentChat } from './agent-chat.js';
import { ACP_AGENTS } from './agent-providers.js';
import type { ChatPreferenceStore } from './chat-preferences.js';
import { AgentSession, type AgentConnection } from './agent-session.js';
import { ProjectRunner } from './project-runner.js';
import { originOf } from './tab-scope.js';

interface AgentProjectOptions {
  connect(project: AgentProject): Promise<AgentConnection>;
  preferences?: ChatPreferenceStore;
  onState(): void;
  onOutput(project: AgentProject, output: AgentTerminalOutput): void;
  onChatUpdate(project: AgentProject, serialized: string): void;
  onUrl(project: AgentProject, url: string): void;
}

interface Conversation {
  id: string;
  provider: AgentProviderId;
  draft?: AgentChatComposer;
  readonly chats: Map<AgentProviderId, AgentChat>;
  readonly background: AgentChat[];
}

const MAX_BACKGROUND_CHATS = 5;
const WORKING: readonly AgentChatState['status'][] = ['starting', 'thinking', 'approval'];

function isWorking(chat: AgentChat): boolean {
  return WORKING.includes(chat.state().status);
}

export class AgentProject {
  readonly id = randomUUID();
  readonly session: AgentSession;
  readonly runner: ProjectRunner;
  readonly origins = new Set<string>();
  private readonly conversations = new Map<string, Conversation>();
  private tabId = '';

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

  private get conversation(): Conversation {
    return this.conversationFor(this.tabId);
  }

  private conversationFor(tabId: string): Conversation {
    let conversation = this.conversations.get(tabId);
    if (!conversation) {
      conversation = { id: randomUUID(), provider: 'claude', chats: new Map(), background: [] };
      this.conversations.set(tabId, conversation);
    }
    return conversation;
  }

  private get allChats(): AgentChat[] {
    return [...new Set(this.conversations.values())].flatMap((conversation) => [
      ...conversation.chats.values(),
      ...conversation.background,
    ]);
  }

  get conversationId(): string {
    return this.conversation.id;
  }

  draftFor(id: string): AgentChatComposer | null {
    for (const conversation of this.conversations.values()) {
      if (conversation.id === id) return conversation.draft ?? { text: '', attachments: [], images: [] };
    }
    return null;
  }

  updateDraft(id: string, patch: Partial<AgentChatComposer>): void {
    for (const conversation of this.conversations.values()) {
      if (conversation.id !== id) continue;
      const draft = conversation.draft ?? { text: '', attachments: [], images: [] };
      if (typeof patch?.text === 'string') draft.text = patch.text;
      if (Array.isArray(patch?.attachments)) draft.attachments = patch.attachments;
      if (Array.isArray(patch?.images)) draft.images = patch.images;
      conversation.draft = draft.text || draft.attachments.length || draft.images.length ? draft : undefined;
      return;
    }
  }

  get providerId(): AgentProviderId {
    return this.conversation.provider;
  }

  focusTab(tabId: string): boolean {
    if (tabId === this.tabId) return false;
    const previous = this.conversations.get(this.tabId);
    this.tabId = tabId;
    return previous === undefined || this.conversations.get(tabId) !== previous;
  }

  shareConversation(tabId: string): void {
    if (!this.conversations.has(tabId)) this.conversations.set(tabId, this.conversation);
  }

  retainTabs(tabIds: ReadonlySet<string>): void {
    const before = this.allChats;
    for (const tabId of [...this.conversations.keys()])
      if (tabId !== '' && !tabIds.has(tabId)) this.conversations.delete(tabId);
    const kept = new Set(this.allChats);
    for (const chat of before) if (!kept.has(chat)) chat.dispose();
  }

  get chat(): AgentChat {
    return this.chatOf(this.conversation);
  }

  async startChat(tabId: string, text: string): Promise<boolean> {
    if (this.conversations.has(tabId)) return false;
    return this.chatOf(this.conversationFor(tabId)).send(null, text);
  }

  private chatOf(conversation: Conversation): AgentChat {
    let chat = conversation.chats.get(conversation.provider);
    if (!chat) {
      const provider = conversation.provider;
      chat = new AgentChat({
        provider,
        connect: () => this.options.connect(this),
        preferences: this.options.preferences,
        onState: this.options.onState,
        onUpdate: (serialized) => {
          if (this.shownChat() === chat) this.options.onChatUpdate(this, serialized);
        },
        workspace: async () => {
          const directory = path.join(app.getPath('userData'), 'agent-workspace');
          await fs.mkdir(directory, { recursive: true });
          return directory;
        },
        ...(provider !== 'claude' && {
          loadClient: acpClient(ACP_AGENTS[provider]),
          loadSessions: async () => ({
            listSessions: async () => [],
            getSessionMessages: async () => [],
            deleteSession: async () => {
              throw new Error('Unsupported');
            },
          }),
        }),
      });
      const directory = this.directory;
      if (directory) chat.selectDirectory(directory);
      conversation.chats.set(provider, chat);
    }
    return chat;
  }

  private shownChat(): AgentChat | undefined {
    const conversation = this.conversations.get(this.tabId);
    return conversation?.chats.get(conversation.provider);
  }

  moveBackgroundChat(id: string, tabId: string): boolean {
    const conversation = this.conversation;
    const chat = conversation.background.find((candidate) => candidate.state().id === id);
    if (!chat || this.conversations.has(tabId)) return false;
    conversation.background.splice(conversation.background.indexOf(chat), 1);
    const provider = chat.state().provider;
    this.conversations.set(tabId, { id: randomUUID(), provider, chats: new Map([[provider, chat]]), background: [] });
    return true;
  }

  backgroundChats(): AgentBackgroundChat[] {
    return this.conversation.background.map((chat) => {
      const state = chat.state();
      const first = chat.snapshot().messages.find((message) => message.role === 'user');
      const title = first?.parts.find((part) => part.type === 'text')?.text ?? '';
      return { id: state.id ?? '', title: title.slice(0, 80), status: state.status };
    });
  }

  backgroundChat(id: string): AgentChat | null {
    return this.conversation.background.find((candidate) => candidate.state().id === id) ?? null;
  }

  setAsideChat(): boolean {
    const conversation = this.conversation;
    const chat = conversation.chats.get(conversation.provider);
    if (!chat || (!isWorking(chat) && chat.snapshot().messages.length === 0)) return false;
    if (conversation.background.length >= MAX_BACKGROUND_CHATS) {
      const oldest = conversation.background.find((candidate) => !isWorking(candidate));
      if (!oldest) return false;
      conversation.background.splice(conversation.background.indexOf(oldest), 1);
      oldest.dispose();
    }
    conversation.background.push(chat);
    conversation.chats.delete(conversation.provider);
    conversation.id = randomUUID();
    delete conversation.draft;
    return true;
  }

  showBackgroundChat(id: string): boolean {
    const conversation = this.conversation;
    const chat = conversation.background.find((candidate) => candidate.state().id === id);
    if (!chat) return false;
    conversation.background.splice(conversation.background.indexOf(chat), 1);
    const provider = chat.state().provider;
    const shown = conversation.chats.get(provider);
    if (shown && (isWorking(shown) || shown.snapshot().messages.length > 0)) conversation.background.push(shown);
    else shown?.dispose();
    conversation.chats.set(provider, chat);
    conversation.provider = provider;
    conversation.id = randomUUID();
    delete conversation.draft;
    return true;
  }

  dismissBackgroundChat(id: string): boolean {
    const conversation = this.conversation;
    const chat = conversation.background.find((candidate) => candidate.state().id === id);
    if (!chat || isWorking(chat)) return false;
    conversation.background.splice(conversation.background.indexOf(chat), 1);
    chat.dispose();
    return true;
  }

  get busy(): boolean {
    return this.session.active || this.runner.active || this.allChats.some((chat) => chat.active);
  }

  selectProvider(provider: AgentProviderId): boolean {
    if (this.chat.active) return false;
    this.conversation.provider = provider;
    return true;
  }

  selectDirectory(directory: string): void {
    this.session.selectDirectory(directory);
    for (const chat of this.allChats) chat.selectDirectory(directory);
    this.origins.clear();
    void this.runner.selectDirectory(directory);
  }

  claim(url: string): void {
    const origin = originOf(url);
    if (origin) this.origins.add(origin);
  }

  summary(): AgentProjectSummary {
    return {
      id: this.id,
      directory: this.directory,
      busy: this.busy,
      waiting: this.allChats.some((chat) => chat.state().status === 'approval'),
    };
  }

  dispose(): void {
    this.session.dispose();
    for (const chat of this.allChats) chat.dispose();
    this.runner.dispose();
  }
}
