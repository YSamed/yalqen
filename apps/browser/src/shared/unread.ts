const NUMBER = String.raw`\d[\d.,\u00a0\u202f ]*\+?`;
const IN_PARENTHESES = new RegExp(String.raw`\((${NUMBER})\)`);
const LEADING = new RegExp(String.raw`^\s*\((${NUMBER})\)\s`);
const GMAIL_CONVERSATION = /^#[^?]*\/[A-Za-z0-9]{16,}$/;

interface UnreadSite {
  domains: string[];
  count(url: URL, title: string, previous: number | null): number;
}

function parse(match: RegExpExecArray | null): number {
  const digits = match?.[1].replace(/\D/g, '') ?? '';
  return digits ? Number(digits) : 0;
}

const leading = (_url: URL, title: string) => parse(LEADING.exec(title));

const SITES: UnreadSite[] = [
  {
    domains: ['mail.google.com'],
    count(url, title, previous) {
      if (!url.pathname.startsWith('/mail/')) return 0;
      if (GMAIL_CONVERSATION.test(url.hash)) return previous ?? 0;
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

export function unreadCount(rawUrl: string, title: string, previous: number | null): number | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  return siteFor(url)?.count(url, title, previous) ?? null;
}
