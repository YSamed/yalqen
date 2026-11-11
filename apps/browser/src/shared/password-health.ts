import type { PasswordIssue } from './types.js';

const OLD_AFTER_MS = 365 * 24 * 60 * 60 * 1000;
const COMMON = new Set(['password', 'passw0rd', 'qwertyui', 'qwerty123', 'letmein1', 'iloveyou', 'welcome1']);

export function isWeakPassword(password: string): boolean {
  if (password.length < 8 || new Set(password).size < 4) return true;
  if (COMMON.has(password.toLowerCase()) || /^\d+$/.test(password)) return true;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^a-zA-Z\d]/].filter((pattern) => pattern.test(password)).length;
  return password.length < 12 && classes < 3;
}

export function passwordIssues(
  entries: readonly { id: string; password: string; updatedAt: number }[],
  now: number,
): Map<string, PasswordIssue[]> {
  const uses = new Map<string, number>();
  for (const { password } of entries) uses.set(password, (uses.get(password) ?? 0) + 1);
  return new Map(
    entries.map(({ id, password, updatedAt }) => {
      const issues: PasswordIssue[] = [];
      if (isWeakPassword(password)) issues.push('weak');
      if ((uses.get(password) ?? 0) > 1) issues.push('reused');
      if (now - updatedAt > OLD_AFTER_MS) issues.push('old');
      return [id, issues];
    }),
  );
}
