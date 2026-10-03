import { session, type Session } from 'electron';
import type { PageLanguage } from '../../shared/types.js';
import { setThirdPartyCookieBlocking } from '../privacy/third-party-cookies.js';
import { acceptLanguages, spellCheckerLanguages } from './page-preferences.js';

export interface BrowsingSessions {
  daily: Session;
  privateBrowsing: Session;
  developer: Session;
}

export function openBrowsingSessions(): BrowsingSessions {
  return {
    daily: session.fromPartition('persist:daily'),
    privateBrowsing: session.fromPartition('private'),
    developer: session.fromPartition('developer'),
  };
}

export function eachSession({ daily, privateBrowsing, developer }: BrowsingSessions): Session[] {
  return [daily, privateBrowsing, developer];
}

export function applyPageLanguage(sessions: BrowsingSessions, language: PageLanguage): void {
  for (const browsing of eachSession(sessions)) {
    browsing.setUserAgent(browsing.getUserAgent(), acceptLanguages(language));
    if (process.platform !== 'darwin') browsing.setSpellCheckerLanguages(spellCheckerLanguages(language));
  }
}

export function applyCookieBlocking({ daily, privateBrowsing, developer }: BrowsingSessions, enabled: boolean): void {
  setThirdPartyCookieBlocking(daily, enabled);
  setThirdPartyCookieBlocking(privateBrowsing, enabled);
  setThirdPartyCookieBlocking(developer, false);
}

export function forgetSessionData(browsing: Session): void {
  void browsing.clearStorageData();
  void browsing.clearCache();
  void browsing.clearAuthCache();
  void browsing.closeAllConnections();
}
