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

const FIREFOX_PLATFORMS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'Macintosh; Intel Mac OS X 10.15',
  win32: 'Windows NT 10.0; Win64; x64',
};

// Google sign-in rejects embedded Chromium after the email step even with a clean Chrome user agent,
// but accepts Firefox, which also stops the Chromium client hints a bare user agent override drops.
export function signInUserAgent(url: string, platform: NodeJS.Platform): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  if (hostname !== 'accounts.google.com') return null;
  const system = FIREFOX_PLATFORMS[platform] ?? 'X11; Linux x86_64';
  return `Mozilla/5.0 (${system}; rv:150.0) Gecko/20100101 Firefox/150.0`;
}

export function spellCheckerLanguages(language: PageLanguage): string[] {
  return language === 'en' ? ['en-US', 'tr'] : ['tr', 'en-US'];
}
