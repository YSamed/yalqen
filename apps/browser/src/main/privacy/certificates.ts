import { randomUUID } from 'node:crypto';
import { app, type Session } from 'electron';
import { INTERNAL_SCHEME } from '../../shared/types.js';

export const PROCEED_URL = `${INTERNAL_SCHEME}://proceed/`;

function httpsHost(url: string): string | null {
  try {
    const { protocol, host } = new URL(url);
    return protocol === 'https:' && host !== '' ? host : null;
  } catch {
    return null;
  }
}

interface Rejected {
  url: string;
  host: string;
  fingerprint: string;
}

export class CertificateExceptions {
  private readonly allowed = new Map<string, string>();
  private readonly rejected = new Map<string, Rejected>();

  allows(url: string, fingerprint: string): boolean {
    const host = httpsHost(url);
    return host !== null && this.allowed.get(host) === fingerprint;
  }

  hasException(url: string): boolean {
    const host = httpsHost(url);
    return host !== null && this.allowed.has(host);
  }

  reject(url: string, fingerprint: string): string | null {
    const host = httpsHost(url);
    if (!host) return null;
    for (const [token, entry] of this.rejected) {
      if (entry.url === url) this.rejected.delete(token);
    }
    const token = randomUUID();
    this.rejected.set(token, { url, host, fingerprint });
    return token;
  }

  tokenFor(url: string): string | null {
    for (const [token, entry] of this.rejected) {
      if (entry.url === url) return token;
    }
    return null;
  }

  proceed(token: string, url: string): boolean {
    const entry = this.rejected.get(token);
    if (!entry || entry.url !== url) return false;
    this.rejected.delete(token);
    this.allowed.set(entry.host, entry.fingerprint);
    return true;
  }

  revoke(url: string): void {
    const host = httpsHost(url);
    if (host) this.allowed.delete(host);
  }
}

export function handleCertificateErrors(exceptions: CertificateExceptions, sessions: readonly Session[]): void {
  app.on('certificate-error', (event, contents, url, _error, certificate, callback, isMainFrame) => {
    const browsing = sessions.includes(contents.session);
    if (browsing && exceptions.allows(url, certificate.fingerprint)) {
      event.preventDefault();
      callback(true);
      return;
    }
    if (browsing && isMainFrame) exceptions.reject(url, certificate.fingerprint);
    callback(false);
  });
}
