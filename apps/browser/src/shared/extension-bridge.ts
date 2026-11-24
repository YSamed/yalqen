export const ExtensionBridgeChannel = {
  createTab: 'yalqen-extension-bridge:create-tab',
  removeTabs: 'yalqen-extension-bridge:remove-tabs',
  currentTab: 'yalqen-extension-bridge:current-tab',
  cookies: 'yalqen-extension-bridge:cookies',
  windows: 'yalqen-extension-bridge:windows',
  contextMenus: 'yalqen-extension-bridge:context-menus',
  notifications: 'yalqen-extension-bridge:notifications',
  library: 'yalqen-extension-bridge:library',
  sidePanel: 'yalqen-extension-bridge:side-panel',
  action: 'yalqen-extension-bridge:action',
  subscribe: 'yalqen-extension-bridge:subscribe',
  event: 'yalqen-extension-bridge:event',
} as const;

export type ExtensionBridgeEvent =
  | 'tabs.onUpdated'
  | 'tabs.onRemoved'
  | 'cookies.onChanged'
  | 'windows.onFocusChanged'
  | 'windows.onCreated'
  | 'windows.onRemoved'
  | 'webNavigation.onBeforeNavigate'
  | 'webNavigation.onCommitted'
  | 'webNavigation.onDOMContentLoaded'
  | 'webNavigation.onCompleted'
  | 'webNavigation.onErrorOccurred'
  | 'webNavigation.onHistoryStateUpdated'
  | 'commands.onCommand'
  | 'contextMenus.onClicked'
  | 'notifications.onClicked'
  | 'notifications.onButtonClicked'
  | 'notifications.onClosed'
  | 'history.onVisited'
  | 'history.onVisitRemoved'
  | 'bookmarks.onCreated'
  | 'bookmarks.onRemoved'
  | 'bookmarks.onChanged'
  | 'bookmarks.onMoved'
  | 'downloads.onCreated'
  | 'downloads.onChanged'
  | 'downloads.onErased'
  | 'sidePanel.onOpened'
  | 'sidePanel.onClosed'
  | 'action.onClicked';

export const WINDOW_ID_NONE = -1;

export interface ExtensionWindowState {
  id: number;
  focused: boolean;
}

export interface ExtensionWindows {
  currentId: number | null;
  windows: ReturnType<typeof chromeWindow>[];
}

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

const SHORTCUT_PLATFORMS: Record<string, string> = { darwin: 'mac', win32: 'windows', linux: 'linux' };

export function suggestedShortcut(suggested: unknown, platform: string): string {
  if (typeof suggested === 'string') return suggested;
  if (typeof suggested !== 'object' || suggested === null) return '';
  const keys = suggested as Record<string, unknown>;
  const value = keys[SHORTCUT_PLATFORMS[platform] ?? ''] ?? keys.default;
  return typeof value === 'string' ? value : '';
}

export interface ShortcutInput {
  code: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

const NAMED_KEYS: Record<string, string> = {
  Comma: 'Comma',
  Period: 'Period',
  Space: 'Space',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Insert: 'Insert',
  Delete: 'Delete',
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
};

function keyCode(key: string): string | undefined {
  if (/^[A-Z]$/.test(key)) return `Key${key}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  if (/^F([1-9]|1[0-2])$/.test(key)) return key;
  return Object.hasOwn(NAMED_KEYS, key) ? NAMED_KEYS[key] : undefined;
}

// Chrome reads "Ctrl" as Command on macOS and "MacCtrl" as the Control key.
export function shortcutMatches(shortcut: string, input: ShortcutInput, platform: string): boolean {
  const parts = shortcut.split('+').map((part) => part.trim());
  const code = keyCode(parts.pop() ?? '');
  if (!code || parts.length === 0) return false;
  const mac = platform === 'darwin';
  const wanted = { control: false, meta: false, alt: false, shift: false };
  for (const part of parts) {
    if (part === 'Ctrl') wanted[mac ? 'meta' : 'control'] = true;
    else if (part === 'Command' && mac) wanted.meta = true;
    else if (part === 'MacCtrl' && mac) wanted.control = true;
    else if (part === 'Alt') wanted.alt = true;
    else if (part === 'Shift') wanted.shift = true;
    else return false;
  }
  return (
    input.code === code &&
    input.control === wanted.control &&
    input.meta === wanted.meta &&
    input.alt === wanted.alt &&
    input.shift === wanted.shift
  );
}
