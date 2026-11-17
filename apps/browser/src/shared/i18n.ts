import { en, type MessageKey } from './locales/en.js';
import { tr } from './locales/tr.js';

type Locale = 'en' | 'tr';
export type { MessageKey };

const MESSAGES: Record<Locale, Record<MessageKey, string>> = { en, tr };
let current: Locale = 'en';

export function pickLocale(languages: readonly (string | null | undefined)[]): Locale {
  for (const language of languages) {
    const base = language?.toLowerCase().split(/[-_]/)[0];
    if (base && base in MESSAGES) return base as Locale;
  }
  return 'en';
}

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const messages = MESSAGES[current];
  const singular = params?.count === 1 ? messages[`${key}.one` as MessageKey] : undefined;
  const message = singular ?? messages[key];
  if (!params) return message;
  return message.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}
