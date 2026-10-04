import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { hostOf, isDevelopmentHost } from '../../shared/hosts.js';
import { INTERNAL_SCHEME, type SecureDnsSetting } from '../../shared/types.js';

export const PROCEED_HTTP_URL = `${INTERNAL_SCHEME}://proceed-http/`;

const SECURE_DNS_SERVERS: Record<Exclude<SecureDnsSetting, 'off' | 'automatic'>, string> = {
  cloudflare: 'https://cloudflare-dns.com/dns-query',
  google: 'https://dns.google/dns-query{?dns}',
  quad9: 'https://dns.quad9.net/dns-query',
};

export function hostResolverOptions(setting: SecureDnsSetting): {
  secureDnsMode: 'off' | 'automatic' | 'secure';
  secureDnsServers?: string[];
} {
  if (setting === 'off' || setting === 'automatic') return { secureDnsMode: setting };
  return { secureDnsMode: 'secure', secureDnsServers: [SECURE_DNS_SERVERS[setting]] };
}

export function httpsUpgrade(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:') return null;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) || !host.includes('.') || isDevelopmentHost(host)) return null;
  parsed.protocol = 'https:';
  if (parsed.port === '80') parsed.port = '';
  return parsed.toString();
}

export class HttpsOnly {
  private readonly allowed = new Set<string>();
  private readonly warnings = new Map<string, { https: string; http: string }>();

  constructor(private readonly enabled: () => boolean) {}

  upgrade(url: string): string | null {
    if (!this.enabled() || this.allowed.has(hostOf(url) ?? '')) return null;
    return httpsUpgrade(url);
  }

  warn(https: string, http: string): string {
    for (const [token, warning] of this.warnings) {
      if (warning.https === https) this.warnings.delete(token);
    }
    const token = randomUUID();
    this.warnings.set(token, { https, http });
    return token;
  }

  proceed(token: string, currentUrl: string): string | null {
    const warning = this.warnings.get(token);
    if (!warning || warning.https !== currentUrl) return null;
    this.warnings.delete(token);
    this.allowHost(warning.http);
    return warning.http;
  }

  allowHost(url: string): void {
    const host = hostOf(url);
    if (host) this.allowed.add(host);
  }
}
