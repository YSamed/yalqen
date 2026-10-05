import type { AgentChatMessage } from '../../shared/types.js';

const MAX_MESSAGE = 1200;
const MAX_DIGEST = 8000;

export interface DigestLabels {
  user: string;
  assistant: string;
  omitted: string;
}

// Built from the chat itself rather than by asking the model, so it is instant and free. The newest
// messages matter most for continuing, so older ones are dropped first when it runs long.
export function chatDigest(messages: readonly AgentChatMessage[], labels: DigestLabels): string {
  const entries = messages
    .filter((message) => !message.reverted)
    .map((message) => {
      const text = message.parts
        .map((part) => (part.type === 'text' ? part.text.trim() : ''))
        .filter(Boolean)
        .join('\n');
      if (!text) return null;
      const clipped = text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE)}…` : text;
      return `${message.role === 'user' ? labels.user : labels.assistant}: ${clipped}`;
    })
    .filter((entry) => entry !== null);
  const kept: string[] = [];
  let length = 0;
  for (const entry of [...entries].reverse()) {
    if (length + entry.length > MAX_DIGEST && kept.length > 0) break;
    kept.unshift(entry);
    length += entry.length + 2;
  }
  if (kept.length < entries.length) kept.unshift(labels.omitted);
  return kept.join('\n\n');
}
