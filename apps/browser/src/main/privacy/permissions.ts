import fs from 'node:fs';
import path from 'node:path';
import { t, type MessageKey } from '../../shared/i18n.js';
import { JsonFile } from '../storage/json-file.js';

export type SitePermission = 'camera' | 'microphone' | 'geolocation' | 'notifications' | 'popups';
export type Decision = 'allow' | 'deny';

const SITE_PERMISSIONS: readonly SitePermission[] = ['camera', 'microphone', 'geolocation', 'notifications', 'popups'];

export function permissionLabel(kind: SitePermission): string {
  return t(`permissions.${kind}` satisfies MessageKey);
}

export function requestedPermissions(permission: string, mediaTypes: readonly string[] = []): SitePermission[] | null {
  switch (permission) {
    case 'media': {
      const kinds: SitePermission[] = [];
      if (mediaTypes.includes('video')) kinds.push('camera');
      if (mediaTypes.includes('audio')) kinds.push('microphone');
      return kinds.length > 0 ? kinds : null;
    }
    case 'geolocation':
      return ['geolocation'];
    case 'notifications':
      return ['notifications'];
    default:
      return null;
  }
}

export function permissionOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function permissionQuestion(host: string, kinds: readonly SitePermission[]): string {
  if (kinds.includes('geolocation')) return t('permissions.askLocation', { host });
  if (kinds.includes('notifications')) return t('permissions.askNotifications', { host });
  if (kinds.includes('camera')) {
    return t(kinds.includes('microphone') ? 'permissions.askCameraAndMicrophone' : 'permissions.askCamera', { host });
  }
  return t('permissions.askMicrophone', { host });
}

interface SavedPermissions {
  version: 1;
  sites: Record<string, Partial<Record<SitePermission, Decision>>>;
}

export class PermissionStore {
  readonly file: string | null;
  private readonly json: JsonFile | null;
  private readonly sites = new Map<string, Map<SitePermission, Decision>>();
  private readonly once = new Set<string>();

  constructor(directory: string | null) {
    this.file = directory === null ? null : path.join(directory, 'permissions.json');
    this.json = this.file === null ? null : new JsonFile(this.file, 'permissions');
    this.load();
  }

  decide(origin: string, kinds: readonly SitePermission[]): Decision | 'ask' {
    const decisions = kinds.map(
      (kind) => this.get(origin, kind) ?? (this.once.has(`${origin} ${kind}`) ? 'allow' : undefined),
    );
    if (decisions.includes('deny')) return 'deny';
    return decisions.every((decision) => decision === 'allow') ? 'allow' : 'ask';
  }

  get(origin: string, kind: SitePermission): Decision | undefined {
    return this.sites.get(origin)?.get(kind);
  }

  list(origin: string): { kind: SitePermission; decision: Decision }[] {
    const site = this.sites.get(origin);
    return SITE_PERMISSIONS.flatMap((kind) => {
      const decision = site?.get(kind);
      return decision ? [{ kind, decision }] : [];
    });
  }

  set(origin: string, kinds: readonly SitePermission[], decision: Decision | null): void {
    let site = this.sites.get(origin);
    for (const kind of kinds) {
      this.once.delete(`${origin} ${kind}`);
      if (decision) {
        site ??= new Map();
        this.sites.set(origin, site);
        site.set(kind, decision);
      } else {
        site?.delete(kind);
      }
    }
    if (site?.size === 0) this.sites.delete(origin);
    this.save();
  }

  allowOnce(origin: string, kinds: readonly SitePermission[]): void {
    for (const kind of kinds) this.once.add(`${origin} ${kind}`);
  }

  private load(): void {
    if (this.file === null) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as SavedPermissions;
      if (data.version !== 1 || typeof data.sites !== 'object' || data.sites === null) return;
      for (const [origin, saved] of Object.entries(data.sites)) {
        if (permissionOrigin(origin) !== origin || typeof saved !== 'object' || saved === null) continue;
        const site = new Map<SitePermission, Decision>();
        for (const kind of SITE_PERMISSIONS) {
          const decision = saved[kind];
          if (decision === 'allow' || decision === 'deny') site.set(kind, decision);
        }
        if (site.size > 0) this.sites.set(origin, site);
      }
    } catch {}
  }

  saveNow(): void {
    this.json?.flush();
  }

  private save(): void {
    this.json?.schedule((): SavedPermissions => ({
      version: 1,
      sites: Object.fromEntries([...this.sites].map(([origin, site]) => [origin, Object.fromEntries(site)])),
    }));
  }
}
