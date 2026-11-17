import type { PageLanguage } from '../../shared/types.js';

export function acceptLanguages(language: PageLanguage): string {
  return language === 'en' ? 'en-US,en,tr-TR,tr' : 'tr-TR,tr,en-US,en';
}

export function chromeUserAgent(userAgent: string): string {
  return userAgent.replace(/ Electron\/\S+/, '').replace(/(\(KHTML, like Gecko\)) (?!Chrome\/)\S+/, '$1');
}

const FIREFOX_PLATFORMS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'Macintosh; Intel Mac OS X 10.15',
  win32: 'Windows NT 10.0; Win64; x64',
};

const FIREFOX_145_RELEASE = Date.UTC(2025, 10, 11);
const FIREFOX_RELEASE_INTERVAL_MS = 28 * 24 * 60 * 60 * 1000;

export function firefoxVersion(now: number): number {
  return 145 + Math.max(0, Math.floor((now - FIREFOX_145_RELEASE) / FIREFOX_RELEASE_INTERVAL_MS));
}

export function signInUserAgent(url: string, platform: NodeJS.Platform, now = Date.now()): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  if (hostname !== 'accounts.google.com') return null;
  const system = FIREFOX_PLATFORMS[platform] ?? 'X11; Linux x86_64';
  const version = firefoxVersion(now);
  return `Mozilla/5.0 (${system}; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`;
}

export function spellCheckerLanguages(language: PageLanguage): string[] {
  return language === 'en' ? ['en-US', 'tr'] : ['tr', 'en-US'];
}
