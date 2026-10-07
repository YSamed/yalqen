import type { SavedLoginChoice } from './types.js';

export function selectLogin(choices: readonly SavedLoginChoice[], username: string): SavedLoginChoice | undefined {
  const typed = username.trim();
  if (typed) return choices.find((choice) => choice.username === typed);
  return choices.length === 1 ? choices[0] : undefined;
}
