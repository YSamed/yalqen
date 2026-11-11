import { siteOf } from '../privacy/third-party-cookies.js';

// Sign-in pages a pinned app sends the user to and back from; following them in a new tab would break the login.
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

// With "Keep pinned tabs on their site" on, a pinned tab stays on the site it was pinned at: a page on another
// site opens in a new tab instead. The same site includes its subdomains, such as mail.google.com and
// accounts.google.com, and only http(s) pages leave; other schemes are handled as before.
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
