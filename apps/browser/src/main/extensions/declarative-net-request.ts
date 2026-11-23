import { getDomain } from 'tldts';

export type DnrResourceType =
  | 'main_frame'
  | 'sub_frame'
  | 'stylesheet'
  | 'script'
  | 'image'
  | 'font'
  | 'object'
  | 'xmlhttprequest'
  | 'ping'
  | 'csp_report'
  | 'media'
  | 'websocket'
  | 'webtransport'
  | 'webbundle'
  | 'other';

export interface DnrRequest {
  url: string;
  method: string;
  type: DnrResourceType;
  initiator: string | null;
}

export type DnrOutcome =
  | { type: 'block'; priority: number }
  | { type: 'redirect'; priority: number; url: string }
  | { type: 'allow'; priority: number; allowAll: boolean };

const ELECTRON_TYPES: Record<string, DnrResourceType> = {
  mainFrame: 'main_frame',
  subFrame: 'sub_frame',
  stylesheet: 'stylesheet',
  script: 'script',
  image: 'image',
  font: 'font',
  object: 'object',
  xhr: 'xmlhttprequest',
  ping: 'ping',
  cspReport: 'csp_report',
  media: 'media',
  webSocket: 'websocket',
};

export function dnrResourceType(electronType: string): DnrResourceType {
  return ELECTRON_TYPES[electronType] ?? 'other';
}

// Chrome breaks priority ties in this order.
const RANK: Record<string, number> = { allow: 5, allowAllRequests: 4, block: 3, upgradeScheme: 2, redirect: 1 };
const MAX_RULE_PRIORITY = 2 ** 31 - 1;
const UPGRADES: Record<string, string> = { 'http:': 'https:', 'ws:': 'wss:' };

interface Redirect {
  url?: string;
  extensionPath?: string;
  regexSubstitution?: string;
  transform?: Record<string, unknown>;
}

interface Rule {
  priority: number;
  rank: number;
  action: string;
  redirect: Redirect | null;
  pattern: RegExp | null;
  urlFilter: string | null;
  caseSensitive: boolean;
  regex: boolean;
  requestDomains: Set<string> | null;
  excludedRequestDomains: Set<string> | null;
  initiatorDomains: Set<string> | null;
  excludedInitiatorDomains: Set<string> | null;
  resourceTypes: Set<string> | null;
  excludedResourceTypes: Set<string> | null;
  requestMethods: Set<string> | null;
  excludedRequestMethods: Set<string> | null;
  domainType: 'firstParty' | 'thirdParty' | null;
  seen: number;
}

const stringSet = (value: unknown, lower = true): Set<string> | null =>
  Array.isArray(value) && value.length > 0
    ? new Set(
        value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => (lower ? item.toLowerCase() : item)),
      )
    : null;

function compileUrlFilter(filter: string, caseSensitive: boolean): RegExp {
  let source = '';
  let rest = filter;
  if (rest.startsWith('||')) {
    source = '^[a-z][a-z0-9+.-]*:(?://)?(?:[^/?#]*[.@])?';
    rest = rest.slice(2);
  } else if (rest.startsWith('|')) {
    source = '^';
    rest = rest.slice(1);
  }
  const anchoredEnd = rest.endsWith('|');
  if (anchoredEnd) rest = rest.slice(0, -1);
  for (const char of rest) {
    if (char === '*') source += '.*';
    else if (char === '^') source += '(?:[^a-zA-Z0-9_\\-.%]|$)';
    else source += char.replace(/[.+?${}()[\]\\/|]/g, '\\$&');
  }
  if (anchoredEnd) source += '$';
  return new RegExp(source, caseSensitive ? '' : 'i');
}

function parseRule(value: unknown): Rule | null {
  if (!value || typeof value !== 'object') return null;
  const { priority = 1, action, condition = {} } = value as Record<string, unknown>;
  if (!action || typeof action !== 'object' || !condition || typeof condition !== 'object') return null;
  const { type, redirect } = action as { type?: unknown; redirect?: unknown };
  if (typeof type !== 'string' || !(type in RANK)) return null;
  if (typeof priority !== 'number' || !Number.isInteger(priority) || priority < 1 || priority > MAX_RULE_PRIORITY)
    return null;
  const c = condition as Record<string, unknown>;
  // Matched rules we cannot evaluate faithfully are dropped rather than guessed.
  if (c.tabIds !== undefined || c.responseHeaders !== undefined || c.excludedResponseHeaders !== undefined) return null;
  const urlFilter = typeof c.urlFilter === 'string' ? c.urlFilter : null;
  const regexFilter = typeof c.regexFilter === 'string' ? c.regexFilter : null;
  if (urlFilter !== null && regexFilter !== null) return null;
  const caseSensitive = c.isUrlFilterCaseSensitive === true;
  let pattern: RegExp | null = null;
  try {
    if (regexFilter !== null) pattern = new RegExp(regexFilter, caseSensitive ? '' : 'i');
  } catch {
    return null;
  }
  if (type === 'redirect' && (!redirect || typeof redirect !== 'object')) return null;
  return {
    priority,
    rank: RANK[type],
    action: type,
    redirect: type === 'redirect' ? (redirect as Redirect) : null,
    pattern,
    urlFilter: urlFilter || null,
    caseSensitive,
    regex: regexFilter !== null,
    requestDomains: stringSet(c.requestDomains),
    excludedRequestDomains: stringSet(c.excludedRequestDomains),
    initiatorDomains: stringSet(c.initiatorDomains),
    excludedInitiatorDomains: stringSet(c.excludedInitiatorDomains),
    resourceTypes: stringSet(c.resourceTypes, false),
    excludedResourceTypes: stringSet(c.excludedResourceTypes, false),
    requestMethods: stringSet(c.requestMethods),
    excludedRequestMethods: stringSet(c.excludedRequestMethods),
    domainType: c.domainType === 'firstParty' || c.domainType === 'thirdParty' ? c.domainType : null,
    seen: 0,
  };
}

function hostSuffixes(host: string): string[] {
  const suffixes = [host];
  for (let dot = host.indexOf('.'); dot !== -1; dot = host.indexOf('.', dot + 1)) suffixes.push(host.slice(dot + 1));
  return suffixes;
}

const inDomains = (domains: Set<string>, suffixes: readonly string[]) => suffixes.some((suffix) => domains.has(suffix));

const TOKEN_CHAR = /[a-z0-9]/;
const HOST_TERMINATORS = new Set(['^', '/', ':', '?', '|']);

// The host a `||host^`-style filter is pinned to, when the host cannot run on into a longer label.
function anchoredHost(filter: string): string | null {
  const match = /^\|\|([a-z0-9.-]+)/.exec(filter.toLowerCase());
  if (!match) return null;
  const next = filter[match[0].length];
  return next !== undefined && HOST_TERMINATORS.has(next) ? match[1].replace(/^\.+|\.+$/g, '') || null : null;
}

// The longest run of letters and digits a matching URL must contain as a whole token.
function wholeToken(filter: string): string | null {
  const lower = filter.toLowerCase();
  let best: string | null = null;
  for (const match of lower.matchAll(/[a-z0-9]+/g)) {
    const start = match.index;
    const end = start + match[0].length;
    const before = start === 0 ? null : lower[start - 1];
    const after = end === lower.length ? null : lower[end];
    const anchoredStart = before === '|' && (start === 1 || (start === 2 && lower.startsWith('||')));
    const boundedBefore = before !== null && before !== '*' && (!TOKEN_CHAR.test(before) || anchoredStart);
    const boundedAfter = after !== null && after !== '*' && !TOKEN_CHAR.test(after);
    if (boundedBefore && boundedAfter && match[0].length > (best?.length ?? 1)) best = match[0];
  }
  return best;
}

function push(index: Map<string, Rule[]>, key: string, rule: Rule): void {
  const list = index.get(key);
  if (list) list.push(rule);
  else index.set(key, [rule]);
}

export class DnrRuleset {
  readonly size: number;
  private readonly byDomain = new Map<string, Rule[]>();
  private readonly byToken = new Map<string, Rule[]>();
  private readonly unindexed: Rule[] = [];
  private generation = 0;

  constructor(
    rules: readonly unknown[],
    private readonly extensionId: string,
  ) {
    let size = 0;
    for (const value of rules) {
      const rule = parseRule(value);
      if (!rule) continue;
      size++;
      const host = rule.urlFilter ? anchoredHost(rule.urlFilter) : null;
      const token = rule.urlFilter && !host ? wholeToken(rule.urlFilter) : null;
      if (rule.requestDomains) for (const domain of rule.requestDomains) push(this.byDomain, domain, rule);
      else if (host) push(this.byDomain, host, rule);
      else if (token) push(this.byToken, token, rule);
      else this.unindexed.push(rule);
    }
    this.size = size;
  }

  match(request: DnrRequest, allowedUpTo = 0): DnrOutcome | null {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return null;
    }
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    const suffixes = host ? hostSuffixes(host) : [];
    const initiatorHost = initiatorHostOf(request.initiator);
    const initiatorSuffixes = initiatorHost ? hostSuffixes(initiatorHost) : null;
    const thirdParty =
      initiatorHost !== null && (getDomain(host) ?? host) !== (getDomain(initiatorHost) ?? initiatorHost);
    const method = request.method.toLowerCase();
    const generation = ++this.generation;
    let best = null as Rule | null;
    const consider = (rule: Rule) => {
      if (rule.seen === generation) return;
      rule.seen = generation;
      if (best && (rule.priority < best.priority || (rule.priority === best.priority && rule.rank <= best.rank)))
        return;
      if (rule.rank <= RANK.block && rule.priority <= allowedUpTo) return;
      if (!this.applies(rule, request, suffixes, initiatorSuffixes, thirdParty, method)) return;
      best = rule;
    };
    for (const suffix of suffixes) for (const rule of this.byDomain.get(suffix) ?? []) consider(rule);
    for (const token of new Set(request.url.toLowerCase().split(/[^a-z0-9]+/)))
      for (const rule of this.byToken.get(token) ?? []) consider(rule);
    for (const rule of this.unindexed) consider(rule);
    return best ? this.outcome(best, url) : null;
  }

  private applies(
    rule: Rule,
    request: DnrRequest,
    suffixes: readonly string[],
    initiatorSuffixes: readonly string[] | null,
    thirdParty: boolean,
    method: string,
  ): boolean {
    if (rule.resourceTypes ? !rule.resourceTypes.has(request.type) : request.type === 'main_frame') return false;
    if (rule.excludedResourceTypes?.has(request.type)) return false;
    if (rule.action === 'allowAllRequests' && request.type !== 'main_frame' && request.type !== 'sub_frame')
      return false;
    if (rule.requestDomains && !inDomains(rule.requestDomains, suffixes)) return false;
    if (rule.excludedRequestDomains && inDomains(rule.excludedRequestDomains, suffixes)) return false;
    if (rule.initiatorDomains && !(initiatorSuffixes && inDomains(rule.initiatorDomains, initiatorSuffixes)))
      return false;
    if (
      rule.excludedInitiatorDomains &&
      initiatorSuffixes &&
      inDomains(rule.excludedInitiatorDomains, initiatorSuffixes)
    )
      return false;
    if (rule.domainType && (rule.domainType === 'thirdParty') !== thirdParty) return false;
    if (rule.requestMethods && !rule.requestMethods.has(method)) return false;
    if (rule.excludedRequestMethods?.has(method)) return false;
    if (rule.urlFilter) rule.pattern ??= compileUrlFilter(rule.urlFilter, rule.caseSensitive);
    return !rule.pattern || rule.pattern.test(request.url);
  }

  private outcome(rule: Rule, url: URL): DnrOutcome | null {
    const { priority } = rule;
    switch (rule.action) {
      case 'allow':
      case 'allowAllRequests':
        return { type: 'allow', priority, allowAll: rule.action === 'allowAllRequests' };
      case 'block':
        return { type: 'block', priority };
      case 'upgradeScheme': {
        const scheme = UPGRADES[url.protocol];
        if (!scheme) return null;
        const upgraded = new URL(url.href);
        upgraded.protocol = scheme;
        return { type: 'redirect', priority, url: upgraded.href };
      }
      default: {
        const target = redirectTarget(rule, url, this.extensionId);
        return target && target !== url.href ? { type: 'redirect', priority, url: target } : null;
      }
    }
  }
}

function initiatorHostOf(initiator: string | null): string | null {
  if (!initiator || initiator === 'null') return null;
  try {
    return new URL(initiator).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

function redirectTarget(rule: Rule, url: URL, extensionId: string): string | null {
  const redirect = rule.redirect!;
  if (typeof redirect.extensionPath === 'string' && redirect.extensionPath.startsWith('/'))
    return `chrome-extension://${extensionId}${redirect.extensionPath}`;
  if (typeof redirect.url === 'string') return validUrl(redirect.url);
  if (typeof redirect.regexSubstitution === 'string' && rule.regex && rule.pattern) {
    const match = rule.pattern.exec(url.href);
    if (!match) return null;
    return validUrl(redirect.regexSubstitution.replace(/\\(\d)/g, (_, group: string) => match[Number(group)] ?? ''));
  }
  if (redirect.transform && typeof redirect.transform === 'object') return transformUrl(url, redirect.transform);
  return null;
}

function validUrl(value: string): string | null {
  try {
    return new URL(value).href;
  } catch {
    return null;
  }
}

function transformUrl(source: URL, transform: Record<string, unknown>): string | null {
  const url = new URL(source.href);
  const text = (key: string) => (typeof transform[key] === 'string' ? (transform[key] as string) : undefined);
  try {
    if (text('scheme')) url.protocol = text('scheme')!;
    if (text('host') !== undefined) url.hostname = text('host')!;
    if (text('port') !== undefined) url.port = text('port')!;
    if (text('path') !== undefined) url.pathname = text('path')!;
    if (text('query') !== undefined) url.search = text('query')!;
    if (text('fragment') !== undefined) url.hash = text('fragment')!;
    if (text('username') !== undefined) url.username = text('username')!;
    if (text('password') !== undefined) url.password = text('password')!;
  } catch {
    return null;
  }
  const query = transform.queryTransform as { removeParams?: unknown; addOrReplaceParams?: unknown } | undefined;
  if (query && typeof query === 'object') {
    if (Array.isArray(query.removeParams))
      for (const name of query.removeParams) if (typeof name === 'string') url.searchParams.delete(name);
    if (Array.isArray(query.addOrReplaceParams))
      for (const param of query.addOrReplaceParams) {
        const { key, value, replaceOnly } = (param ?? {}) as { key?: unknown; value?: unknown; replaceOnly?: unknown };
        if (typeof key !== 'string' || typeof value !== 'string') continue;
        if (replaceOnly === true && !url.searchParams.has(key)) continue;
        url.searchParams.set(key, value);
      }
  }
  return url.href;
}
