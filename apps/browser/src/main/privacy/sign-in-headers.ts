import type { Session } from 'electron';
import { HEADER_STAGE, setSendStage } from './header-stages.js';
import { signInUserAgent } from '../app/page-preferences.js';

const SIGN_IN_ORIGIN = 'https://accounts.google.com/';

export function signInRequestHeaders(
  url: string,
  headers: Record<string, string>,
  platform: NodeJS.Platform,
): Record<string, string> | null {
  const userAgent = signInUserAgent(url, platform);
  if (!userAgent) return null;
  const rewritten: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const name = key.toLowerCase();
    if (name !== 'user-agent' && !name.startsWith('sec-ch-ua')) rewritten[key] = value;
  }
  rewritten['User-Agent'] = userAgent;
  return rewritten;
}

export function rewriteSignInHeaders(session: Session): void {
  setSendStage(session, HEADER_STAGE.signIn, ({ url }, headers) =>
    url.startsWith(SIGN_IN_ORIGIN) ? signInRequestHeaders(url, headers, process.platform) : null,
  );
}
