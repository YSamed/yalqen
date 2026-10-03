import type { ClearDataRange, ClearDataRequest } from '../../shared/types.js';

const HOUR = 60 * 60 * 1000;
const RANGE_MS: Record<ClearDataRange, number> = {
  hour: HOUR,
  day: 24 * HOUR,
  week: 7 * 24 * HOUR,
  month: 28 * 24 * HOUR,
  all: Infinity,
};

export function clearSince(range: ClearDataRange, now: number): number {
  const span = RANGE_MS[range];
  return Number.isFinite(span) ? now - span : 0;
}

export function sanitizeClearRequest(value: unknown): ClearDataRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const request = value as Record<string, unknown>;
  if (typeof request.range !== 'string' || !(request.range in RANGE_MS)) return null;
  const flag = (key: string) => request[key] === true;
  const clean: ClearDataRequest = {
    range: request.range as ClearDataRange,
    history: flag('history'),
    downloads: flag('downloads'),
    siteData: flag('siteData'),
    cache: flag('cache'),
  };
  return clean.history || clean.downloads || clean.siteData || clean.cache ? clean : null;
}
