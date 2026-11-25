import { app, dialog, type BaseWindow, type MessageBoxOptions, type Session, type WebContents } from 'electron';
import { t } from '../../shared/i18n.js';
import { INTERNAL_SCHEME } from '../../shared/types.js';
import { permissionOrigin, type PermissionStore } from './permissions.js';

const NOT_APP_LINKS = new Set([
  'http',
  'https',
  'file',
  'data',
  'blob',
  'about',
  'javascript',
  'vbscript',
  'view-source',
  'chrome',
  'chrome-extension',
  'devtools',
  'filesystem',
  INTERNAL_SCHEME,
]);

export function appLinkScheme(url: string | undefined): string | null {
  if (!url) return null;
  let scheme: string;
  try {
    scheme = new URL(url).protocol.slice(0, -1).toLowerCase();
  } catch {
    return null;
  }
  return /^[a-z][a-z0-9+.-]*$/.test(scheme) && !NOT_APP_LINKS.has(scheme) ? scheme : null;
}

export function appDisplayName(name: string): string {
  return name.replace(/\.app$/i, '').trim();
}

export interface AppLinkPrompt {
  app: string;
  host: string | null;
}

export interface AppLinksOptions {
  storeFor: (browsing: Session | null, isPrivate: boolean) => PermissionStore | null;
  appFor?: (url: string) => string;
  confirm: (prompt: AppLinkPrompt, contents: WebContents | null) => Promise<{ open: boolean; always: boolean }>;
}

export class AppLinks {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, Promise<boolean>>();

  constructor(private readonly options: AppLinksOptions) {}

  ask(
    contents: WebContents | null,
    url: string,
    requestingUrl: string | undefined,
    isPrivate: boolean,
  ): Promise<boolean> {
    if (!appLinkScheme(url)) return Promise.resolve(false);
    const key = `${contents?.id ?? 0} ${url}`;
    const waiting = this.pending.get(key);
    if (waiting) return waiting;
    const answer = this.queue.then(() => this.decide(contents, url, requestingUrl, isPrivate));
    this.queue = answer.catch(() => {});
    const settled = answer.catch(() => false);
    this.pending.set(key, settled);
    void settled.finally(() => this.pending.delete(key));
    return settled;
  }

  private async decide(
    contents: WebContents | null,
    url: string,
    requestingUrl: string | undefined,
    isPrivate: boolean,
  ): Promise<boolean> {
    const name = appDisplayName((this.options.appFor ?? appForUrl)(url));
    if (!name && process.platform !== 'linux') return false;
    const origin = permissionOrigin(requestingUrl);
    const store = this.options.storeFor(contents?.session ?? null, isPrivate);
    if (origin && store) {
      const decided = store.decide(origin, ['apps']);
      if (decided !== 'ask') return decided === 'allow';
    }
    const { open, always } = await this.options.confirm(
      { app: name || t('appLinks.anApp'), host: origin ? new URL(origin).host : null },
      contents,
    );
    if (open && always && origin) store?.set(origin, ['apps'], 'allow');
    return open;
  }
}

function appForUrl(url: string): string {
  try {
    return app.getApplicationNameForProtocol(url);
  } catch {
    return '';
  }
}

export function confirmAppLink(parentOf: (contents: WebContents) => BaseWindow | undefined) {
  return async (prompt: AppLinkPrompt, contents: WebContents | null): Promise<{ open: boolean; always: boolean }> => {
    const options: MessageBoxOptions = {
      type: 'question',
      message: t('appLinks.question', { app: prompt.app }),
      detail: prompt.host ? t('appLinks.detail', { host: prompt.host }) : t('appLinks.detailPage'),
      buttons: [t('appLinks.open', { app: prompt.app }), t('appLinks.cancel')],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      ...(prompt.host ? { checkboxLabel: t('appLinks.always', { host: prompt.host }), checkboxChecked: false } : {}),
    };
    const parent = contents && !contents.isDestroyed() ? parentOf(contents) : undefined;
    const { response, checkboxChecked } = parent
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    return { open: response === 0, always: checkboxChecked };
  };
}
