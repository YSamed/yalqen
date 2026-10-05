import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type {
  AgentBackgroundChat,
  AgentChatSnapshot,
  AgentChatState,
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

interface Conversation {
  // Changes whenever another chat is shown, so the panel starts its view over.
  id: string;
  provider: AgentProviderId;
  readonly chats: Map<AgentProviderId, AgentChat>;
  // Chats set aside by "new chat" while they were still working; they keep running until dismissed.
  readonly background: AgentChat[];
}

const MAX_BACKGROUND_CHATS = 5;
const WORKING: readonly AgentChatState['status'][] = ['starting', 'thinking', 'approval'];

function isWorking(chat: AgentChat): boolean {
  return WORKING.includes(chat.state().status);
}

// One project open in a window's agent panel: its own terminal session, dev server and one conversation
// per browser tab. Projects in the same window run side by side, each with its own Yalqen connection.
export class AgentProject {
  readonly id = randomUUID();
  readonly session: AgentSession;
  readonly runner: ProjectRunner;
  // Origins of the tabs this project's agent may use: its dev server and tabs the user attached.
  readonly origins = new Set<string>();
  // Tabs map to conversations; a tab the agent opens shares the conversation of the tab it worked in.
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

  get providerId(): AgentProviderId {
    return this.conversation.provider;
  }

  // Returns whether the shown conversation changed.
  focusTab(tabId: string): boolean {
    if (tabId === this.tabId) return false;
    const previous = this.conversations.get(this.tabId);
    this.tabId = tabId;
    return previous === undefined || this.conversations.get(tabId) !== previous;
  }

  shareConversation(tabId: string): void {
    if (!this.conversations.has(tabId)) this.conversations.set(tabId, this.conversation);
  }

  // A closed tab takes its conversation along unless another open tab still shares it.
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

  // Starts a tab's conversation with a first message, without showing it until the tab is focused.
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
        onUpdate: (snapshot) => {
          if (this.shownChat() === chat) this.options.onChatUpdate(this, snapshot);
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

  // Moves a background chat into a tab of its own, where it becomes that tab's shown chat.
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

  // Returns false when there is nothing worth keeping, so the caller simply clears the shown chat. When the
  // list is full, the oldest finished chat makes room.
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
