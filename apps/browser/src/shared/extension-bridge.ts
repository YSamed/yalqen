export const ExtensionBridgeChannel = {
  createTab: 'yalqen-extension-bridge:create-tab',
  removeTabs: 'yalqen-extension-bridge:remove-tabs',
  cookies: 'yalqen-extension-bridge:cookies',
  windows: 'yalqen-extension-bridge:windows',
  subscribe: 'yalqen-extension-bridge:subscribe',
  event: 'yalqen-extension-bridge:event',
} as const;

export type ExtensionBridgeEvent =
  | 'tabs.onUpdated'
  | 'tabs.onRemoved'
  | 'cookies.onChanged'
  | 'windows.onFocusChanged'
  | 'windows.onCreated'
  | 'windows.onRemoved';

export const WINDOW_ID_NONE = -1;

export interface ExtensionWindowState {
  id: number;
  focused: boolean;
}

export interface ExtensionWindows {
  currentId: number | null;
  windows: ReturnType<typeof chromeWindow>[];
}

// The fields of chrome.windows.Window that extensions read; every Yalqen window is a normal one.
export function chromeWindow({ id, focused }: ExtensionWindowState) {
  return { id, focused, type: 'normal', state: 'normal', incognito: false, alwaysOnTop: false };
}

const EXTENSION_ID = /^[a-p]{32}$/;

export function extensionIdOf(url: string): string | null {
  try {
    const { protocol, host } = new URL(url);
    return protocol === 'chrome-extension:' && EXTENSION_ID.test(host) ? host : null;
  } catch {
    return null;
  }
}

// chrome.identity.getRedirectURL() points here; Chrome hands these URLs to the extension instead of loading them.
export function authRedirectExtension(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    const match = /^([a-p]{32})\.chromiumapp\.org$/.exec(hostname);
    return protocol === 'https:' && match ? match[1] : null;
  } catch {
    return null;
  }
}

export function extensionTabUrl(raw: unknown, extensionId: string): string | null {
  if (raw === undefined) return null;
  if (typeof raw !== 'string') throw new Error('Tab url must be a string');
  let url: URL;
  try {
    url = new URL(raw, `chrome-extension://${extensionId}/`);
  } catch {
    throw new Error(`Invalid tab url: ${raw}`);
  }
  if (url.protocol === 'http:' || url.protocol === 'https:') return url.href;
  if (url.protocol === 'chrome-extension:' && url.host === extensionId) return url.href;
  throw new Error(`Cannot open ${url.protocol} urls from an extension`);
}
