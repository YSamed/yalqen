import fs from 'node:fs';
import type {
  Extension,
  HeadersReceivedResponse,
  OnBeforeRequestListenerDetails,
  OnHeadersReceivedListenerDetails,
  Session,
  WebFrameMain,
} from 'electron';
import { HEADER_STAGE, setReceiveStage, setSendStage } from '../privacy/header-stages.js';
import { JsonFile } from '../storage/json-file.js';
import { extensionGrant, hostPermitted } from './extension-cookies.js';
import { extensionFile } from './extension-manifest.js';
import {
  bestMatch,
  headerRules,
  modifiedHeaders,
  redirectTarget,
  regexSupported,
  RuleIndex,
  validateRule,
  type NetRequest,
  type NetRule,
  type RuleMatch,
} from './net-request-rules.js';

const MAX_DYNAMIC_RULES = 30_000;
const MAX_SESSION_RULES = 5_000;
const MAX_REGEX_RULES = 1_000;
const MAX_ENABLED_RULESETS = 50;
const STATIC_RULE_LIMIT = 330_000;
const MATCHED_RULES_KEPT_MS = 5 * 60_000;
const MAX_MATCHED_RULES = 1_000;
export const NET_REQUEST_PERMISSIONS = ['declarativeNetRequest', 'declarativeNetRequestWithHostAccess'] as const;

const RESOURCE_TYPE: Record<string, string> = {
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

interface Saved {
  enabled?: string[];
  dynamic?: NetRule[];
  disabled?: Record<string, number[]>;
}

interface Ruleset {
  id: string;
  path: string;
  enabled: boolean;
}

interface ExtensionRules {
  rulesets: Ruleset[];
  enabled: Set<string>;
  loaded: Map<string, RuleIndex>;
  disabled: Map<string, Set<number>>;
  dynamic: NetRule[];
  session: NetRule[];
  dynamicIndex: RuleIndex;
  sessionIndex: RuleIndex;
  allowsFrames: boolean;
  ready: Promise<void>;
}

export type NetRequestVerdict = { cancel: true } | { redirectURL: string };

interface RequestDetails {
  url: string;
  method: string;
  resourceType: string;
  referrer: string;
  webContentsId?: number;
  frame?: WebFrameMain | null;
}

interface MatchedRule {
  rule: { ruleId: number; rulesetId: string };
  tabId: number;
  timeStamp: number;
}

function staticRulesets(manifest: unknown): Ruleset[] {
  const resources = (manifest as { declarative_net_request?: { rule_resources?: unknown } } | undefined)
    ?.declarative_net_request?.rule_resources;
  if (!Array.isArray(resources)) return [];
  return resources.flatMap((resource: Partial<Ruleset> | null) =>
    typeof resource?.id === 'string' && typeof resource.path === 'string'
      ? [{ id: resource.id, path: resource.path, enabled: resource.enabled === true }]
      : [],
  );
}

function validRules(raw: unknown, skipInvalid: boolean): NetRule[] {
  if (!Array.isArray(raw)) throw new Error('Rules must be an array');
  const seen = new Set<number>();
  return raw.flatMap((item) => {
    try {
      const rule = validateRule(item);
      if (seen.has(rule.id)) throw new Error(`Rule with id ${rule.id} does not have a unique ID`);
      seen.add(rule.id);
      return [rule];
    } catch (error) {
      if (skipInvalid) return [];
      throw error;
    }
  });
}

function resourceListed(resources: unknown, path: string): boolean {
  const wanted = path.replace(/^\//, '');
  return (
    Array.isArray(resources) &&
    resources.some(
      (resource) =>
        typeof resource === 'string' &&
        new RegExp(
          `^${resource
            .replace(/^\//, '')
            .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
            .replace(/\*/g, '.*')}$`,
        ).test(wanted),
    )
  );
}

const objectArg = (args: unknown[]) =>
  (typeof args[0] === 'object' && args[0] !== null ? args[0] : {}) as Record<string, unknown>;
const ids = (value: unknown) => (Array.isArray(value) ? value.filter((id) => typeof id === 'number') : []);
const names = (value: unknown) => (Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []);

export class NetRequestRules {
  private readonly saved: Record<string, Saved>;
  private readonly rules = new Map<string, ExtensionRules>();
  private readonly dynamicIds = new Map<string, string>();
  private readonly matched = new Map<string, MatchedRule[]>();
  private readonly store: JsonFile;

  constructor(
    private readonly session: Session,
    stateFile: string,
  ) {
    this.store = new JsonFile(stateFile, 'net-request');
    this.saved = this.read(stateFile);
    session.extensions.on('extension-loaded', (_event, extension) => void this.attach(extension));
    session.extensions.on('extension-unloaded', (_event, { id }) => this.rules.delete(id));
    for (const extension of session.extensions.getAllExtensions()) void this.attach(extension);
    setSendStage(session, HEADER_STAGE.extensions, (details, headers) =>
      this.rules.size === 0 ? null : this.requestHeaders(details, headers),
    );
    setReceiveStage(session, HEADER_STAGE.extensions, (details, headers) =>
      this.rules.size === 0 ? null : this.responseHeaders(details, headers),
    );
  }

  forget(extensionId: string): void {
    this.rules.delete(extensionId);
    this.dynamicIds.delete(extensionId);
    this.matched.delete(extensionId);
    if (!(extensionId in this.saved)) return;
    delete this.saved[extensionId];
    this.store.schedule(() => this.saved);
  }

  decide(session: Session, details: OnBeforeRequestListenerDetails): NetRequestVerdict | null {
    if (session !== this.session || this.rules.size === 0) return null;
    const context = this.requestOf(details);
    if (!context) return null;
    const { request, frame } = context;
    let redirect: string | null = null;
    for (const [extensionId, rules] of this.rules) {
      const access = this.access(extensionId, request.url);
      if (!access) continue;
      const indexes = this.indexes(rules);
      const match = this.finalMatch(rules, indexes, request, frame);
      if (!match) continue;
      const { type } = match.rule.action;
      if (type === 'allow' || type === 'allowAllRequests') {
        this.record(extensionId, match, request.tabId);
        continue;
      }
      if (type === 'block') {
        this.record(extensionId, match, request.tabId);
        return { cancel: true };
      }
      if (redirect || access !== 'host') continue;
      const target = redirectTarget(match, request, (path) => this.extensionUrl(extensionId, path));
      if (target && target !== request.url) {
        this.record(extensionId, match, request.tabId);
        redirect = target;
      }
    }
    return redirect ? { redirectURL: redirect } : null;
  }

  private requestHeaders(details: RequestDetails, headers: Record<string, string>): Record<string, string> | null {
    const context = this.requestOf(details);
    if (!context) return null;
    const matches = this.headerMatches(context.request, context.frame);
    return matches.length > 0 ? modifiedHeaders(headers, matches, 'requestHeaders') : null;
  }

  private responseHeaders(
    details: OnHeadersReceivedListenerDetails,
    headers: Record<string, string[]>,
  ): HeadersReceivedResponse | null {
    const context = this.requestOf(details);
    if (!context) return null;
    const request = { ...context.request, responseHeaders: headers };
    for (const [extensionId, rules] of this.rules) {
      if (!this.access(extensionId, request.url)) continue;
      const match = bestMatch(this.indexes(rules), request);
      if (match?.rule.action.type !== 'block') continue;
      this.record(extensionId, match, request.tabId);
      return { cancel: true };
    }
    const matches = this.headerMatches(request, context.frame);
    const responseHeaders = matches.length > 0 ? modifiedHeaders(headers, matches, 'responseHeaders') : null;
    return responseHeaders ? { responseHeaders } : null;
  }

  // An allow rule stops the same extension's lower priority header rules, as in Chrome.
  private headerMatches(request: NetRequest, frame: WebFrameMain | null): RuleMatch[] {
    const found: { extensionId: string; match: RuleMatch }[] = [];
    for (const [extensionId, rules] of this.rules) {
      if (this.access(extensionId, request.url) !== 'host') continue;
      const indexes = this.indexes(rules);
      const candidates = headerRules(indexes, request);
      if (candidates.length === 0) continue;
      const decided = this.finalMatch(rules, indexes, { ...request, responseHeaders: undefined }, frame);
      const allowed =
        decided && ['allow', 'allowAllRequests'].includes(decided.rule.action.type) ? (decided.rule.priority ?? 1) : 0;
      for (const match of candidates) if ((match.rule.priority ?? 1) > allowed) found.push({ extensionId, match });
    }
    found.sort((a, b) => (b.match.rule.priority ?? 1) - (a.match.rule.priority ?? 1));
    for (const { extensionId, match } of found) this.record(extensionId, match, request.tabId);
    return found.map(({ match }) => match);
  }

  private finalMatch(
    rules: ExtensionRules,
    indexes: RuleIndex[],
    request: NetRequest,
    frame: WebFrameMain | null,
  ): RuleMatch | null {
    const match = bestMatch(indexes, request);
    if (!match || !rules.allowsFrames) return match;
    const framePriority = this.frameAllowed(indexes, request, frame, request.type);
    return framePriority >= (match.rule.priority ?? 1)
      ? {
          rule: { id: 0, priority: framePriority, action: { type: 'allowAllRequests' }, condition: {} },
          regex: null,
          rulesetId: '',
        }
      : match;
  }

  // "host" may block, redirect and change headers; "block" has only declarativeNetRequest without host access.
  private access(extensionId: string, url: string): 'host' | 'block' | null {
    const grant = extensionGrant(this.session.extensions.getExtension(extensionId)?.manifest);
    if (hostPermitted(grant.hosts, url)) return 'host';
    return grant.permissions.includes('declarativeNetRequest') ? 'block' : null;
  }

  private requestOf(details: RequestDetails): { request: NetRequest; frame: WebFrameMain | null } | null {
    if (details.url.startsWith('chrome-extension:')) return null;
    const frame = this.frameOf(details);
    if ((frame?.url ?? '').startsWith('chrome-extension:')) return null;
    const type = RESOURCE_TYPE[details.resourceType] ?? 'other';
    return {
      frame,
      request: {
        url: details.url,
        method: details.method,
        type,
        initiator:
          type === 'main_frame' ? details.referrer || null : (this.origin(frame) ?? (details.referrer || null)),
        tabId: details.webContentsId ?? -1,
      },
    };
  }

  private record(extensionId: string, match: RuleMatch, tabId: number): void {
    if (match.rule.id === 0) return;
    const now = Date.now();
    const list = (this.matched.get(extensionId) ?? []).filter((entry) => entry.timeStamp > now - MATCHED_RULES_KEPT_MS);
    list.push({ rule: { ruleId: match.rule.id, rulesetId: match.rulesetId }, tabId, timeStamp: now });
    this.matched.set(extensionId, list.slice(-MAX_MATCHED_RULES));
  }

  private matchedRules(extensionId: string, options: Record<string, unknown>): { rulesMatchedInfo: MatchedRule[] } {
    const grant = extensionGrant(this.session.extensions.getExtension(extensionId)?.manifest);
    if (!grant.permissions.includes('declarativeNetRequestFeedback'))
      throw new Error('The extension needs the declarativeNetRequestFeedback permission.');
    const since = typeof options.minTimeStamp === 'number' ? options.minTimeStamp : 0;
    return {
      rulesMatchedInfo: (this.matched.get(extensionId) ?? []).filter(
        (entry) => entry.timeStamp >= since && (typeof options.tabId !== 'number' || entry.tabId === options.tabId),
      ),
    };
  }

  async call(extensionId: string, method: string, args: unknown[]): Promise<unknown> {
    const rules = this.rules.get(extensionId) ?? (await this.attach(this.session.extensions.getExtension(extensionId)));
    if (!rules) throw new Error('Unknown extension');
    await rules.ready;
    const options = objectArg(args);
    switch (method) {
      case 'getEnabledRulesets':
        return [...rules.enabled];
      case 'updateEnabledRulesets':
        return this.updateEnabled(
          extensionId,
          rules,
          names(options.disableRulesetIds),
          names(options.enableRulesetIds),
        );
      case 'getAvailableStaticRuleCount':
        return Math.max(0, STATIC_RULE_LIMIT - [...rules.loaded.values()].reduce((sum, index) => sum + index.size, 0));
      case 'getDynamicRules':
        return this.filtered(rules.dynamic, options.ruleIds);
      case 'getSessionRules':
        return this.filtered(rules.session, options.ruleIds);
      case 'updateDynamicRules':
        rules.dynamic = this.updated(rules.dynamic, options, MAX_DYNAMIC_RULES, rules.session);
        rules.dynamicIndex = new RuleIndex(rules.dynamic, '_dynamic');
        this.refreshFrameRules(rules);
        this.save();
        return undefined;
      case 'updateSessionRules':
        rules.session = this.updated(rules.session, options, MAX_SESSION_RULES, rules.dynamic);
        rules.sessionIndex = new RuleIndex(rules.session, '_session');
        this.refreshFrameRules(rules);
        return undefined;
      case 'updateStaticRules':
        return this.updateStatic(extensionId, rules, options);
      case 'getDisabledRuleIds':
        return [...(rules.disabled.get(String(options.rulesetId)) ?? [])];
      case 'isRegexSupported':
        return regexSupported(options.regex, options.isCaseSensitive === true);
      case 'getMatchedRules':
        return this.matchedRules(extensionId, options);
      case 'useDynamicId':
        if (typeof args[0] === 'string' && /^[0-9a-f-]{36}$/.test(args[0])) this.dynamicIds.set(extensionId, args[0]);
        return undefined;
      case 'setExtensionActionOptions':
        return undefined;
      default:
        throw new Error(`Unsupported declarativeNetRequest method: ${method}`);
    }
  }

  private extensionUrl(extensionId: string, path: string): string {
    const dynamicId = this.dynamicIds.get(extensionId);
    const manifest = this.session.extensions.getExtension(extensionId)?.manifest as
      { web_accessible_resources?: { resources?: unknown; use_dynamic_url?: unknown }[] } | undefined;
    const dynamic =
      dynamicId &&
      (manifest?.web_accessible_resources ?? []).some(
        (entry) => entry?.use_dynamic_url === true && resourceListed(entry.resources, path),
      );
    return `chrome-extension://${dynamic ? dynamicId : extensionId}${path}`;
  }

  private async attach(extension: Extension | null): Promise<ExtensionRules | undefined> {
    if (!extension) return undefined;
    const existing = this.rules.get(extension.id);
    if (existing) return existing;
    const saved = this.saved[extension.id] ?? {};
    const rulesets = staticRulesets(extension.manifest);
    const dynamic = validRules(saved.dynamic ?? [], true);
    const rules: ExtensionRules = {
      rulesets,
      enabled: new Set(saved.enabled ?? rulesets.filter((ruleset) => ruleset.enabled).map((ruleset) => ruleset.id)),
      loaded: new Map(),
      disabled: new Map(Object.entries(saved.disabled ?? {}).map(([id, list]) => [id, new Set(ids(list))])),
      dynamic,
      session: [],
      dynamicIndex: new RuleIndex(dynamic, '_dynamic'),
      sessionIndex: new RuleIndex([], '_session'),
      allowsFrames: false,
      ready: Promise.resolve(),
    };
    this.rules.set(extension.id, rules);
    rules.ready = Promise.all([...rules.enabled].map((id) => this.loadRuleset(extension, rules, id))).then(() =>
      this.refreshFrameRules(rules),
    );
    await rules.ready;
    return rules;
  }

  private async loadRuleset(extension: Extension, rules: ExtensionRules, id: string): Promise<void> {
    const ruleset = rules.rulesets.find((candidate) => candidate.id === id);
    const file = ruleset ? extensionFile(extension.path, extension.id, ruleset.path) : null;
    if (!file) {
      rules.enabled.delete(id);
      return;
    }
    try {
      const all = validRules(JSON.parse(await fs.promises.readFile(file, 'utf8')), true);
      const disabled = rules.disabled.get(id);
      if (rules.enabled.has(id))
        rules.loaded.set(id, new RuleIndex(disabled ? all.filter((rule) => !disabled.has(rule.id)) : all, id));
    } catch (error) {
      console.warn(`[net-request] ruleset ${id} of ${extension.id} could not be read:`, error);
      rules.enabled.delete(id);
    }
  }

  private async updateEnabled(
    extensionId: string,
    rules: ExtensionRules,
    disable: string[],
    enable: string[],
  ): Promise<void> {
    for (const id of [...disable, ...enable])
      if (!rules.rulesets.some((ruleset) => ruleset.id === id)) throw new Error(`Invalid ruleset id: ${id}.`);
    const next = new Set(rules.enabled);
    for (const id of disable) next.delete(id);
    for (const id of enable) next.add(id);
    if (next.size > MAX_ENABLED_RULESETS) throw new Error('The number of enabled static rulesets exceeds the limit.');
    for (const id of disable) {
      rules.enabled.delete(id);
      rules.loaded.delete(id);
    }
    const extension = this.session.extensions.getExtension(extensionId);
    const added = enable.filter((id) => !rules.enabled.has(id));
    for (const id of added) rules.enabled.add(id);
    if (extension) await Promise.all(added.map((id) => this.loadRuleset(extension, rules, id)));
    this.refreshFrameRules(rules);
    this.save();
  }

  private async updateStatic(extensionId: string, rules: ExtensionRules, options: Record<string, unknown>) {
    const id = String(options.rulesetId);
    if (!rules.rulesets.some((ruleset) => ruleset.id === id)) throw new Error(`Invalid ruleset id: ${id}.`);
    const disabled = rules.disabled.get(id) ?? new Set<number>();
    for (const rule of ids(options.disableRuleIds)) disabled.add(rule);
    for (const rule of ids(options.enableRuleIds)) disabled.delete(rule);
    if (disabled.size > 0) rules.disabled.set(id, disabled);
    else rules.disabled.delete(id);
    const extension = this.session.extensions.getExtension(extensionId);
    if (extension && rules.enabled.has(id)) await this.loadRuleset(extension, rules, id);
    this.refreshFrameRules(rules);
    this.save();
  }

  private updated(current: NetRule[], options: Record<string, unknown>, limit: number, other: NetRule[]): NetRule[] {
    const removed = new Set(ids(options.removeRuleIds));
    const added = validRules(options.addRules ?? [], false);
    const kept = current.filter((rule) => !removed.has(rule.id));
    for (const rule of added)
      if (kept.some((existing) => existing.id === rule.id))
        throw new Error(`Rule with id ${rule.id} does not have a unique ID.`);
    const next = [...kept, ...added];
    if (next.length > limit) throw new Error('The number of rules exceeds the limit.');
    const regexCount = [...next, ...other].filter((rule) => rule.condition.regexFilter !== undefined).length;
    if (regexCount > MAX_REGEX_RULES) throw new Error('The number of regex rules exceeds the limit.');
    return next;
  }

  private filtered(list: NetRule[], wanted: unknown): NetRule[] {
    const only = Array.isArray(wanted) ? new Set(ids(wanted)) : null;
    return structuredClone(only ? list.filter((rule) => only.has(rule.id)) : list);
  }

  private indexes(rules: ExtensionRules): RuleIndex[] {
    return [...rules.loaded.values(), rules.dynamicIndex, rules.sessionIndex];
  }

  private refreshFrameRules(rules: ExtensionRules): void {
    rules.allowsFrames = this.indexes(rules).some((index) => index.allowsFrames);
  }

  private frameAllowed(indexes: RuleIndex[], request: NetRequest, frame: WebFrameMain | null, type: string): number {
    const start = type === 'main_frame' ? null : type === 'sub_frame' ? (frame?.parent ?? null) : frame;
    let best = 0;
    try {
      for (let current = start; current; current = current.parent) {
        const parent = current.parent;
        const match = bestMatch(
          indexes,
          {
            url: current.url,
            method: 'get',
            type: parent ? 'sub_frame' : 'main_frame',
            initiator: this.origin(parent),
            tabId: request.tabId,
          },
          (rule) => rule.action.type === 'allowAllRequests',
        );
        if (match) best = Math.max(best, match.rule.priority ?? 1);
      }
    } catch {
      return best;
    }
    return best;
  }

  private frameOf(details: RequestDetails): WebFrameMain | null {
    try {
      return details.frame ?? null;
    } catch {
      return null;
    }
  }

  private origin(frame: WebFrameMain | null): string | null {
    try {
      return frame && frame.origin !== 'null' ? frame.origin : null;
    } catch {
      return null;
    }
  }

  private save(): void {
    for (const [id, rules] of this.rules) {
      this.saved[id] = {
        enabled: [...rules.enabled],
        dynamic: rules.dynamic,
        disabled: Object.fromEntries([...rules.disabled].map(([ruleset, list]) => [ruleset, [...list]])),
      };
    }
    this.store.schedule(() => this.saved);
  }

  private read(file: string): Record<string, Saved> {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, Saved>) : {};
    } catch {
      return {};
    }
  }
}
