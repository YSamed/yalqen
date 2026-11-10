// Web mail and chat apps have no standard way to tell the browser about unread items outside installed web
// apps (the Badging API), so the count is read from the page title, where these sites already put it.

// "3", "1,234", "1.024" or "1 234", as sites format the count in their language; "99+" counts as 99.
const NUMBER = String.raw`\d[\d.,\u00a0\u202f ]*\+?`;
// Gmail puts the count after the folder name: "Inbox (3) - someone@gmail.com - Gmail".
const IN_PARENTHESES = new RegExp(String.raw`\((${NUMBER})\)`);
// Most chat and social sites put it in front of the title: "(3) WhatsApp", "(12) Feed | LinkedIn".
const LEADING = new RegExp(String.raw`^\s*\((${NUMBER})\)\s`);
// Gmail's hash for an open conversation ends with its id, e.g. "#inbox/FMfcgzQjgqNpSrLP…".
const GMAIL_CONVERSATION = /^#[^?]*\/[A-Za-z0-9]{16,}$/;

interface UnreadSite {
  // The site's domain; its subdomains match too.
  domains: string[];
  count(url: URL, title: string, previous: number | null): number;
}

function parse(match: RegExpExecArray | null): number {
  const digits = match?.[1].replace(/\D/g, '') ?? '';
  return digits ? Number(digits) : 0;
}

const leading = (_url: URL, title: string) => parse(LEADING.exec(title));

// Only sites known to put their unread count in the title are read, so a "(2)" in any other page's title,
// such as a product name or a forum thread, never shows as unread.
const SITES: UnreadSite[] = [
  {
    domains: ['mail.google.com'],
    count(url, title, previous) {
      if (!url.pathname.startsWith('/mail/')) return 0;
      // An open conversation is titled with its subject, which may hold any number; keep the folder's count.
      if (GMAIL_CONVERSATION.test(url.hash)) return previous ?? 0;
      // "<folder> - <account> - Gmail": only the folder part carries the count.
      return parse(IN_PARENTHESES.exec(title.split(' - ')[0]));
    },
  },
  { domains: ['web.whatsapp.com'], count: leading },
  { domains: ['messenger.com'], count: leading },
  { domains: ['facebook.com'], count: leading },
  { domains: ['instagram.com'], count: leading },
  { domains: ['linkedin.com'], count: leading },
  { domains: ['x.com', 'twitter.com'], count: leading },
  { domains: ['discord.com'], count: leading },
  { domains: ['mail.proton.me'], count: leading },
];

function siteFor(url: URL): UnreadSite | null {
  if (url.protocol !== 'https:') return null;
  const host = url.hostname;
  return SITES.find((site) => site.domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) ?? null;
}

// The unread count of a supported site, or null for any other page. `previous` is the tab's last count,
// which a site may keep showing while its title is about something else.
export function unreadCount(rawUrl: string, title: string, previous: number | null): number | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  return siteFor(url)?.count(url, title, previous) ?? null;
}
