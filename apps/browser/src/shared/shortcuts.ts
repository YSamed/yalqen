import type { MessageKey } from './locales/en.js';

export const SHORTCUTS = [
  { id: 'settings', label: 'menu.settings', accelerator: 'CmdOrCtrl+,' },
  { id: 'newWindow', label: 'menu.newWindow', accelerator: 'CmdOrCtrl+N' },
  { id: 'newPrivateWindow', label: 'menu.newPrivateWindow', accelerator: 'CmdOrCtrl+Shift+N' },
  { id: 'closeWindow', label: 'menu.closeWindow', accelerator: 'CmdOrCtrl+Shift+W' },
  { id: 'addressBar', label: 'menu.addressBar', accelerator: 'CmdOrCtrl+L' },
  { id: 'openFile', label: 'menu.openFile', accelerator: 'CmdOrCtrl+O' },
  { id: 'savePage', label: 'menu.savePage', accelerator: 'CmdOrCtrl+S' },
  { id: 'savePdf', label: 'menu.savePdf', accelerator: 'CmdOrCtrl+Shift+S' },
  { id: 'fullPageScreenshot', label: 'menu.fullPageScreenshot', accelerator: 'CmdOrCtrl+Alt+S' },
  { id: 'captureArea', label: 'menu.captureArea', accelerator: 'CmdOrCtrl+Shift+X' },
  { id: 'print', label: 'menu.print', accelerator: 'CmdOrCtrl+P' },
  { id: 'copyAddress', label: 'menu.copyAddress', accelerator: 'CmdOrCtrl+Shift+C' },
  { id: 'find', label: 'menu.find', accelerator: 'CmdOrCtrl+F' },
  { id: 'findNext', label: 'menu.findNext', accelerator: 'CmdOrCtrl+G' },
  { id: 'findPrevious', label: 'menu.findPrevious', accelerator: 'CmdOrCtrl+Shift+G' },
  { id: 'toggleBookmark', label: 'menu.toggleBookmark', accelerator: 'CmdOrCtrl+D' },
  { id: 'allBookmarks', label: 'menu.allBookmarks', accelerator: 'CmdOrCtrl+Alt+B' },
  { id: 'saveReadingPage', label: 'readingList.savePage', accelerator: 'CmdOrCtrl+Shift+D' },
  { id: 'newTab', label: 'menu.newTab', accelerator: 'CmdOrCtrl+T' },
  { id: 'closeTab', label: 'menu.closeTab', accelerator: 'CmdOrCtrl+W' },
  { id: 'reopenClosedTab', label: 'menu.reopenClosedTab', accelerator: 'CmdOrCtrl+Shift+T' },
  { id: 'cleanTabs', label: 'menu.cleanTabs', accelerator: 'CmdOrCtrl+Shift+K' },
  { id: 'nextTab', label: 'menu.nextTab', accelerator: 'Ctrl+Tab' },
  { id: 'previousTab', label: 'menu.previousTab', accelerator: 'Ctrl+Shift+Tab' },
  { id: 'home', label: 'toolbar.home', accelerator: 'Alt+Home' },
  { id: 'reload', label: 'menu.reload', accelerator: 'CmdOrCtrl+R' },
  { id: 'hardReload', label: 'menu.hardReload', accelerator: 'CmdOrCtrl+Shift+R' },
  { id: 'toggleReader', label: 'reader.toggle', accelerator: 'CmdOrCtrl+Alt+R' },
  { id: 'actualSize', label: 'menu.actualSize', accelerator: 'CmdOrCtrl+0' },
  { id: 'zoomIn', label: 'menu.zoomIn', accelerator: 'CmdOrCtrl+Plus' },
  { id: 'zoomOut', label: 'menu.zoomOut', accelerator: 'CmdOrCtrl+-' },
  { id: 'togglePanel', label: 'menu.togglePanel', accelerator: 'CmdOrCtrl+Shift+P' },
  { id: 'toggleToolbar', label: 'menu.toggleToolbar', accelerator: 'CmdOrCtrl+Shift+B' },
  { id: 'toggleAgentPanel', label: 'agentPanel.toggle', accelerator: 'CmdOrCtrl+Shift+A' },
  { id: 'viewSource', label: 'menu.viewSource', accelerator: 'CmdOrCtrl+Alt+U' },
  { id: 'developerTools', label: 'menu.developerTools', accelerator: 'CmdOrCtrl+Alt+I' },
  { id: 'phoneView', label: 'menu.phoneView', accelerator: 'CmdOrCtrl+Alt+M' },
  { id: 'pickElement', label: 'menu.pickElement', accelerator: 'CmdOrCtrl+Alt+P' },
  { id: 'rotateDevice', label: 'menu.rotateDevice', accelerator: 'CmdOrCtrl+Alt+Shift+M' },
] as const satisfies readonly { id: string; label: MessageKey; accelerator: string }[];

export type ShortcutId = (typeof SHORTCUTS)[number]['id'];
export type ShortcutOverrides = Partial<Record<ShortcutId, string>>;

const MODIFIERS = ['CmdOrCtrl', 'Cmd', 'Ctrl', 'Alt', 'Shift'];
const MODIFIER_ALIASES: Record<string, string> = {
  cmdorctrl: 'CmdOrCtrl',
  commandorcontrol: 'CmdOrCtrl',
  cmd: 'Cmd',
  command: 'Cmd',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
};
const NAMED_KEYS = [
  'Plus',
  'Space',
  'Tab',
  'Enter',
  'Backspace',
  'Delete',
  'Insert',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Up',
  'Down',
  'Left',
  'Right',
  'Esc',
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
];
const KEYS = new Map<string, string>([
  ...NAMED_KEYS.map((key): [string, string] => [key.toLowerCase(), key]),
  ['return', 'Enter'],
  ['escape', 'Esc'],
  ...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-=,./;'[]\\`"].map((key): [string, string] => [key.toLowerCase(), key]),
]);

export function normalizeAccelerator(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 60) return null;
  const parts = value.replace(/\s+/g, '').split('+');
  const raw = parts.pop();
  const key = raw === '' && parts.at(-1) === '' ? (parts.pop(), 'Plus') : raw && KEYS.get(raw.toLowerCase());
  if (!key) return null;
  const modifiers = new Set<string>();
  for (const part of parts) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()];
    if (!modifier || modifiers.has(modifier)) return null;
    modifiers.add(modifier);
  }
  if (modifiers.size === 0 && !/^F\d+$/.test(key)) return null;
  return [...MODIFIERS.filter((modifier) => modifiers.has(modifier)), key].join('+');
}

export function sanitizeShortcuts(value: unknown): ShortcutOverrides {
  const input = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const result: ShortcutOverrides = {};
  for (const { id, accelerator } of SHORTCUTS) {
    const next = normalizeAccelerator(input[id]);
    if (next && next !== accelerator) result[id] = next;
  }
  return result;
}

export function shortcutAccelerator(id: ShortcutId, overrides: ShortcutOverrides): string {
  return overrides[id] ?? SHORTCUTS.find((shortcut) => shortcut.id === id)!.accelerator;
}

function conflictKey(accelerator: string, isMac: boolean): string {
  return normalizeAccelerator(accelerator.replace('CmdOrCtrl', isMac ? 'Cmd' : 'Ctrl')) ?? accelerator;
}

function reservedAccelerators(isMac: boolean): string[] {
  const digits = Array.from({ length: 9 }, (_, i) => i + 1);
  return [
    ...digits.map((digit) => `CmdOrCtrl+${digit}`),
    ...digits.map((digit) => `${isMac ? 'Ctrl' : 'Ctrl+Shift'}+${digit}`),
    'CmdOrCtrl+=',
    'CmdOrCtrl+Z',
    isMac ? 'Cmd+Shift+Z' : 'Ctrl+Y',
    'CmdOrCtrl+X',
    'CmdOrCtrl+C',
    'CmdOrCtrl+V',
    'CmdOrCtrl+A',
    ...(isMac ? ['Cmd+Alt+Shift+V', 'Cmd+H', 'Cmd+Alt+H', 'Cmd+Q'] : []),
  ];
}

export function shortcutConflicts(overrides: ShortcutOverrides, isMac: boolean): Set<ShortcutId> {
  const reserved = new Set(reservedAccelerators(isMac).map((accelerator) => conflictKey(accelerator, isMac)));
  const owners = new Map<string, ShortcutId[]>();
  for (const { id } of SHORTCUTS) {
    const key = conflictKey(shortcutAccelerator(id, overrides), isMac);
    owners.set(key, [...(owners.get(key) ?? []), id]);
  }
  return new Set([...owners].flatMap(([key, ids]) => (ids.length > 1 || reserved.has(key) ? ids : [])));
}
