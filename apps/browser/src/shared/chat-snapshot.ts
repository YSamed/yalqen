import type { AgentChatSnapshot } from './types';

function reuse<T>(previous: unknown, next: T): T {
  if (typeof next !== 'object' || next === null || typeof previous !== 'object' || previous === null) return next;
  if (Array.isArray(next) !== Array.isArray(previous)) return next;
  const before = previous as Record<string, unknown>;
  const entries = Object.entries(next).map(([key, value]) => [key, reuse(before[key], value)] as const);
  if (entries.length === Object.keys(before).length && entries.every(([key, value]) => value === before[key]))
    return previous as T;
  return (Array.isArray(next) ? entries.map(([, value]) => value) : Object.fromEntries(entries)) as T;
}

// Every update carries the whole transcript as new objects. Keeping the unchanged messages and
// parts lets the chat skip them, so a streamed reply re-renders only its own text.
export function reuseChatSnapshot(previous: AgentChatSnapshot, next: AgentChatSnapshot): AgentChatSnapshot {
  const messages = new Map(previous.messages.map((message) => [message.id, message]));
  return {
    ...next,
    messages: next.messages.map((message) => reuse(messages.get(message.id), message)),
    queue: reuse(previous.queue, next.queue),
    permissions: reuse(previous.permissions, next.permissions),
  };
}
