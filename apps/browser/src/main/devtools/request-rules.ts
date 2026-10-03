import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { RequestRule, RequestRuleAction } from '../../shared/types.js';
import { JsonFile } from '../storage/json-file.js';
import type { ProtocolCommand } from './page-overrides.js';

const ACTIONS: readonly RequestRuleAction[] = ['block', 'mock', 'redirect', 'headers'];
const MAX_RULES = 100;
const MAX_PATTERN = 2048;
const MAX_BODY = 1024 * 1024;
const MAX_HEADERS = 8192;
const MAX_CACHED_BODY_CHARS = 8 * 1024 * 1024;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function sanitizeRequestRule(raw: unknown): RequestRule | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rule = raw as Record<string, unknown>;
  const status = Number(rule.status);
  return {
    id: typeof rule.id === 'string' && rule.id !== '' ? rule.id.slice(0, 64) : randomUUID(),
    enabled: rule.enabled !== false,
    pattern: text(rule.pattern, MAX_PATTERN).trim(),
    action: ACTIONS.includes(rule.action as RequestRuleAction) ? (rule.action as RequestRuleAction) : 'block',
    status: Number.isInteger(status) && status >= 200 && status <= 599 ? status : 200,
    contentType: text(rule.contentType, 200).trim() || 'text/plain',
    body: text(rule.body, MAX_BODY),
    redirectUrl: text(rule.redirectUrl, MAX_PATTERN).trim(),
    headers: text(rule.headers, MAX_HEADERS),
  };
}

export function sanitizeRequestRules(raw: unknown): RequestRule[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .slice(0, MAX_RULES)
    .map(sanitizeRequestRule)
    .filter((rule) => rule !== null);
}

export function isRuleActive(rule: RequestRule): boolean {
  if (!rule.enabled || rule.pattern === '') return false;
  return rule.action !== 'redirect' || /^https?:\/\//i.test(rule.redirectUrl);
}

function patternRegExp(pattern: string): RegExp {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${source}$`, 'i');
}

const matchers = new WeakMap<RequestRule, { pattern: string; regexp: RegExp }>();

function matches(rule: RequestRule, url: string): boolean {
  let cached = matchers.get(rule);
  if (!cached || cached.pattern !== rule.pattern) {
    cached = { pattern: rule.pattern, regexp: patternRegExp(rule.pattern) };
    matchers.set(rule, cached);
  }
  return cached.regexp.test(url);
}

export function matchRequestRule(rules: readonly RequestRule[], url: string): RequestRule | null {
  return rules.find((rule) => isRuleActive(rule) && matches(rule, url)) ?? null;
}

export interface InterceptPattern {
  urlPattern: string;
  resourceType?: string;
  requestStage: 'Request';
}

// Fetch.enable treats an empty pattern list as "intercept everything", so callers disable it instead.
export function interceptPatterns(rules: readonly RequestRule[]): InterceptPattern[] {
  return rules.filter(isRuleActive).map((rule) => ({
    urlPattern: rule.pattern.replace(/[?\\]/g, '\\$&'),
    requestStage: 'Request',
  }));
}

export function parseHeaderLines(lines: string): { name: string; value: string | null }[] {
  return lines.split('\n').flatMap((line) => {
    const index = line.indexOf(':');
    const name = (index < 0 ? line : line.slice(0, index)).trim();
    if (!/^[!#$%&'*+.^_`|~\w-]+$/.test(name)) return [];
    const value = index < 0 ? '' : line.slice(index + 1).trim();
    return [{ name, value: value === '' ? null : value }];
  });
}

let mockBodies = new WeakMap<RequestRule, { source: string; encoded: string }>();
let cachedBodyChars = 0;
const headerEdits = new WeakMap<
  RequestRule,
  { source: string; entries: { key: string; name: string; value: string | null }[] }
>();

function mockBody(rule: RequestRule): string {
  const cached = mockBodies.get(rule);
  if (cached?.source === rule.body) return cached.encoded;
  if (cached) {
    mockBodies.delete(rule);
    cachedBodyChars -= cached.encoded.length;
  }
  const encoded = Buffer.from(rule.body).toString('base64');
  if (encoded.length > MAX_CACHED_BODY_CHARS) return encoded;
  if (cachedBodyChars + encoded.length > MAX_CACHED_BODY_CHARS) {
    // Weak keys avoid retaining removed rules. Collected entries may remain in the
    // budget estimate until this reset, causing only conservative early eviction.
    mockBodies = new WeakMap();
    cachedBodyChars = 0;
  }
  mockBodies.set(rule, { source: rule.body, encoded });
  cachedBodyChars += encoded.length;
  return encoded;
}

function editsFor(rule: RequestRule): { key: string; name: string; value: string | null }[] {
  let cached = headerEdits.get(rule);
  if (!cached || cached.source !== rule.headers) {
    cached = {
      source: rule.headers,
      entries: parseHeaderLines(rule.headers).map(({ name, value }) => ({ key: name.toLowerCase(), name, value })),
    };
    headerEdits.set(rule, cached);
  }
  return cached.entries;
}

export interface PausedRequest {
  requestId: string;
  networkId?: string;
  resourceType?: string;
  request: { url: string; headers: Record<string, string> };
}

export interface HeaderValue {
  name: string;
  value: string;
}

function withHeaders(request: PausedRequest['request'], extra: readonly HeaderValue[]): HeaderValue[] {
  const headers = new Map(
    Object.entries(request.headers).map(([name, value]) => [name.toLowerCase(), { name, value }]),
  );
  for (const header of extra) headers.set(header.name.toLowerCase(), header);
  return [...headers.values()];
}

export function pausedRequestCommand(
  rules: readonly RequestRule[],
  paused: PausedRequest,
  extraHeaders: readonly HeaderValue[] = [],
): ProtocolCommand {
  const { requestId, request } = paused;
  const rule = matchRequestRule(rules, request.url);
  if (!rule) {
    return extraHeaders.length > 0
      ? { method: 'Fetch.continueRequest', params: { requestId, headers: withHeaders(request, extraHeaders) } }
      : { method: 'Fetch.continueRequest', params: { requestId } };
  }
  switch (rule.action) {
    case 'block':
      return { method: 'Fetch.failRequest', params: { requestId, errorReason: 'BlockedByClient' } };
    case 'mock':
      return {
        method: 'Fetch.fulfillRequest',
        params: {
          requestId,
          responseCode: rule.status,
          responseHeaders: [
            { name: 'Content-Type', value: rule.contentType },
            { name: 'Access-Control-Allow-Origin', value: '*' },
            { name: 'Cache-Control', value: 'no-store' },
          ],
          body: mockBody(rule),
        },
      };
    case 'redirect':
      return {
        method: 'Fetch.fulfillRequest',
        params: {
          requestId,
          responseCode: 307,
          responseHeaders: [
            { name: 'Location', value: rule.redirectUrl },
            { name: 'Access-Control-Allow-Origin', value: '*' },
          ],
        },
      };
    case 'headers': {
      const headers = new Map(withHeaders(request, extraHeaders).map((header) => [header.name.toLowerCase(), header]));
      for (const { key, name, value } of editsFor(rule)) {
        if (value === null) headers.delete(key);
        else headers.set(key, { name, value });
      }
      return { method: 'Fetch.continueRequest', params: { requestId, headers: [...headers.values()] } };
    }
  }
}

export class RequestRuleStore {
  private readonly json: JsonFile;
  private rules: RequestRule[] = [];

  constructor(directory: string) {
    const file = path.join(directory, 'request-rules.json');
    this.json = new JsonFile(file, 'request-rules');
    try {
      this.rules = sanitizeRequestRules((JSON.parse(fs.readFileSync(file, 'utf8')) as { rules?: unknown }).rules);
    } catch {
      this.rules = [];
    }
  }

  list(): RequestRule[] {
    return this.rules;
  }

  save(raw: unknown): RequestRule[] {
    this.rules = sanitizeRequestRules(raw);
    this.json.schedule(() => ({ version: 1, rules: this.rules }));
    return this.rules;
  }

  saveNow(): void {
    this.json.flush();
  }
}
