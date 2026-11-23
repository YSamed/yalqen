import fs from 'node:fs';
import path from 'node:path';
import type { CallbackResponse, Extension, OnBeforeRequestListenerDetails } from 'electron';
import { JsonFile } from '../storage/json-file.js';
import { DnrRuleset, dnrResourceType, type DnrOutcome } from './declarative-net-request.js';

const MAX_DYNAMIC_RULES = 30_000;
const MAX_SESSION_RULES = 5_000;
const MAX_RULESET_BYTES = 64 * 1024 * 1024;
const PERMISSIONS = new Set(['declarativeNetRequest', 'declarativeNetRequestWithHostAccess']);

interface RuleResource {
  id: string;
  enabled: boolean;
  path: string;
}

interface SavedRules {
  enabled: string[];
  dynamic: unknown[];
}

interface Loaded {
  extension: Extension;
  resources: RuleResource[];
  enabled: string[];
  dynamic: unknown[];
  session: unknown[];
  ruleset: DnrRuleset | null;
  version: number;
}

function ruleResources(manifest: unknown): RuleResource[] | null {
  const { permissions, declarative_net_request: dnr } = (manifest ?? {}) as {
    permissions?: unknown;
    declarative_net_request?: { rule_resources?: unknown };
  };
  if (!Array.isArray(permissions) || !permissions.some((name) => PERMISSIONS.has(name))) return null;
  const resources = Array.isArray(dnr?.rule_resources) ? dnr.rule_resources : [];
  return resources.flatMap((value: unknown) => {
    const { id, enabled, path: file } = (value ?? {}) as Record<string, unknown>;
    return typeof id === 'string' && typeof file === 'string' ? [{ id, enabled: enabled === true, path: file }] : [];
  });
}

const ruleArray = (value: unknown, max: number): unknown[] | null =>
  Array.isArray(value) && value.length <= max ? value : null;

// Electron skips Chromium's declarativeNetRequest whenever a session has webRequest listeners, and Yalqen's request
// gate is one, so the rules extensions keep in Chromium are mirrored here and applied from that gate.
export class DeclarativeNetRequest {
  private readonly json: JsonFile;
  private saved: Record<string, SavedRules> = {};
  private readonly loaded = new Map<string, Loaded>();
  private readonly allowAllUpTo = new Map<number, number>();

  constructor(file: string) {
    this.json = new JsonFile(file, 'declarative-net-request');
    try {
      const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
      for (const [id, rules] of Object.entries(value ?? {})) {
        const { enabled, dynamic } = (rules ?? {}) as Record<string, unknown>;
        const dynamicRules = ruleArray(dynamic, MAX_DYNAMIC_RULES);
        if (Array.isArray(enabled) && dynamicRules)
          this.saved[id] = { enabled: enabled.filter((item) => typeof item === 'string'), dynamic: dynamicRules };
      }
    } catch {}
  }

  load(extension: Extension): void {
    const resources = ruleResources(extension.manifest);
    if (!resources) return;
    const saved = this.saved[extension.id];
    const loaded: Loaded = {
      extension,
      resources,
      enabled: saved?.enabled ?? resources.filter((item) => item.enabled).map((item) => item.id),
      dynamic: saved?.dynamic ?? [],
      session: [],
      ruleset: null,
      version: 0,
    };
    this.loaded.set(extension.id, loaded);
    void this.rebuild(loaded);
  }

  unload(extensionId: string): void {
    this.loaded.delete(extensionId);
  }

  update(extensionId: string, state: unknown): void {
    const loaded = this.loaded.get(extensionId);
    if (!loaded || !state || typeof state !== 'object') return;
    const { enabled, dynamic, session } = state as Record<string, unknown>;
    const dynamicRules = ruleArray(dynamic, MAX_DYNAMIC_RULES);
    const sessionRules = ruleArray(session, MAX_SESSION_RULES);
    if (!Array.isArray(enabled) || !dynamicRules || !sessionRules) return;
    const known = new Set(loaded.resources.map((item) => item.id));
    loaded.enabled = enabled.filter((id): id is string => typeof id === 'string' && known.has(id));
    loaded.dynamic = dynamicRules;
    loaded.session = sessionRules;
    this.saved[extensionId] = { enabled: loaded.enabled, dynamic: loaded.dynamic };
    this.json.schedule(() => this.saved);
    void this.rebuild(loaded);
  }

  decide(details: OnBeforeRequestListenerDetails): CallbackResponse | null {
    if (this.loaded.size === 0) return null;
    const { url, initiatorOrigin, webContentsId } = details;
    if (url.startsWith('chrome-extension:') || initiatorOrigin?.startsWith('chrome-extension:')) return null;
    const type = dnrResourceType(details.resourceType);
    const frame = type === 'main_frame';
    const request = { url, method: details.method, type, initiator: initiatorOrigin ?? null };
    const floor = frame || webContentsId === undefined ? 0 : (this.allowAllUpTo.get(webContentsId) ?? 0);
    const outcomes: DnrOutcome[] = [];
    for (const { ruleset } of this.loaded.values()) {
      const outcome = ruleset?.match(request, floor);
      if (outcome) outcomes.push(outcome);
    }
    // shortcut: allowAllRequests is tracked per tab for its main frame only, not per sub-frame; enough for site allowlists.
    if (frame && webContentsId !== undefined) {
      const allowAll = Math.max(
        0,
        ...outcomes.map((item) => (item.type === 'allow' && item.allowAll ? item.priority : 0)),
      );
      if (allowAll > 0) this.allowAllUpTo.set(webContentsId, allowAll);
      else this.allowAllUpTo.delete(webContentsId);
    }
    if (outcomes.some((item) => item.type === 'block')) return { cancel: true };
    const redirect = outcomes.find((item) => item.type === 'redirect');
    return redirect ? { redirectURL: redirect.url } : null;
  }

  saveNow(): void {
    this.json.flush();
  }

  private async rebuild(loaded: Loaded): Promise<void> {
    const version = ++loaded.version;
    const root = path.resolve(loaded.extension.path);
    const lists = await Promise.all(
      loaded.resources
        .filter((item) => loaded.enabled.includes(item.id))
        .map(async (item) => {
          const file = path.resolve(root, `.${path.posix.normalize(`/${item.path}`)}`);
          if (!file.startsWith(root + path.sep)) return [];
          try {
            if ((await fs.promises.stat(file)).size > MAX_RULESET_BYTES) return [];
            const rules: unknown = JSON.parse(await fs.promises.readFile(file, 'utf8'));
            return Array.isArray(rules) ? rules : [];
          } catch (error) {
            console.warn(`[dnr] could not read ruleset ${item.id} of ${loaded.extension.id}:`, error);
            return [];
          }
        }),
    );
    if (version !== loaded.version || this.loaded.get(loaded.extension.id) !== loaded) return;
    loaded.ruleset = new DnrRuleset([...lists.flat(), ...loaded.dynamic, ...loaded.session], loaded.extension.id);
  }
}
