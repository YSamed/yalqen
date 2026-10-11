import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  DomainList,
  loadThreatDomains,
  MAX_ENTRIES,
  normalizeThreatDomains,
  type NormalizedDomains,
} from './threat-domains.js';
import type { ThreatListsView } from '../../shared/types.js';

export const DOMAIN_FEED = 'https://hole.cert.pl/domains/v2/domains.txt';
export const HASH_FEED = 'https://raw.githubusercontent.com/Neo23x0/signature-base/master/iocs/hash-iocs.txt';
export const HASH_SOURCE = 'Signature-Base · Florian Roth / Nextron Systems (DRL 1.1)';
const MAX_BYTES = 32 * 1024 * 1024;
const DOMAIN_REFRESH_MS = 5 * 60 * 1000;
const HASH_REFRESH_MS = 24 * 60 * 60 * 1000;

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

export { parseThreatDomains } from './threat-domains.js';

export function threatDomain(url: string, domains: Pick<ReadonlySet<string>, 'has'>): string | null {
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

async function boundedBytes(response: Response): Promise<Buffer> {
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
  return Buffer.concat(chunks);
}

function conditionalHeaders(response: Response): Record<string, string> {
  const etag = response.headers.get('etag');
  const modified = response.headers.get('last-modified');
  return { ...(etag && { 'If-None-Match': etag }), ...(modified && { 'If-Modified-Since': modified }) };
}

// The domain feed holds hundreds of thousands of entries; validating them on the main thread
// would freeze every window for a noticeable moment on each refresh.
function normalizeInWorker(bytes: Buffer): Promise<NormalizedDomains> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(path.join(__dirname, 'threat-domains-worker.js'));
    } catch {
      resolve(normalizeThreatDomains(bytes.toString('utf8')));
      return;
    }
    let settled = false;
    worker.once('message', (result: NormalizedDomains | { error: string }) => {
      settled = true;
      void worker.terminate();
      if ('error' in result) reject(new Error(result.error));
      else resolve(result);
    });
    worker.once('error', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(normalizeThreatDomains(bytes.toString('utf8')));
      } catch (error) {
        reject(error as Error);
      }
    });
    worker.postMessage(bytes);
  });
}

export class LocalThreatLists {
  private domains = new DomainList();
  private hashes = new Set<string>();
  private domainUpdatedAt: number | null = null;
  private hashUpdatedAt: number | null = null;
  private failed = false;
  private refresh: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  // Kept in memory only: a restart within the refresh interval reuses the cached file anyway.
  private readonly validators = new Map<'domains' | 'hashes', Record<string, string>>();

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
          const { text: normalized, starts } = loadThreatDomains(text);
          this.domains = new DomainList(normalized, starts);
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
            const validators = this.validators.get(kind);
            const response = await this.fetcher(kind === 'domains' ? DOMAIN_FEED : HASH_FEED, {
              signal: AbortSignal.timeout(30_000),
              credentials: 'omit',
              redirect: 'error',
              ...(validators && updatedAt !== null && { headers: validators }),
            });
            if (response.status === 304 && updatedAt !== null) {
              if (this.stopped) return;
              const now = new Date();
              await fsp.utimes(this.file(kind), now, now).catch(() => {});
              if (kind === 'domains') this.domainUpdatedAt = now.getTime();
              else this.hashUpdatedAt = now.getTime();
              return;
            }
            const bytes = await boundedBytes(response);
            const entries =
              kind === 'domains' ? await normalizeInWorker(bytes) : parseThreatHashes(bytes.toString('utf8'));
            if (this.stopped) return;
            await fsp.mkdir(path.dirname(this.file(kind)), { recursive: true });
            const temp = `${this.file(kind)}.${randomUUID()}.tmp`;
            try {
              await fsp.writeFile(temp, entries instanceof Set ? bytes : entries.text, { mode: 0o600, flag: 'wx' });
              await fsp.rename(temp, this.file(kind));
            } finally {
              await fsp.rm(temp, { force: true });
            }
            if (entries instanceof Set) {
              this.hashes = entries;
              this.hashUpdatedAt = Date.now();
            } else {
              this.domains = new DomainList(entries.text, entries.starts);
              this.domainUpdatedAt = Date.now();
            }
            this.validators.set(kind, conditionalHeaders(response));
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
