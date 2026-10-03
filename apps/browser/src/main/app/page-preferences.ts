import type { FontSizeSetting, PageLanguage } from '../../shared/types.js';

export const FONT_SIZES: Record<FontSizeSetting, number> = { small: 12, medium: 16, large: 20, xlarge: 24 };

export function fontPreferences(setting: FontSizeSetting): {
  defaultFontSize: number;
  defaultMonospaceFontSize: number;
} {
  const size = FONT_SIZES[setting];
  return { defaultFontSize: size, defaultMonospaceFontSize: Math.round((size * 13) / 16) };
}

export function acceptLanguages(language: PageLanguage): string {
  return language === 'en' ? 'en-US,en,tr-TR,tr' : 'tr-TR,tr,en-US,en';
}

// Bot protection (e.g. sahibinden.com) blocks user agents carrying the app and Electron tokens
// Electron adds, so pages see the same user agent as Chrome.
export function chromeUserAgent(userAgent: string): string {
  return userAgent.replace(/ Electron\/\S+/, '').replace(/(\(KHTML, like Gecko\)) (?!Chrome\/)\S+/, '$1');
}

export function spellCheckerLanguages(language: PageLanguage): string[] {
  return language === 'en' ? ['en-US', 'tr'] : ['tr', 'en-US'];
}
