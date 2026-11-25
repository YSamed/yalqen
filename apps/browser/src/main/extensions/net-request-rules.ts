import { getDomain } from 'tldts';

export const RESOURCE_TYPES = [
  'main_frame',
  'sub_frame',
  'stylesheet',
  'script',
  'image',
  'font',
  'object',
  'xmlhttprequest',
  'ping',
  'csp_report',
  'media',
  'websocket',
  'webtransport',
  'webbundle',
  'other',
] as const;

const CONDITION_KEYS = new Set([
  'urlFilter',
  'regexFilter',
  'isUrlFilterCaseSensitive',
  'initiatorDomains',
  'excludedInitiatorDomains',
  'domains',
  'excludedDomains',
  'requestDomains',
  'excludedRequestDomains',
  'resourceTypes',
  'excludedResourceTypes',
  'requestMethods',
  'excludedRequestMethods',
  'domainType',
  'tabIds',
  'excludedTabIds',
  'responseHeaders',
  'excludedResponseHeaders',
]);

// shortcut: topDomains and other conditions newer than this list make a rule never match; add them here once a blocker uses them.
const supported = (rule: NetRule) => Object.keys(rule.condition).every((key) => CONDITION_KEYS.has(key));

const ACTION_RANK: Record<string, number> = {
  allow: 0,
  allowAllRequests: 1,
  block: 2,
  upgradeScheme: 3,
  redirect: 4,
};

export interface NetRule {
  id: number;
  priority?: number;
  action: { type: string; redirect?: Record<string, unknown> };
  condition: Record<string, unknown>;
}

export interface NetRequest {
  url: string;
  method: string;
  type: string;
  initiator: string | null;
  tabId: number;
  responseHeaders?: Record<string, string[]>;
}

export interface RuleMatch {
  rule: NetRule;
  regex: RegExp | null;
  rulesetId: string;
}

interface Compiled {
  rule: NetRule;
  rulesetId: string;
  priority: number;
  response: boolean;
  test: (request: NetRequest, url: ParsedUrl) => boolean;
  regex: () => RegExp | null;
}

interface HeaderCondition {
  header?: unknown;
  values?: unknown;
  excludedValues?: unknown;
}

const valuePattern = (pattern: string) =>
  new RegExp(
    `^${pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.')}$`,
    'i',
  );

function headerConditionMet(conditions: unknown, headers: Record<string, string[]>): boolean {
  if (!Array.isArray(conditions)) return false;
  const lower = Object.fromEntries(Object.entries(headers).map(([name, values]) => [name.toLowerCase(), values]));
  return conditions.some(({ header, values, excludedValues }: HeaderCondition) => {
    const present = typeof header === 'string' ? lower[header.toLowerCase()] : undefined;
    if (!present) return false;
    const matches = (list: unknown) =>
      (strings(list) ?? []).some((pattern) => present.some((value) => valuePattern(pattern).test(value)));
    if (excludedValues !== undefined && matches(excludedValues)) return false;
    return values === undefined || matches(values);
  });
}

interface ParsedUrl {
  host: string;
  domain: string | null;
  initiatorHost: string | null;
  initiatorDomain: string | null;
}

const strings = (value: unknown): string[] | null =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : null;
const numbers = (value: unknown): number[] | null =>
  Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : null;

const hostOf = (url: string | null): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const underDomain = (host: string | null, domains: string[]) =>
  host !== null &&
  domains.some((domain) => {
    const wanted = domain.toLowerCase();
    return host === wanted || host.endsWith(`.${wanted}`);
  });

export function urlFilterSource(filter: string): string {
  let rest = filter;
  let prefix = '';
  let suffix = '';
  if (rest.startsWith('||')) {
    prefix = '^[a-z][a-z0-9+.-]*:\\/\\/(?:[^/?#]*\\.)?';
    rest = rest.slice(2);
  } else if (rest.startsWith('|')) {
    prefix = '^';
    rest = rest.slice(1);
  }
  if (rest.endsWith('|')) {
    suffix = '$';
    rest = rest.slice(0, -1);
  }
  const body = [...rest]
    .map((char) =>
      char === '*' ? '.*' : char === '^' ? '(?:[^a-zA-Z0-9_\\-.%]|$)' : char.replace(/[.+?${}()|[\]\\/]/g, '\\$&'),
    )
    .join('');
  return prefix + body + suffix;
}

export function regexSupported(source: unknown, caseSensitive = false): { isSupported: boolean; reason?: string } {
  if (typeof source !== 'string') return { isSupported: false, reason: 'syntaxError' };
  try {
    new RegExp(source, caseSensitive ? '' : 'i');
    return { isSupported: true };
  } catch {
    return { isSupported: false, reason: 'syntaxError' };
  }
}

export function validateRule(raw: unknown): NetRule {
  const rule = raw as Partial<NetRule> | null;
  const id = rule?.id;
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) throw new Error('Rule id must be a positive integer');
  if (rule!.priority !== undefined && (!Number.isInteger(rule!.priority) || rule!.priority! < 1))
    throw new Error(`Rule with id ${id} must have a positive priority`);
  const type = rule!.action?.type;
  if (typeof type !== 'string' || !(type in ACTION_RANK || type === 'modifyHeaders'))
    throw new Error(`Rule with id ${id} has an unsupported action type`);
  if (type === 'redirect' && typeof rule!.action!.redirect !== 'object')
    throw new Error(`Rule with id ${id} does not specify the redirect`);
  const condition = rule!.condition ?? {};
  if (typeof condition !== 'object') throw new Error(`Rule with id ${id} has an invalid condition`);
  if (condition.urlFilter !== undefined && condition.regexFilter !== undefined)
    throw new Error(`Rule with id ${id} specifies both urlFilter and regexFilter`);
  if (condition.urlFilter !== undefined && (typeof condition.urlFilter !== 'string' || condition.urlFilter === ''))
    throw new Error(`Rule with id ${id} has an empty urlFilter`);
  if (
    condition.regexFilter !== undefined &&
    !regexSupported(condition.regexFilter, condition.isUrlFilterCaseSensitive === true).isSupported
  )
    throw new Error(`Rule with id ${id} specified an invalid regexFilter`);
  return { id, priority: rule!.priority, action: rule!.action!, condition };
}

function compile(rule: NetRule, rulesetId: string): Compiled {
  const condition = rule.condition;
  const flags = condition.isUrlFilterCaseSensitive === true ? '' : 'i';
  const source =
    typeof condition.regexFilter === 'string'
      ? condition.regexFilter
      : typeof condition.urlFilter === 'string'
        ? urlFilterSource(condition.urlFilter)
        : null;
  let compiled: RegExp | null | undefined;
  const regex = () => {
    if (compiled === undefined) compiled = source === null ? null : new RegExp(source, flags);
    return compiled;
  };
  const types = strings(condition.resourceTypes);
  const excludedTypes = strings(condition.excludedResourceTypes) ?? (types ? [] : ['main_frame']);
  const methods = strings(condition.requestMethods);
  const excludedMethods = strings(condition.excludedRequestMethods);
  const requestDomains = strings(condition.requestDomains);
  const excludedRequestDomains = strings(condition.excludedRequestDomains);
  const initiatorDomains = strings(condition.initiatorDomains) ?? strings(condition.domains);
  const excludedInitiatorDomains = strings(condition.excludedInitiatorDomains) ?? strings(condition.excludedDomains);
  const tabIds = numbers(condition.tabIds);
  const excludedTabIds = numbers(condition.excludedTabIds);
  const domainType = condition.domainType;
  const responseHeaders = condition.responseHeaders;
  const excludedResponseHeaders = condition.excludedResponseHeaders;
  const response = responseHeaders !== undefined || excludedResponseHeaders !== undefined;
  return {
    rule,
    rulesetId,
    priority: rule.priority ?? 1,
    response,
    regex,
    test: (request, url) => {
      if (response) {
        if (!request.responseHeaders) return false;
        if (responseHeaders !== undefined && !headerConditionMet(responseHeaders, request.responseHeaders))
          return false;
        if (
          excludedResponseHeaders !== undefined &&
          headerConditionMet(excludedResponseHeaders, request.responseHeaders)
        )
          return false;
      }
      if (types && !types.includes(request.type)) return false;
      if (excludedTypes.includes(request.type)) return false;
      const method = request.method.toLowerCase();
      if (methods && !methods.includes(method)) return false;
      if (excludedMethods?.includes(method)) return false;
      if (tabIds && !tabIds.includes(request.tabId)) return false;
      if (excludedTabIds?.includes(request.tabId)) return false;
      if (requestDomains && !underDomain(url.host, requestDomains)) return false;
      if (excludedRequestDomains && underDomain(url.host, excludedRequestDomains)) return false;
      if (initiatorDomains && !underDomain(url.initiatorHost, initiatorDomains)) return false;
      if (excludedInitiatorDomains && underDomain(url.initiatorHost, excludedInitiatorDomains)) return false;
      if (domainType === 'firstParty' || domainType === 'thirdParty') {
        const thirdParty = url.initiatorDomain !== null && url.initiatorDomain !== url.domain;
        if (thirdParty !== (domainType === 'thirdParty')) return false;
      }
      return regex()?.test(request.url) ?? true;
    },
  };
}

const TOKEN = /[a-z0-9%]+/g;

function indexKeys(rule: NetRule): string[] {
  const { requestDomains, urlFilter } = rule.condition;
  const domains = strings(requestDomains);
  if (domains?.length) return domains.map((domain) => `d:${domain.toLowerCase()}`);
  if (typeof urlFilter !== 'string') return [];
  const filter = urlFilter.toLowerCase();
  if (filter.startsWith('||')) {
    const host = /^\|\|([a-z0-9.-]+)(?=[\^/:?|])/.exec(filter)?.[1];
    if (host && !host.startsWith('.') && !host.endsWith('.')) return [`d:${host}`];
  }
  const body = filter.replace(/^\|\|?/, '');
  let best = '';
  for (const match of body.matchAll(TOKEN)) {
    const start = match.index;
    const end = start + match[0].length;
    const before = start === 0 ? (filter.startsWith('|') ? '|' : '*') : body[start - 1]!;
    const after = end === body.length ? '*' : body[end]!;
    if (before === '*' || after === '*') continue;
    if (match[0].length > best.length) best = match[0];
  }
  return best.length >= 3 ? [`t:${best}`] : [];
}

export class RuleIndex {
  private readonly buckets = new Map<string, Compiled[]>();
  private readonly generic: Compiled[] = [];
  readonly size: number;
  readonly allowsFrames: boolean;

  constructor(rules: readonly NetRule[], rulesetId = '') {
    this.size = rules.length;
    this.allowsFrames = rules.some((rule) => rule.action.type === 'allowAllRequests');
    for (const rule of rules) {
      if (!supported(rule)) continue;
      const compiled = compile(rule, rulesetId);
      const keys = indexKeys(rule);
      if (keys.length === 0) this.generic.push(compiled);
      for (const key of keys) {
        const bucket = this.buckets.get(key);
        if (bucket) bucket.push(compiled);
        else this.buckets.set(key, [compiled]);
      }
    }
  }

  candidates(url: string, host: string): Iterable<Compiled> {
    const found = new Set<Compiled>(this.generic);
    const add = (key: string) => {
      for (const compiled of this.buckets.get(key) ?? []) found.add(compiled);
    };
    for (let rest = host; rest; rest = rest.slice(rest.indexOf('.') + 1)) {
      add(`d:${rest}`);
      if (!rest.includes('.')) break;
    }
    for (const token of new Set(url.toLowerCase().match(TOKEN) ?? [])) add(`t:${token}`);
    return found;
  }
}

const better = (next: Compiled, current: Compiled | null) =>
  !current ||
  next.priority > current.priority ||
  (next.priority === current.priority &&
    (ACTION_RANK[next.rule.action.type] ?? 9) < (ACTION_RANK[current.rule.action.type] ?? 9));

export function parseRequest(request: NetRequest): ParsedUrl {
  const host = hostOf(request.url) ?? '';
  const initiatorHost = hostOf(request.initiator);
  return {
    host,
    domain: getDomain(host) ?? host,
    initiatorHost,
    initiatorDomain: initiatorHost === null ? null : (getDomain(initiatorHost) ?? initiatorHost),
  };
}

const matchOf = (compiled: Compiled): RuleMatch => ({
  rule: compiled.rule,
  regex: compiled.regex(),
  rulesetId: compiled.rulesetId,
});

// Rules with response header conditions wait for the response; all others decide before the request starts.
export function bestMatch(
  indexes: readonly RuleIndex[],
  request: NetRequest,
  only?: (rule: NetRule) => boolean,
): RuleMatch | null {
  const parsed = parseRequest(request);
  const atResponse = request.responseHeaders !== undefined;
  let best: Compiled | null = null;
  for (const index of indexes) {
    for (const compiled of index.candidates(request.url, parsed.host)) {
      if (compiled.rule.action.type === 'modifyHeaders' || compiled.response !== atResponse) continue;
      if (only && !only(compiled.rule)) continue;
      if (better(compiled, best) && compiled.test(request, parsed)) best = compiled;
    }
  }
  return best ? matchOf(best) : null;
}

export function headerRules(indexes: readonly RuleIndex[], request: NetRequest): RuleMatch[] {
  const parsed = parseRequest(request);
  const atResponse = request.responseHeaders !== undefined;
  const found: Compiled[] = [];
  for (const index of indexes) {
    for (const compiled of index.candidates(request.url, parsed.host)) {
      if (compiled.rule.action.type !== 'modifyHeaders') continue;
      if (compiled.response && !atResponse) continue;
      if (compiled.test(request, parsed)) found.push(compiled);
    }
  }
  return found.sort((a, b) => b.priority - a.priority).map(matchOf);
}

interface HeaderOperation {
  header?: unknown;
  operation?: unknown;
  value?: unknown;
}

// Higher priority rules win: once a header is set or removed, lower rules leave it alone; appends add up.
export function modifiedHeaders<T extends string | string[]>(
  headers: Record<string, T>,
  matches: readonly RuleMatch[],
  key: 'requestHeaders' | 'responseHeaders',
): Record<string, T> | null {
  const next: Record<string, string | string[]> = { ...headers };
  const done = new Map<string, string>();
  let changed = false;
  for (const { rule } of matches) {
    const operations = (rule.action as Record<string, unknown>)[key];
    if (!Array.isArray(operations)) continue;
    for (const { header, operation, value } of operations as HeaderOperation[]) {
      if (typeof header !== 'string' || typeof operation !== 'string') continue;
      const name = header.toLowerCase();
      const previous = done.get(name);
      if (previous && (previous !== 'append' || operation !== 'append')) continue;
      const existing = Object.keys(next).filter((candidate) => candidate.toLowerCase() === name);
      if (operation === 'remove') {
        for (const candidate of existing) delete next[candidate];
      } else if (typeof value === 'string' && (operation === 'set' || operation === 'append')) {
        const current = operation === 'append' ? existing.flatMap((candidate) => next[candidate] ?? []) : [];
        for (const candidate of existing) delete next[candidate];
        next[header] =
          key === 'responseHeaders'
            ? [...current, value]
            : [...current, value].join(operation === 'append' ? ', ' : '');
      } else continue;
      done.set(name, operation);
      changed = true;
    }
  }
  return changed ? (next as Record<string, T>) : null;
}

export function redirectTarget(
  match: RuleMatch,
  request: NetRequest,
  extensionUrl: (path: string) => string,
): string | null {
  const { type, redirect } = match.rule.action;
  try {
    if (type === 'upgradeScheme') {
      const url = new URL(request.url);
      if (url.protocol === 'http:') url.protocol = 'https:';
      else if (url.protocol === 'ws:') url.protocol = 'wss:';
      else return null;
      return url.href;
    }
    if (type !== 'redirect' || !redirect) return null;
    if (typeof redirect.url === 'string') return new URL(redirect.url).href;
    if (typeof redirect.extensionPath === 'string' && redirect.extensionPath.startsWith('/'))
      return extensionUrl(redirect.extensionPath);
    if (typeof redirect.regexSubstitution === 'string' && match.regex) {
      const substitution = redirect.regexSubstitution
        .replace(/\$/g, '$$$$')
        .replace(/\\(\d)/g, (_, digit: string) => (digit === '0' ? '$&' : `$${digit}`));
      return new URL(request.url.replace(match.regex, substitution)).href;
    }
    if (typeof redirect.transform === 'object' && redirect.transform !== null)
      return transformed(request.url, redirect.transform as Record<string, unknown>);
  } catch {
    return null;
  }
  return null;
}

function transformed(raw: string, transform: Record<string, unknown>): string {
  const url = new URL(raw);
  const text = (key: string) => (typeof transform[key] === 'string' ? (transform[key] as string) : undefined);
  const scheme = text('scheme');
  if (scheme) url.protocol = `${scheme}:`;
  const host = text('host');
  if (host !== undefined) url.hostname = host;
  const port = text('port');
  if (port !== undefined) url.port = port;
  const path = text('path');
  if (path !== undefined) url.pathname = path;
  const query = text('query');
  if (query !== undefined) url.search = query;
  const fragment = text('fragment');
  if (fragment !== undefined) url.hash = fragment;
  const username = text('username');
  if (username !== undefined) url.username = username;
  const password = text('password');
  if (password !== undefined) url.password = password;
  const queryTransform = transform.queryTransform as
    | { removeParams?: unknown; addOrReplaceParams?: { key: string; value: string; replaceOnly?: boolean }[] }
    | undefined;
  if (queryTransform) {
    for (const key of strings(queryTransform.removeParams) ?? []) url.searchParams.delete(key);
    for (const { key, value, replaceOnly } of queryTransform.addOrReplaceParams ?? []) {
      if (typeof key !== 'string' || typeof value !== 'string') continue;
      if (url.searchParams.has(key) || !replaceOnly) url.searchParams.set(key, value);
    }
  }
  return url.href;
}
