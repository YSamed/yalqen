import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function tokenMatches(given: string, expected: string): boolean {
  return expected.length > 0 && timingSafeEqual(digest(given), digest(expected));
}

export function bearer(header: string | undefined): string {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match?.[1] ?? '';
}

export function checkSource(headers: IncomingHttpHeaders, port: number): 'origin' | 'host' | null {
  if (headers.origin !== undefined) return 'origin';
  const host = headers.host?.toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return 'host';
  return null;
}
