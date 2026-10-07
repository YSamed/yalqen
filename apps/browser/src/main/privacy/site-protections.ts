import type { SettingsValues } from '../../shared/types.js';

export type SiteProtection = 'adBlocking' | 'blockThirdPartyCookies';
const exceptionKey = {
  adBlocking: 'adBlockExceptions',
  blockThirdPartyCookies: 'thirdPartyCookieExceptions',
} as const;

export function protectionOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function sanitizeProtectionExceptions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.slice(0, 500).flatMap((url) => {
        const origin = typeof url === 'string' ? protectionOrigin(url) : null;
        return origin ? [origin] : [];
      }),
    ),
  ];
}

export class SiteProtections {
  private readonly privateChoices = new Map<string, Partial<Record<SiteProtection, boolean>>>();

  constructor(
    private readonly settings: () => SettingsValues,
    private readonly update: (patch: Partial<SettingsValues>) => void,
  ) {}

  isAllowed(kind: SiteProtection, url: string, isPrivate = false): boolean {
    const origin = protectionOrigin(url);
    if (!origin) return false;
    const choice = isPrivate ? this.privateChoices.get(origin)?.[kind] : undefined;
    return choice ?? this.settings()[exceptionKey[kind]].includes(origin);
  }

  setAllowed(kind: SiteProtection, url: string, isPrivate: boolean, allowed: boolean): void {
    const origin = protectionOrigin(url);
    if (!origin) return;
    if (isPrivate) {
      this.privateChoices.set(origin, { ...this.privateChoices.get(origin), [kind]: allowed });
      return;
    }
    const key = exceptionKey[kind];
    const origins = this.settings()[key].filter((entry) => entry !== origin);
    if (allowed) origins.push(origin);
    this.update({ [key]: origins });
  }

  clearPrivate(): void {
    this.privateChoices.clear();
  }
}
