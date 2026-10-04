import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import type * as acp from '@agentclientprotocol/sdk';
import type { CanUseTool, Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import type { ChatQuery, Client } from './agent-chat.js';
import { findCommand } from './shell-command.js';

const MAX_TEXT = 64 * 1024;
const KILL_DELAY_MS = 1500;

export interface AcpAgent {
  label: string;
  command: string;
  args(executable: string): Promise<string[]>;
}

type ToolCall = acp.ToolCall | acp.ToolCallUpdate;
type Connection = Pick<acp.ClientSideConnection, 'initialize' | 'newSession' | 'prompt' | 'cancel'>;
type Connect = (toClient: () => acp.Client, child: ChildProcess) => Promise<Connection>;

class Outbox implements AsyncIterable<SDKMessage> {
  private items: SDKMessage[] = [];
  private waiter: ((result: IteratorResult<SDKMessage>) => void) | null = null;
  private ended = false;

  push(message: object): void {
    if (this.ended) return;
    if (this.waiter) {
      const waiter = this.waiter;
      this.waiter = null;
      waiter({ value: message as SDKMessage, done: false });
    } else this.items.push(message as SDKMessage);
  }

  end(): void {
    this.ended = true;
    this.waiter?.({ value: undefined, done: true });
    this.waiter = null;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return {
      next: () => {
        const value = this.items.shift();
        if (value) return Promise.resolve({ value, done: false });
        if (this.ended) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => (this.waiter = resolve));
      },
    };
  }
}

async function connectProcess(toClient: () => acp.Client, child: ChildProcess): Promise<Connection> {
  const { ClientSideConnection, ndJsonStream } = await import('@agentclientprotocol/sdk');
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
  );
  return new ClientSideConnection(toClient, stream);
}

function contentText(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((item) => {
      if (item?.type === 'content' && item.content?.type === 'text') return item.content.text;
      if (item?.type === 'diff') return `${item.path}`;
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .slice(0, MAX_TEXT);
}

function promptBlocks(content: SDKUserMessage['message']['content'], images: boolean): acp.ContentBlock[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  const blocks: acp.ContentBlock[] = [];
  for (const block of content) {
    if (block.type === 'text') blocks.push({ type: 'text', text: block.text });
    else if (images && block.type === 'image' && block.source.type === 'base64')
      blocks.push({ type: 'image', mimeType: block.source.media_type, data: block.source.data });
  }
  return blocks;
}

export class AcpQuery implements ChatQuery {
  private outbox = new Outbox();
  private connection: Connection | null = null;
  private sessionId: string | null = null;
  private images = false;
  private messageId = randomUUID();
  private text = '';
  private tools = new Map<string, { name: string; input: unknown }>();
  private commands: acp.AvailableCommand[] = [];
  private turn: AbortController | null = null;
  private closed = false;

  constructor(
    private readonly agent: AcpAgent,
    private readonly child: ChildProcess,
    private readonly options: Options,
    prompt: AsyncIterable<SDKUserMessage>,
    connect: Connect,
  ) {
    child.once('exit', () => this.close());
    child.once('error', () => this.close());
    void this.run(prompt, connect);
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.outbox[Symbol.asyncIterator]();
  }

  async interrupt(): Promise<undefined> {
    this.turn?.abort();
    if (this.connection && this.sessionId) await this.connection.cancel({ sessionId: this.sessionId });
    return undefined;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.turn?.abort();
    this.outbox.end();
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill('SIGTERM');
      setTimeout(() => this.child.kill('SIGKILL'), KILL_DELAY_MS).unref();
    }
  }

  async setPermissionMode(): Promise<void> {}
  async setModel(): Promise<void> {}
  async applyFlagSettings(): Promise<void> {}
  async supportedModels() {
    return [];
  }
  async getContextUsage(): Promise<never> {
    throw new Error(`${this.agent.label} does not report context usage`);
  }
  async rewindFiles() {
    return { canRewind: false, error: `${this.agent.label} cannot undo file changes from Yalqen.` };
  }
  async supportedCommands() {
    return this.commands.map((command) => ({
      name: command.name,
      description: command.description,
      argumentHint: command.input && 'hint' in command.input ? command.input.hint : '',
    }));
  }

  private async run(prompt: AsyncIterable<SDKUserMessage>, connect: Connect): Promise<void> {
    try {
      const connection = await connect(() => this.client(), this.child);
      const { agentCapabilities } = await connection.initialize({
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      });
      this.images = agentCapabilities?.promptCapabilities?.image === true;
      const env = this.options.env ?? {};
      const mcpServers: acp.McpServer[] =
        agentCapabilities?.mcpCapabilities?.http && env.YALQEN_MCP_URL && env.YALQEN_MCP_TOKEN
          ? [
              {
                type: 'http',
                name: 'yalqen',
                url: env.YALQEN_MCP_URL,
                headers: [{ name: 'Authorization', value: `Bearer ${env.YALQEN_MCP_TOKEN}` }],
              },
            ]
          : [];
      const { sessionId } = await connection.newSession({ cwd: this.options.cwd ?? process.cwd(), mcpServers });
      this.connection = connection;
      this.sessionId = sessionId;
      this.outbox.push({
        type: 'system',
        subtype: 'init',
        session_id: sessionId,
        model: this.agent.label,
        permissionMode: 'default',
      });
      for await (const message of prompt) {
        if (this.closed) return;
        await this.prompt(connection, sessionId, message);
      }
    } catch {
      this.outbox.push({ type: 'result', subtype: 'error_during_execution', is_error: true, total_cost_usd: 0 });
    }
    this.close();
  }

  private async prompt(connection: Connection, sessionId: string, message: SDKUserMessage): Promise<void> {
    this.turn = new AbortController();
    this.messageId = randomUUID();
    this.text = '';
    try {
      const { stopReason } = await connection.prompt({
        sessionId,
        prompt: promptBlocks(message.message.content, this.images),
      });
      const failed = stopReason === 'refusal';
      this.outbox.push({ type: 'result', subtype: 'success', is_error: failed, result: '', total_cost_usd: 0 });
    } catch {
      this.outbox.push({ type: 'result', subtype: 'error_during_execution', is_error: true, total_cost_usd: 0 });
    } finally {
      this.turn = null;
    }
  }

  private client(): acp.Client {
    return {
      sessionUpdate: (notification) => this.update(notification),
      requestPermission: (request) => this.permission(request),
    };
  }

  private update({ update }: acp.SessionNotification): void {
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      this.text = (this.text + update.content.text).slice(0, MAX_TEXT);
      this.assistant([{ type: 'text', text: this.text }]);
    } else if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      this.tool(update);
    } else if (update.sessionUpdate === 'available_commands_update') {
      this.commands = update.availableCommands.slice(0, 200);
    }
  }

  private tool(call: ToolCall): void {
    this.text = '';
    const known = this.tools.get(call.toolCallId);
    const diff = call.content?.find((item) => item.type === 'diff');
    const name = known?.name ?? (call.kind === 'edit' || diff ? 'Edit' : call.title || call.kind || 'Tool');
    const input = diff
      ? { file_path: diff.path, old_string: diff.oldText ?? '', new_string: diff.newText }
      : (call.rawInput ?? known?.input ?? { title: call.title });
    this.tools.set(call.toolCallId, { name, input });
    this.assistant([{ type: 'tool_use', id: call.toolCallId, name, input }]);
    if (call.status === 'completed' || call.status === 'failed') {
      const output = contentText(call.content) || (call.rawOutput ? JSON.stringify(call.rawOutput) : '');
      this.outbox.push({
        type: 'user',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: call.toolCallId,
              content: output.slice(0, MAX_TEXT),
              is_error: call.status === 'failed',
            },
          ],
        },
      });
    }
  }

  private assistant(content: object[]): void {
    this.outbox.push({ type: 'assistant', parent_tool_use_id: null, message: { id: this.messageId, content } });
  }

  private async permission(request: acp.RequestPermissionRequest): Promise<acp.RequestPermissionResponse> {
    const canUseTool = this.options.canUseTool as CanUseTool | undefined;
    const pick = (...kinds: acp.PermissionOptionKind[]) =>
      kinds.map((kind) => request.options.find((option) => option.kind === kind)).find(Boolean);
    const always = pick('allow_always');
    const signal = this.turn?.signal ?? AbortSignal.abort();
    if (!canUseTool) return { outcome: { outcome: 'cancelled' } };
    const known = this.tools.get(request.toolCall.toolCallId);
    const result = await canUseTool(
      known?.name ?? request.toolCall.title ?? 'Tool',
      (request.toolCall.rawInput as Record<string, unknown>) ?? { title: request.toolCall.title },
      {
        signal,
        title: request.toolCall.title ?? undefined,
        toolUseID: request.toolCall.toolCallId,
        requestId: randomUUID(),
        // Any non-empty list lets the user pick "always"; the agent applies its own allow_always option.
        suggestions: always ? [{ type: 'addRules', rules: [], behavior: 'allow', destination: 'session' }] : [],
      } as unknown as Parameters<CanUseTool>[2],
    );
    const option =
      result?.behavior === 'allow'
        ? (result.updatedPermissions?.length && always) || pick('allow_once', 'allow_always')
        : pick('reject_once', 'reject_always');
    return option
      ? { outcome: { outcome: 'selected', optionId: option.optionId } }
      : { outcome: { outcome: 'cancelled' } };
  }
}

export function acpClient(agent: AcpAgent, connect: Connect = connectProcess): () => Promise<Client> {
  return async () => {
    const { executable, env } = await findCommand(agent.command);
    const args = await agent.args(executable);
    return {
      executable,
      env,
      query: ({ prompt, options }) => {
        const child = spawn(executable, args, {
          cwd: options.cwd,
          env: options.env,
          stdio: ['pipe', 'pipe', 'ignore'],
        });
        return new AcpQuery(agent, child, options, prompt, connect);
      },
    };
  };
}
