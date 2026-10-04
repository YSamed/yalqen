import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CanUseTool,
  Options,
  PermissionResult,
  PermissionUpdate,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { EMPTY_AGENT_CHAT } from '../../shared/agent-panel.js';
import type {
  AgentChatContext,
  AgentChatSettings,
  AgentEffort,
  AgentElementRef,
  AgentPermissionMode,
  AgentChatMessage,
  AgentChatPart,
  AgentChatPermission,
  AgentChatSnapshot,
  AgentChatState,
} from '../../shared/types.js';
import type { AgentConnection } from './agent-session.js';
import { READ_ONLY_TOOLS } from './tools.js';

const MAX_TEXT = 64 * 1024;
const MAX_MESSAGES = 120;
const MAX_HISTORY = 1024 * 1024;
const MAX_QUEUE = 5;
const PERMISSION_MODES: AgentPermissionMode[] = ['default', 'acceptEdits', 'plan'];
const EFFORTS: AgentEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
type ChatQuery = AsyncIterable<SDKMessage> &
  Pick<
    Query,
    | 'interrupt'
    | 'close'
    | 'setPermissionMode'
    | 'setModel'
    | 'applyFlagSettings'
    | 'supportedModels'
    | 'getContextUsage'
  >;
type Client = {
  query(params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }): ChatQuery;
  executable: string;
  env?: NodeJS.ProcessEnv;
};

interface AgentChatOptions {
  connect(): Promise<AgentConnection>;
  onState(): void;
  onUpdate(snapshot: AgentChatSnapshot): void;
  loadClient?(): Promise<Client>;
}

class InputStream implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiter: ((value: IteratorResult<SDKUserMessage>) => void) | null = null;
  private ended = false;

  push(message: SDKUserMessage): void {
    if (this.ended) return;
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter({ value: message, done: false });
    } else this.items.push(message);
  }

  close(): void {
    this.ended = true;
    this.items = [];
    this.waiter?.({ value: undefined, done: true });
    this.waiter = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: () => {
        const value = this.items.shift();
        if (value) return Promise.resolve({ value, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          this.waiter = resolve;
        });
      },
      return: async () => {
        this.close();
        return { value: undefined, done: true };
      },
    };
  }
}

async function loadClient(): Promise<Client> {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ASAR;
  delete env.CLAUDECODE;
  // Dock-launched apps need the same PATH as the user's terminal. No prompt or credential enters shell code.
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      env.SHELL ?? '/bin/zsh',
      ['-ilc', 'command -v claude >/dev/null 2>&1 || exit 127\nprintf "\\0%s\\0%s" "$(command -v claude)" "$PATH"'],
      { env, timeout: 10_000, maxBuffer: 128 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    );
  });
  const [, executable, shellPath] = output.slice(output.indexOf('\0')).split('\0');
  if (!executable || !path.isAbsolute(executable)) throw Object.assign(new Error('Claude not found'), { code: 127 });
  await fs.access(executable, fs.constants.X_OK);
  if (shellPath) env.PATH = shellPath;
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  return { query, executable, env };
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, MAX_TEXT);
  if (!Array.isArray(content)) return '';
  return content
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .slice(0, MAX_TEXT);
}

function jsonOf(input: unknown): string {
  return JSON.stringify(input, null, 2)?.slice(0, MAX_TEXT) ?? '';
}

function isPermissionMode(value: unknown): value is AgentPermissionMode {
  return PERMISSION_MODES.includes(value as AgentPermissionMode);
}

function promptOf(text: string, context: AgentChatContext | null, elements: AgentElementRef[]): string {
  return (
    text +
    (context
      ? `\n\nYalqen browser context:\n${JSON.stringify({ tab_id: context.id, url: context.url, title: context.title })}`
      : '') +
    (elements.length
      ? `\n\nYalqen selected elements (call get_selected_element with a selection_id for HTML, styles and a screenshot):\n${JSON.stringify(
          elements.map(({ id: selectionId, url, label, component, source }) => ({
            selection_id: selectionId,
            url,
            element: label,
            component,
            source,
          })),
        )}`
      : '')
  );
}

export class AgentChat {
  private view: AgentChatState = { ...EMPTY_AGENT_CHAT };
  private messages: AgentChatMessage[] = [];
  private permissions = new Map<
    string,
    {
      view: AgentChatPermission;
      input: Record<string, unknown>;
      suggestions: PermissionUpdate[];
      settle(result: PermissionResult): void;
    }
  >();
  private queue: AgentChatMessage[] = [];
  private costBase = 0;
  private turnCost = 0;
  private client: ChatQuery | null = null;
  private input: InputStream | null = null;
  private generation = 0;
  private revision = 0;
  private resumeId: string | undefined;
  private streamId: string | null = null;
  private streamParts = new Map<number, AgentChatPart>();
  private toolInput = new Map<number, string>();
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;

  constructor(private readonly options: AgentChatOptions) {}

  state(): AgentChatState {
    return { ...this.view };
  }

  snapshot(): AgentChatSnapshot {
    return structuredClone({
      state: this.state(),
      revision: this.revision,
      messages: this.messages,
      queue: this.queue,
      permissions: [...this.permissions.values()].map((permission) => permission.view),
    });
  }

  get active(): boolean {
    return this.client !== null || this.view.status === 'starting';
  }

  selectDirectory(directory: string): void {
    if (this.disposed || this.active) return;
    this.reset(this.view.id);
    this.setState({ ...this.preferences(), directory });
  }

  configure(id: unknown, settings: unknown): void {
    if (this.disposed || id !== this.view.id || !settings || typeof settings !== 'object') return;
    const { permissionMode, model, effort } = settings as AgentChatSettings;
    const next = { ...this.view };
    if (permissionMode !== undefined) {
      if (!isPermissionMode(permissionMode)) return;
      next.permissionMode = permissionMode;
    }
    if (model !== undefined) {
      if (model !== null && !this.view.models.some((entry) => entry.value === model)) return;
      next.modelChoice = model;
      const efforts = this.view.models.find((entry) => entry.value === model)?.efforts;
      if (next.effort && efforts && !efforts.includes(next.effort)) next.effort = null;
    }
    if (effort !== undefined) {
      if (effort !== null && !EFFORTS.includes(effort)) return;
      next.effort = effort;
    }
    const client = this.client;
    const effortChanged = next.effort !== this.view.effort;
    this.setState(next);
    if (!client) return;
    const apply = async () => {
      if (permissionMode !== undefined) await client.setPermissionMode(next.permissionMode);
      if (model !== undefined) await client.setModel(next.modelChoice ?? undefined);
      if (effortChanged) await client.applyFlagSettings({ effortLevel: next.effort });
    };
    apply().catch(() => undefined);
  }

  cancelQueued(id: unknown, messageId: unknown): void {
    if (id !== this.view.id || typeof messageId !== 'string') return;
    const length = this.queue.length;
    this.queue = this.queue.filter((message) => message.id !== messageId);
    if (this.queue.length !== length) this.publish();
  }

  async send(
    id: unknown,
    text: unknown,
    context: AgentChatContext | null = null,
    elements: AgentElementRef[] = [],
  ): Promise<boolean> {
    if (this.disposed || id !== this.view.id || typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT)
      return false;
    if (this.view.status === 'starting') return false;
    if (this.client && ['thinking', 'approval'].includes(this.view.status)) {
      if (this.queue.length >= MAX_QUEUE) return false;
      this.queue.push({
        id: randomUUID(),
        role: 'user',
        parts: [{ type: 'text', text: text.trim() }],
        context,
        elements,
      });
      this.publish();
      return true;
    }
    const directory = this.view.directory;
    if (!directory) {
      this.fail('invalid-directory');
      return false;
    }
    if (!this.client) {
      const generation = ++this.generation;
      const current = () => !this.disposed && generation === this.generation;
      this.setState({ ...this.view, id: this.view.id ?? randomUUID(), status: 'starting', error: null });
      try {
        if (!(await fs.stat(directory)).isDirectory()) throw new Error('Invalid directory');
      } catch {
        if (current()) this.fail('invalid-directory');
        return false;
      }
      if (!current()) return false;
      let provider: Client;
      try {
        provider = await (this.options.loadClient ?? loadClient)();
      } catch (error) {
        const code = (error as { code?: string | number }).code;
        if (current()) this.fail(code === 'ENOENT' || code === 127 ? 'claude-not-found' : 'start-failed');
        return false;
      }
      if (!current()) return false;
      let connection: AgentConnection;
      try {
        connection = await this.options.connect();
      } catch {
        if (current()) this.fail('connection-failed');
        return false;
      }
      if (!current()) return false;
      this.input = new InputStream();
      const env: NodeJS.ProcessEnv = {
        ...(provider.env ?? process.env),
        YALQEN_MCP_URL: connection.url,
        YALQEN_MCP_TOKEN: connection.token,
      };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.ELECTRON_NO_ASAR;
      delete env.CLAUDECODE;
      try {
        this.client = provider.query({
          prompt: this.input,
          options: {
            cwd: directory,
            pathToClaudeCodeExecutable: provider.executable,
            env,
            resume: this.resumeId,
            model: this.view.modelChoice ?? undefined,
            effort: this.view.effort ?? undefined,
            allowedTools: READ_ONLY_TOOLS.map((tool) => `mcp__yalqen__${tool}`),
            systemPrompt: { type: 'preset', preset: 'claude_code' },
            settingSources: ['user', 'project', 'local'],
            permissionMode: this.view.permissionMode,
            includePartialMessages: true,
            canUseTool: (...args) =>
              current()
                ? this.askPermission(...args)
                : Promise.resolve({ behavior: 'deny', message: 'Session ended.' }),
            stderr: () => undefined,
            mcpServers: {
              yalqen: {
                type: 'http',
                url: '${YALQEN_MCP_URL}',
                headers: { Authorization: 'Bearer ${YALQEN_MCP_TOKEN}' },
              },
            },
          },
        });
        void this.read(this.client, generation);
      } catch {
        this.input.close();
        this.input = null;
        this.fail('start-failed');
        return false;
      }
    }
    this.deliver({ id: randomUUID(), role: 'user', parts: [{ type: 'text', text: text.trim() }], context, elements });
    return true;
  }

  private deliver(message: AgentChatMessage): void {
    const text = message.parts[0]?.type === 'text' ? message.parts[0].text : '';
    this.messages.push(message);
    this.setState({ ...this.view, status: 'thinking', error: null });
    this.input!.push({
      type: 'user',
      uuid: message.id as `${string}-${string}-${string}-${string}-${string}`,
      session_id: this.resumeId ?? '',
      parent_tool_use_id: null,
      message: { role: 'user', content: promptOf(text, message.context, message.elements) },
    });
    this.publish();
  }

  async interrupt(id: unknown): Promise<void> {
    if (id !== this.view.id || !['starting', 'thinking', 'approval'].includes(this.view.status)) return;
    this.queue = [];
    this.denyPermissions();
    if (!this.client) {
      this.stop();
      return;
    }
    const client = this.client;
    try {
      await client.interrupt();
    } catch {
      if (this.client === client) this.stop();
    }
  }

  respond(id: unknown, requestId: unknown, allow: unknown, answers: unknown, always: unknown = false): void {
    if (id !== this.view.id || typeof requestId !== 'string' || typeof allow !== 'boolean') return;
    const request = this.permissions.get(requestId);
    if (!request) return;
    let updatedInput = request.input;
    if (allow && request.view.questions.length) {
      if (!answers || typeof answers !== 'object' || Array.isArray(answers)) return;
      const selected: Record<string, string> = {};
      for (const question of request.view.questions) {
        const answer = (answers as Record<string, unknown>)[question.question];
        if (typeof answer !== 'string' || !answer.trim() || answer.length > 4096) return;
        selected[question.question] = answer;
      }
      updatedInput = { ...request.input, answers: selected };
    }
    if (!allow) {
      request.settle({ behavior: 'deny', message: 'The user declined this request in Yalqen.' });
      return;
    }
    if (always !== true || !request.view.canAlwaysAllow) {
      request.settle({ behavior: 'allow', updatedInput });
      return;
    }
    // "Always" lasts for this conversation only; Yalqen never writes the user's Claude settings files.
    const updatedPermissions = request.suggestions.map((update) => ({ ...update, destination: 'session' as const }));
    const mode = updatedPermissions.findLast((update) => update.type === 'setMode');
    if (mode?.type === 'setMode' && isPermissionMode(mode.mode))
      this.setState({ ...this.view, permissionMode: mode.mode });
    request.settle({ behavior: 'allow', updatedInput, updatedPermissions });
  }

  reset(id: unknown): void {
    if (id !== this.view.id) return;
    this.stop();
    this.messages = [];
    this.resumeId = undefined;
    this.costBase = 0;
    this.turnCost = 0;
    this.streamId = null;
    this.streamParts.clear();
    this.toolInput.clear();
    this.setState({ ...this.preferences(), directory: this.view.directory });
  }

  private preferences(): AgentChatState {
    const { modelChoice, effort, permissionMode, models } = this.view;
    return { ...EMPTY_AGENT_CHAT, modelChoice, effort, permissionMode, models };
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = null;
    this.messages = [];
    this.queue = [];
  }

  private stop(): void {
    ++this.generation;
    this.queue = [];
    this.costBase += this.turnCost;
    this.turnCost = 0;
    this.denyPermissions();
    const client = this.client;
    this.client = null;
    this.input?.close();
    this.input = null;
    client?.close();
    for (const message of this.messages)
      for (const part of message.parts) if (part.type === 'tool' && part.status === 'running') part.status = 'stopped';
    this.setState({ ...this.view, status: 'stopped' });
  }

  private askPermission: CanUseTool = (tool, input, { signal, title, decisionReason, suggestions = [] }) => {
    if (this.disposed || signal.aborted) return Promise.resolve({ behavior: 'deny', message: 'Session ended.' });
    const id = randomUUID();
    const questions: AgentChatPermission['questions'] = [];
    if (tool === 'AskUserQuestion' && Array.isArray(input.questions)) {
      for (const question of input.questions.slice(0, 4)) {
        if (typeof question?.question !== 'string' || !Array.isArray(question.options)) continue;
        questions.push({
          question: question.question.slice(0, 4096),
          multiSelect: question.multiSelect === true,
          options: question.options
            .filter((option: { label?: unknown }) => typeof option?.label === 'string')
            .slice(0, 8)
            .map((option: { label: string; description?: string }) => ({
              label: option.label.slice(0, 512),
              description: typeof option.description === 'string' ? option.description.slice(0, 2048) : '',
            })),
        });
      }
    }
    return new Promise((resolve) => {
      const settle = (result: PermissionResult) => {
        if (!this.permissions.delete(id)) return;
        signal.removeEventListener('abort', abort);
        resolve(result);
        if (!this.disposed) this.setState({ ...this.view, status: this.permissions.size ? 'approval' : 'thinking' });
      };
      const abort = () => settle({ behavior: 'deny', message: 'Request cancelled.' });
      this.permissions.set(id, {
        input,
        suggestions,
        settle,
        view: {
          id,
          tool,
          title: (title ?? decisionReason ?? tool).slice(0, 4096),
          input: jsonOf(input),
          plan: tool === 'ExitPlanMode' && typeof input.plan === 'string' ? input.plan.slice(0, MAX_TEXT) : null,
          questions,
          canAlwaysAllow: !questions.length && suggestions.length > 0,
        },
      });
      signal.addEventListener('abort', abort, { once: true });
      this.setState({ ...this.view, status: 'approval' });
    });
  };

  private denyPermissions(): void {
    for (const request of this.permissions.values())
      request.settle({ behavior: 'deny', message: 'Session interrupted.' });
  }

  private async read(client: ChatQuery, generation: number): Promise<void> {
    try {
      for await (const message of client) {
        if (this.disposed || generation !== this.generation) return;
        if ('parent_tool_use_id' in message && message.parent_tool_use_id) continue;
        if (message.type === 'system' && message.subtype === 'init') {
          this.resumeId = message.session_id;
          this.setState({
            ...this.view,
            model: message.model,
            permissionMode: isPermissionMode(message.permissionMode)
              ? message.permissionMode
              : this.view.permissionMode,
          });
          if (!this.view.models.length) void this.loadModels(client, generation);
        } else if (message.type === 'system' && message.subtype === 'status') {
          if (isPermissionMode(message.permissionMode) && message.permissionMode !== this.view.permissionMode)
            this.setState({ ...this.view, permissionMode: message.permissionMode });
        } else if (message.type === 'stream_event') this.stream(message);
        else if (message.type === 'assistant') {
          const entry = this.assistant(message.message.id);
          for (const block of message.message.content) {
            if (block.type === 'text') {
              const existing = entry.parts.findLast((part) => part.type === 'text' && block.text.startsWith(part.text));
              if (existing?.type === 'text') existing.text = block.text.slice(0, MAX_TEXT);
              else entry.parts.push({ type: 'text', text: block.text.slice(0, MAX_TEXT) });
            } else if (block.type === 'tool_use') {
              const existing = entry.parts.find((part) => part.type === 'tool' && part.id === block.id);
              if (existing?.type === 'tool') existing.input = jsonOf(block.input);
              else
                entry.parts.push({
                  type: 'tool',
                  id: block.id,
                  name: block.name,
                  input: jsonOf(block.input),
                  output: '',
                  status: 'running',
                });
            }
          }
          if (message.error)
            this.fail(message.error === 'authentication_failed' ? 'authentication-required' : 'request-failed');
          this.changed();
        } else if (message.type === 'user' && Array.isArray(message.message.content)) {
          for (const block of message.message.content) {
            if (block.type !== 'tool_result') continue;
            for (const entry of this.messages)
              for (const part of entry.parts) {
                if (part.type === 'tool' && part.id === block.tool_use_id) {
                  part.output = textOf(block.content);
                  part.status = block.is_error ? 'error' : 'done';
                }
              }
          }
          this.changed();
        } else if (message.type === 'result') {
          const lastUser = this.messages.findLastIndex((entry) => entry.role === 'user');
          if (
            message.subtype === 'success' &&
            message.result &&
            !this.messages
              .slice(lastUser + 1)
              .some((entry) => entry.parts.some((part) => part.type === 'text' && part.text))
          ) {
            this.assistant(randomUUID()).parts.push({ type: 'text', text: message.result.slice(0, MAX_TEXT) });
          }
          this.denyPermissions();
          this.turnCost = message.total_cost_usd;
          this.view = { ...this.view, usage: { ...this.usage(), cost: this.costBase + this.turnCost } };
          void this.loadContextUsage(client, generation);
          if (message.is_error) {
            this.queue = [];
            this.fail(this.view.error ?? 'request-failed');
          } else {
            const next = this.queue.shift();
            if (next) this.deliver(next);
            else this.setState({ ...this.view, status: 'ready', error: null });
          }
        }
      }
      if (!this.disposed && generation === this.generation) this.stop();
    } catch {
      if (!this.disposed && generation === this.generation) {
        this.stop();
        this.fail('request-failed');
      }
    }
  }

  private usage(): NonNullable<AgentChatState['usage']> {
    return this.view.usage ?? { cost: this.costBase, contextTokens: null, contextLimit: null };
  }

  private async loadModels(client: ChatQuery, generation: number): Promise<void> {
    try {
      const models = (await client.supportedModels()).slice(0, 20).map((model) => ({
        value: model.value.slice(0, 200),
        label: (model.displayName || model.value).slice(0, 200),
        efforts: (model.supportedEffortLevels ?? []).filter((effort) => EFFORTS.includes(effort)),
      }));
      if (!this.disposed && generation === this.generation) this.setState({ ...this.view, models });
    } catch {}
  }

  private async loadContextUsage(client: ChatQuery, generation: number): Promise<void> {
    try {
      const { totalTokens, maxTokens } = await client.getContextUsage({ detail: 'summary' });
      if (this.disposed || generation !== this.generation) return;
      this.setState({ ...this.view, usage: { ...this.usage(), contextTokens: totalTokens, contextLimit: maxTokens } });
    } catch {}
  }

  private assistant(id: string): AgentChatMessage {
    let entry = this.messages.find((message) => message.id === id && message.role === 'assistant');
    if (!entry) {
      entry = { id, role: 'assistant', parts: [], context: null, elements: [] };
      this.messages.push(entry);
    }
    return entry;
  }

  private stream(message: Extract<SDKMessage, { type: 'stream_event' }>): void {
    const event = message.event;
    if (event.type === 'message_start') {
      this.streamId = event.message.id;
      this.streamParts.clear();
      this.toolInput.clear();
    } else if (event.type === 'content_block_start' && this.streamId) {
      const block = event.content_block;
      let part: AgentChatPart | undefined;
      if (block.type === 'text') part = { type: 'text', text: block.text };
      else if (block.type === 'tool_use')
        part = {
          type: 'tool',
          id: block.id,
          name: block.name,
          input: jsonOf(block.input),
          output: '',
          status: 'running',
        };
      if (part) {
        this.assistant(this.streamId).parts.push(part);
        this.streamParts.set(event.index, part);
      }
    } else if (event.type === 'content_block_delta') {
      const part = this.streamParts.get(event.index);
      if (part?.type === 'text' && event.delta.type === 'text_delta')
        part.text = (part.text + event.delta.text).slice(0, MAX_TEXT);
      else if (part?.type === 'tool' && event.delta.type === 'input_json_delta') {
        const input = ((this.toolInput.get(event.index) ?? '') + event.delta.partial_json).slice(0, MAX_TEXT);
        this.toolInput.set(event.index, input);
        part.input = input;
      }
    }
    this.changed();
  }

  private fail(error: AgentChatState['error']): void {
    this.setState({ ...this.view, status: 'error', error });
  }

  private setState(state: AgentChatState): void {
    this.view = state;
    if (!this.disposed) this.options.onState();
    this.publish();
  }

  private changed(): void {
    if (!this.disposed) this.updateTimer ??= setTimeout(() => this.publish(), 32);
  }

  private publish(): void {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = null;
    if (this.disposed) return;
    let length = this.messages.reduce((total, message) => total + JSON.stringify(message).length, 0);
    while (this.messages.length > MAX_MESSAGES || (length > MAX_HISTORY && this.messages.length > 2))
      length -= JSON.stringify(this.messages.shift()!).length;
    ++this.revision;
    this.options.onUpdate(this.snapshot());
  }
}
