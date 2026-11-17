import type { Session } from 'electron';
import { signInUserAgent } from '../app/page-preferences.js';

const SIGN_IN_URLS = ['https://accounts.google.com/*'];

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
  session.webRequest.onBeforeSendHeaders({ urls: SIGN_IN_URLS }, ({ url, requestHeaders }, callback) =>
    callback({ requestHeaders: signInRequestHeaders(url, requestHeaders, process.platform) ?? requestHeaders }),
  );
}
