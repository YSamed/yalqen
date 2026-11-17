import { siteOf } from '../privacy/third-party-cookies.js';

const SIGN_IN_HOSTS = new Set([
  'accounts.google.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
]);
const SIGN_IN_DOMAINS = ['okta.com', 'oktapreview.com', 'auth0.com'];

function isSignIn(url: URL): boolean {
  if (SIGN_IN_HOSTS.has(url.hostname)) return true;
  if (url.hostname === 'github.com' && url.pathname.startsWith('/login/oauth')) return true;
  return SIGN_IN_DOMAINS.some((domain) => url.hostname.endsWith(`.${domain}`));
}

export function leavesPinnedSite(pinnedUrl: string, target: string): boolean {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const home = siteOf(pinnedUrl);
  const destination = siteOf(target);
  if (!home || !destination || home === destination) return false;
  return !isSignIn(url);
}
