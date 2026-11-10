import type { MenuItemConstructorOptions } from 'electron';
import { t } from '../../shared/i18n.js';

export const ACTIVATION_MS = 5000;
export const MAX_BLOCKED = 10;
const LABEL_LENGTH = 60;

export function isActivation(inputType: string): boolean {
  return ['mouseDown', 'mouseUp', 'rawKeyDown', 'keyDown', 'touchEnd', 'gestureTap'].includes(inputType);
}

export function mayOpenWindow(activatedAt: number, now: number, allowedForSite: boolean): boolean {
  return allowedForSite || (activatedAt > 0 && now - activatedAt <= ACTIVATION_MS);
}

export function opensInPlace(url: string): boolean {
  return /^(https?:|about:blank$)/i.test(url);
}

export function isPeekable(url: string): boolean {
  return /^https?:/i.test(url);
}

// A shift+click on a link is the only page-opened window Chromium reports as a plain new window without features.
export function opensPeek(disposition: string, features: string, url: string): boolean {
  return disposition === 'new-window' && features === '' && isPeekable(url);
}

export function recordBlocked(blocked: readonly string[], url: string): string[] {
  if (!/^https?:/i.test(url)) return [...blocked];
  return [...blocked.filter((item) => item !== url), url].slice(-MAX_BLOCKED);
}

interface BlockedPopupsActions {
  open(url: string): void;
  allowSite(): void;
}

export function blockedPopupsTemplate(
  host: string,
  blocked: readonly string[],
  actions: BlockedPopupsActions,
): MenuItemConstructorOptions[] {
  return [
    { label: t('popups.blocked'), enabled: false },
    ...blocked.map((url) => ({
      label: url.length > LABEL_LENGTH ? `${url.slice(0, LABEL_LENGTH - 1)}…` : url,
      click: () => actions.open(url),
    })),
    { type: 'separator' },
    { label: t('popups.alwaysAllow', { host }), click: actions.allowSite },
  ];
}
