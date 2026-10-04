import type { AgentChatMessage, AgentChatPart, AgentChatSession } from '../../shared/types.js';

const MAX_TEXT = 64 * 1024;
const MAX_TITLE = 200;

interface StoredMessage {
  type: 'user' | 'assistant' | 'system';
  uuid: string;
  message: unknown;
  parent_tool_use_id: string | null;
}

interface StoredSession {
  sessionId: string;
  summary: string;
  lastModified: number;
  customTitle?: string;
  firstPrompt?: string;
  gitBranch?: string;
}

type Block = { type?: unknown; text?: unknown; id?: unknown; name?: unknown; input?: unknown } & Record<
  string,
  unknown
>;

function blocksOf(message: unknown): { id: string | null; content: string | Block[] } | null {
  if (!message || typeof message !== 'object') return null;
  const { id, content } = message as { id?: unknown; content?: unknown };
  if (typeof content !== 'string' && !Array.isArray(content)) return null;
  return { id: typeof id === 'string' ? id : null, content: content as string | Block[] };
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

// Prompts carry the browser context Yalqen appended; the stored conversation shows only what the user typed.
function userText(text: string): string {
  return text.replace(/^\[The user reverted[^\]]*\]\n\n/, '').split('\n\nYalqen ')[0];
}

function message(id: string, role: AgentChatMessage['role'], parts: AgentChatPart[]): AgentChatMessage {
  return { id, role, parts, context: null, elements: [], episode: null, images: [], reverted: false };
}

export function sessionOf(session: StoredSession): AgentChatSession {
  const title = (session.customTitle || session.summary || session.firstPrompt || session.sessionId).trim();
  return {
    id: session.sessionId,
    title: title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title,
    updatedAt: session.lastModified,
    branch: session.gitBranch ?? null,
  };
}

export function historyMessages(stored: readonly StoredMessage[], limit: number): AgentChatMessage[] {
  const messages: AgentChatMessage[] = [];
  const tools = new Map<string, Extract<AgentChatPart, { type: 'tool' }>>();
  for (const entry of stored) {
    if (entry.parent_tool_use_id) continue;
    const body = blocksOf(entry.message);
    if (!body) continue;
    if (entry.type === 'user') {
      if (Array.isArray(body.content))
        for (const block of body.content) {
          if (block?.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
          const part = tools.get(block.tool_use_id);
          if (!part) continue;
          part.output = textOf(block.content).slice(0, MAX_TEXT);
          part.status = block.is_error ? 'error' : 'done';
        }
      const text = userText(textOf(body.content)).trim();
      if (text) messages.push(message(entry.uuid, 'user', [{ type: 'text', text: text.slice(0, MAX_TEXT) }]));
    } else if (entry.type === 'assistant' && Array.isArray(body.content)) {
      const id = body.id ?? entry.uuid;
      const previous = messages.at(-1);
      const target = previous?.role === 'assistant' && previous.id === id ? previous : message(id, 'assistant', []);
      for (const block of body.content) {
        if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim())
          target.parts.push({ type: 'text', text: block.text.slice(0, MAX_TEXT) });
        else if (block?.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
          const part: Extract<AgentChatPart, { type: 'tool' }> = {
            type: 'tool',
            id: block.id,
            name: block.name,
            input: JSON.stringify(block.input, null, 2)?.slice(0, MAX_TEXT) ?? '',
            output: '',
            status: 'stopped',
            verification: null,
            task: null,
            steps: [],
          };
          tools.set(block.id, part);
          target.parts.push(part);
        }
      }
      if (target !== previous && target.parts.length) messages.push(target);
    }
  }
  return messages.slice(-limit);
}
