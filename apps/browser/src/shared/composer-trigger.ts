export interface ComposerTrigger {
  kind: 'command' | 'mention';
  query: string;
  start: number;
  end: number;
}

export function findTrigger(text: string, caret: number): ComposerTrigger | null {
  const before = text.slice(0, caret);
  const command = /^\/(\S*)$/.exec(before);
  if (command) return { kind: 'command', query: command[1], start: 0, end: caret };
  const mention = /(?:^|\s)@(\S*)$/.exec(before);
  if (mention) return { kind: 'mention', query: mention[1], start: caret - mention[1].length - 1, end: caret };
  return null;
}

export function complete(text: string, trigger: ComposerTrigger, replacement: string): { text: string; caret: number } {
  const after = text.slice(trigger.end).replace(/^\S*/, '');
  const spaced = replacement && !after.startsWith(' ') ? `${replacement} ` : replacement;
  return { text: text.slice(0, trigger.start) + spaced + after, caret: trigger.start + spaced.length };
}
