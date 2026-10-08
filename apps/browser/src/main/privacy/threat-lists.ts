import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { domainToASCII } from 'node:url';
import type { ThreatListsView } from '../../shared/types.js';

export const DOMAIN_FEED = 'https://hole.cert.pl/domains/v2/domains.txt';
export const HASH_FEED = 'https://raw.githubusercontent.com/Neo23x0/signature-base/master/iocs/hash-iocs.txt';
export const HASH_SOURCE = 'Signature-Base · Florian Roth / Nextron Systems (DRL 1.1)';
const MAX_BYTES = 32 * 1024 * 1024;
const MAX_ENTRIES = 500_000;
const DOMAIN_REFRESH_MS = 5 * 60 * 1000;
const HASH_REFRESH_MS = 24 * 60 * 60 * 1000;

export function parseThreatDomains(text: string): Set<string> {
  const domains = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    const domain = domainToASCII(value.toLowerCase());
    if (
      !domain ||
      domain.length > 253 ||
      !domain.includes('.') ||
      !domain.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    )
      throw new Error('Invalid domain list');
    domains.add(domain);
    if (domains.size > MAX_ENTRIES) throw new Error('Domain list too large');
  }
  if (!domains.size) throw new Error('Empty domain list');
  return domains;
}

export function parseThreatHashes(text: string): Set<string> {
  const hashes = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (!value || value.startsWith('#')) continue;
    const hash = value.split(';', 1)[0].trim().toLowerCase();
    if (!/^(?:[a-f0-9]{32}|[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash)) throw new Error('Invalid hash list');
    hashes.add(hash);
    if (hashes.size > MAX_ENTRIES) throw new Error('Hash list too large');
  }
  if (!hashes.size) throw new Error('Empty hash list');
  return hashes;
}

export function threatDomain(url: string, domains: ReadonlySet<string>): string | null {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) return null;
    let host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    while (host.includes('.')) {
      if (domains.has(host)) return host;
      host = host.slice(host.indexOf('.') + 1);
    }
  } catch {}
  return null;
}

async function boundedText(response: Response): Promise<string> {
  if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_BYTES)
    throw new Error('Threat list download failed');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new Error('Threat list too large');
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).toString('utf8');
}

export class LocalThreatLists {
  private domains = new Set<string>();
  private hashes = new Set<string>();
  private domainUpdatedAt: number | null = null;
  private hashUpdatedAt: number | null = null;
  private failed = false;
  private refresh: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly directory: string,
    private readonly enabled: () => boolean,
    private readonly changed: () => void = () => {},
    private readonly fetcher: typeof fetch = fetch,
  ) {
    for (const kind of ['domains', 'hashes'] as const) {
      try {
        const file = this.file(kind);
        const stat = fs.statSync(file);
        if (stat.size > MAX_BYTES) continue;
        const text = fs.readFileSync(file, 'utf8');
        if (kind === 'domains') {
          this.domains = parseThreatDomains(text);
          this.domainUpdatedAt = stat.mtimeMs;
        } else {
          this.hashes = parseThreatHashes(text);
          this.hashUpdatedAt = stat.mtimeMs;
        }
      } catch {}
    }
  }

  view(): ThreatListsView {
    return {
      domains: this.domains.size,
      hashes: this.hashes.size,
      domainUpdatedAt: this.domainUpdatedAt,
      hashUpdatedAt: this.hashUpdatedAt,
      updating: this.refresh !== null,
      failed: this.failed,
    };
  }

  start(): void {
    if (this.timer || this.stopped) return;
    this.timer = setInterval(() => {
      void this.update();
    }, DOMAIN_REFRESH_MS);
    this.timer.unref();
    void this.update();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  domain(url: string): string | null {
    return this.enabled() ? threatDomain(url, this.domains) : null;
  }

  async checkFile(file: string): Promise<string | null> {
    if (!this.enabled() || !this.hashes.size) return null;
    // Stream large downloads; URLs, file contents and hashes never leave this device.
    const algorithms = [createHash('md5'), createHash('sha1'), createHash('sha256')];
    for await (const chunk of fs.createReadStream(file)) for (const hash of algorithms) hash.update(chunk);
    for (const hash of algorithms) if (this.hashes.has(hash.digest('hex'))) return HASH_SOURCE;
    return null;
  }

  update(force = false): Promise<void> {
    if (this.refresh) return this.refresh;
    if (!this.enabled() || this.stopped) return Promise.resolve();
    const run = async () => {
      this.failed = false;
      await Promise.allSettled(
        (['domains', 'hashes'] as const).map(async (kind) => {
          const updatedAt = kind === 'domains' ? this.domainUpdatedAt : this.hashUpdatedAt;
          const interval = kind === 'domains' ? DOMAIN_REFRESH_MS : HASH_REFRESH_MS;
          if (!force && updatedAt !== null && Date.now() - updatedAt < interval) return;
          try {
            const text = await boundedText(
              await this.fetcher(kind === 'domains' ? DOMAIN_FEED : HASH_FEED, {
                signal: AbortSignal.timeout(30_000),
                credentials: 'omit',
                redirect: 'error',
              }),
            );
            const entries = kind === 'domains' ? parseThreatDomains(text) : parseThreatHashes(text);
            if (this.stopped) return;
            await fsp.mkdir(path.dirname(this.file(kind)), { recursive: true });
            const temp = `${this.file(kind)}.${randomUUID()}.tmp`;
            try {
              await fsp.writeFile(temp, text, { mode: 0o600, flag: 'wx' });
              await fsp.rename(temp, this.file(kind));
            } finally {
              await fsp.rm(temp, { force: true });
            }
            if (kind === 'domains') {
              this.domains = entries;
              this.domainUpdatedAt = Date.now();
            } else {
              this.hashes = entries;
              this.hashUpdatedAt = Date.now();
            }
          } catch {
            this.failed = true;
          }
        }),
      );
    };
    this.refresh = run().finally(() => {
      this.refresh = null;
      this.changed();
    });
    this.changed();
    return this.refresh;
  }

  private file(kind: string): string {
    return path.join(this.directory, 'threat-lists', `${kind}.txt`);
  }
}
