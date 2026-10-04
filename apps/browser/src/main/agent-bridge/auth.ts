import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

type Rejection = 'origin' | 'host' | 'token';

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function tokenMatches(given: string, expected: string): boolean {
  // Hashing first gives both sides the same length, which timingSafeEqual requires.
  return expected.length > 0 && timingSafeEqual(digest(given), digest(expected));
}

function bearer(header: string | undefined): string {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match?.[1] ?? '';
}

export function checkRequest(headers: IncomingHttpHeaders, port: number, token: string): Rejection | null {
  // Browsers attach Origin to cross-origin fetches; MCP clients never do.
  if (headers.origin !== undefined) return 'origin';
  const host = headers.host?.toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return 'host';
  if (!tokenMatches(bearer(headers.authorization), token)) return 'token';
  return null;
}
