import { app, dialog, type BaseWindow, type MessageBoxOptions, type WebContents } from 'electron';
import { t } from '../../shared/i18n.js';
import { INTERNAL_SCHEME } from '../../shared/types.js';
import { permissionOrigin, type PermissionStore } from './permissions.js';

// Sign-in pages hand their token back to an app through a link like slack://… or zoommtg://…. Electron asks the
// session for an "openExternal" permission before it passes such a link to the system, so Yalqen asks the user,
// like Chrome's "Open Slack?", and remembers "Always allow" as the site's "Open apps" permission.

// Schemes the browser shows itself, and ones that run code; none of them is an app hand-off.
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

// macOS reports "Slack.app"; the prompt says "Slack".
export function appDisplayName(name: string): string {
  return name.replace(/\.app$/i, '').trim();
}

export interface AppLinkPrompt {
  app: string;
  // The site asking, for "Always allow"; null for pages that are not web sites.
  host: string | null;
}

export interface AppLinksOptions {
  storeFor: (isPrivate: boolean) => PermissionStore;
  // The app the system opens this link with, or '' when there is none.
  appFor?: (url: string) => string;
  confirm: (prompt: AppLinkPrompt, contents: WebContents | null) => Promise<{ open: boolean; always: boolean }>;
}

export class AppLinks {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, Promise<boolean>>();

  constructor(private readonly options: AppLinksOptions) {}

  // Whether to hand this link to its app. Prompts come one at a time, and a page asking again for the same link
  // while its prompt is up gets the same answer instead of a second prompt.
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
    // With no app for the link there is nothing to open; Linux cannot say, so it asks anyway.
    if (!name && process.platform !== 'linux') return false;
    const origin = permissionOrigin(requestingUrl);
    const store = this.options.storeFor(isPrivate);
    if (origin) {
      const decided = store.decide(origin, ['apps']);
      if (decided !== 'ask') return decided === 'allow';
    }
    const { open, always } = await this.options.confirm(
      { app: name || t('appLinks.anApp'), host: origin ? new URL(origin).host : null },
      contents,
    );
    if (open && always && origin) store.set(origin, ['apps'], 'allow');
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

// The prompt, attached to the window when there is one. Cancel is the safe default only for Escape; Open is the
// button the page meant the user to press.
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
