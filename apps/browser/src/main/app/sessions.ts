import { nativeTheme, session, type Session } from 'electron';
import type { PageLanguage } from '../../shared/types.js';
import { forgetCertificates, rememberCertificates } from '../privacy/certificate-details.js';
import { rewriteSignInHeaders } from '../privacy/sign-in-headers.js';
import { setThirdPartyCookieBlocking } from '../privacy/third-party-cookies.js';
import { acceptLanguages, spellCheckerLanguages } from './page-preferences.js';

interface BrowsingSessions {
  daily: Session;
  privateBrowsing: Session;
  developer: Session;
  spaces: Map<string, Session>;
}

export function openBrowsingSessions(): BrowsingSessions {
  const sessions = {
    daily: session.fromPartition('persist:daily'),
    privateBrowsing: session.fromPartition('private'),
    developer: session.fromPartition('developer'),
    spaces: new Map<string, Session>(),
  };
  for (const browsing of eachSession(sessions)) prepareSession(browsing);
  return sessions;
}

export function openSpaceSession(sessions: BrowsingSessions, partition: string): Session {
  const browsing = session.fromPartition(partition);
  sessions.spaces.set(partition, browsing);
  prepareSession(browsing);
  return browsing;
}

function prepareSession(browsing: Session): void {
  rewriteSignInHeaders(browsing);
  rememberCertificates(browsing);
}

export function eachSession({ daily, privateBrowsing, developer, spaces }: BrowsingSessions): Session[] {
  return [daily, privateBrowsing, developer, ...spaces.values()];
}

export function isRegularSession({ daily, spaces }: BrowsingSessions, browsing: Session): boolean {
  return browsing === daily || [...spaces.values()].includes(browsing);
}

export function applyPageLanguage(sessions: BrowsingSessions, language: PageLanguage): void {
  for (const browsing of eachSession(sessions)) {
    browsing.setUserAgent(browsing.getUserAgent(), acceptLanguages(language));
    if (process.platform !== 'darwin') browsing.setSpellCheckerLanguages(spellCheckerLanguages(language));
  }
}

export function applyCookieBlocking(
  { daily, privateBrowsing, developer, spaces }: BrowsingSessions,
  enabled: boolean,
  allowed: (url: string, isPrivate: boolean) => boolean = () => false,
): void {
  const darkColors = () => nativeTheme.shouldUseDarkColors;
  for (const regular of [daily, ...spaces.values()])
    setThirdPartyCookieBlocking(regular, enabled, (url) => allowed(url, false), darkColors);
  setThirdPartyCookieBlocking(privateBrowsing, enabled, (url) => allowed(url, true), darkColors);
  setThirdPartyCookieBlocking(developer, false);
}

export function forgetSessionData(browsing: Session): void {
  void browsing.clearStorageData();
  void browsing.clearCache();
  void browsing.clearAuthCache();
  void browsing.closeAllConnections();
  forgetCertificates(browsing);
}
