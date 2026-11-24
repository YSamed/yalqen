import { nativeImage, type NativeImage, type Session, type WebContents } from 'electron';
import {
  actionTitle,
  extensionFile,
  extensionPage,
  popupPage,
  sizedIcon,
  type Manifest,
} from './extension-manifest.js';
import { ownPage } from './side-panel-api.js';

export interface ActionHost {
  openAction(extensionId: string, contents: WebContents | null): void;
}

type Color = number[];

interface ActionValues {
  badgeText?: string;
  badgeBackgroundColor?: Color;
  badgeTextColor?: Color;
  title?: string;
  icon?: NativeImage;
  popup?: string;
  enabled?: boolean;
}

export interface ActionState {
  title: string;
  icon: NativeImage | null;
  badge: string;
  popupUrl: string | null;
  enabled: boolean;
  listens: boolean;
}

const ICON_SIZE = 16;
const MAX_TEXT = 1024;
const MAX_ICON_URL = 1024 * 1024;
const DEFAULT_BADGE_BACKGROUND: Color = [0, 0, 0, 0];
const DEFAULT_BADGE_TEXT: Color = [255, 255, 255, 255];
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

type Details = Record<string, unknown>;
const details = (value: unknown): Details => (typeof value === 'object' && value !== null ? (value as Details) : {});

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT) throw new Error(`Invalid ${name}.`);
  return value;
}

// shortcut: only hex and [r, g, b, a] colors parse, so CSS names like "red" are refused; parse them in the page if an extension needs it.
export function badgeColor(value: unknown): Color {
  if (Array.isArray(value) && value.length === 4 && value.every((n) => Number.isInteger(n) && n >= 0 && n <= 255))
    return [...(value as number[])];
  const hex = typeof value === 'string' ? /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1] : undefined;
  if (!hex) throw new Error('Invalid badge color.');
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  return [0, 2, 4].map((at) => parseInt(full.slice(at, at + 2), 16)).concat(255);
}

export function iconSource(value: Details): string | null {
  const raw = value.imageData ?? value.path;
  if (typeof raw === 'string') return raw || null;
  return sizedIcon(typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : null, ICON_SIZE);
}

// Values set without a tabId are global; a tab's own value wins until the tab closes.
export class ActionApi {
  private readonly values = new Map<string, ActionValues>();
  private readonly listening = new Set<string>();

  constructor(
    private readonly session: Session,
    private readonly host: ActionHost,
    private readonly tabContents: (id: number) => WebContents | null,
  ) {}

  forget(extensionId: string): void {
    for (const key of [...this.values.keys()]) if (key.split(':')[0] === extensionId) this.values.delete(key);
    this.listening.delete(extensionId);
  }

  dropTab(tabId: number): void {
    for (const key of [...this.values.keys()]) if (key.endsWith(`:${tabId}`)) this.values.delete(key);
  }

  // shortcut: listeners are known only once the extension's worker or page has run since launch, so a click before that falls through to the side panel or options page; persist them like Chrome's lazy listeners if that bites.
  state(extensionId: string, tab: WebContents | null): ActionState | null {
    const extension = this.session.extensions.getExtension(extensionId);
    if (!extension) return null;
    const value = this.resolver(extensionId, tab?.id ?? null);
    return {
      title: value('title') ?? actionTitle(extension.manifest as Manifest, extension.name),
      icon: value('icon') ?? null,
      badge: value('badgeText') ?? '',
      popupUrl: this.popupUrl(extension, value('popup')) || null,
      enabled: value('enabled') ?? true,
      listens: this.listening.has(extensionId),
    };
  }

  call(extensionId: string, method: string, args: unknown[]): unknown {
    const extension = this.session.extensions.getExtension(extensionId);
    if (!extension) throw new Error('Unknown extension');
    const [first] = args;
    const options = ['enable', 'disable', 'isEnabled'].includes(method) ? { tabId: first } : details(first);
    const { tabId } = options;
    if (tabId !== undefined && tabId !== null && typeof tabId !== 'number') throw new Error('Invalid tabId.');
    const tab = typeof tabId === 'number' ? this.tabContents(tabId) : null;
    if (typeof tabId === 'number' && !tab) throw new Error(`No tab with id: ${tabId}.`);
    const value = this.resolver(extensionId, tab?.id ?? null);
    const set = <K extends keyof ActionValues>(field: K, next: ActionValues[K] | null) => {
      const key = tab ? `${extensionId}:${tab.id}` : extensionId;
      const current = { ...this.values.get(key) };
      if (next === null) delete current[field];
      else current[field] = next;
      this.values.set(key, current);
    };
    const given = (name: string, parse: (raw: unknown) => unknown) =>
      options[name] === undefined || options[name] === null ? null : parse(options[name]);
    switch (method) {
      case 'setBadgeText':
        return set('badgeText', given('text', (raw) => text(raw, 'badge text')) as string | null);
      case 'getBadgeText':
        return value('badgeText') ?? '';
      case 'setBadgeBackgroundColor':
        return set('badgeBackgroundColor', badgeColor(options.color));
      case 'getBadgeBackgroundColor':
        return value('badgeBackgroundColor') ?? DEFAULT_BADGE_BACKGROUND;
      case 'setBadgeTextColor':
        return set('badgeTextColor', badgeColor(options.color));
      case 'getBadgeTextColor':
        return value('badgeTextColor') ?? DEFAULT_BADGE_TEXT;
      case 'setTitle':
        return set('title', given('title', (raw) => text(raw, 'title')) as string | null);
      case 'getTitle':
        return value('title') ?? actionTitle(extension.manifest as Manifest, '');
      case 'setIcon':
        return set('icon', this.loadIcon(extension, options));
      case 'setPopup': {
        const popup = given('popup', (raw) => text(raw, 'popup')) as string | null;
        if (popup && !ownPage(extension.url, popup)) throw new Error('Invalid popup.');
        return set('popup', popup);
      }
      case 'getPopup':
        return this.popupUrl(extension, value('popup'));
      case 'enable':
      case 'disable':
        return set('enabled', method === 'enable');
      case 'isEnabled':
        return value('enabled') ?? true;
      // shortcut: the popup opens in the focused window, whatever windowId says.
      case 'openPopup':
        if (!this.state(extensionId, null)?.popupUrl) throw new Error('No popup to open.');
        this.host.openAction(extensionId, null);
        return undefined;
      case 'listen':
        this.listening.add(extensionId);
        return undefined;
    }
    throw new Error(`Unsupported action method: ${method}`);
  }

  private resolver(extensionId: string, tabId: number | null) {
    const global = this.values.get(extensionId);
    const own = tabId === null ? undefined : this.values.get(`${extensionId}:${tabId}`);
    return <K extends keyof ActionValues>(field: K): ActionValues[K] => own?.[field] ?? global?.[field];
  }

  private popupUrl(extension: Electron.Extension, popup: string | undefined): string {
    if (popup !== undefined) return popup ? (ownPage(extension.url, popup) ?? '') : '';
    return extensionPage(extension.url, popupPage(extension.manifest as Manifest)) ?? '';
  }

  private loadIcon(extension: Electron.Extension, options: Details): NativeImage {
    const source = iconSource(options);
    if (!source) throw new Error('setIcon needs a path or imageData.');
    let image: NativeImage | null = null;
    if (source.startsWith('data:')) {
      if (source.length <= MAX_ICON_URL && IMAGE_DATA_URL.test(source)) image = nativeImage.createFromDataURL(source);
    } else {
      const file = extensionFile(extension.path, extension.id, source);
      if (file) image = nativeImage.createFromPath(file);
    }
    if (!image || image.isEmpty()) throw new Error('Could not load the action icon.');
    return image.resize({ width: ICON_SIZE, height: ICON_SIZE, quality: 'best' });
  }
}
