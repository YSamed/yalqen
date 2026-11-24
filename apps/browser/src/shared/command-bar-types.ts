import type { AgentChatSession } from './agent.js';
import type { AnchorRect, SidebarFooterItem, WindowMaterial } from './chrome-types.js';
import type { DevCommandId } from './page-override-types.js';
import type { SearchEngineId, TabId } from './tab-types.js';

export interface CommandBarOpen {
  placeholder: string;
  mode: 'navigate' | 'new-tab' | 'sidebar-menu';
  value?: string;
  engines: { id: SearchEngineId; label: string }[];
  material: WindowMaterial;
  accent: string;
  menu?: SidebarMenu;
}

export type SidebarMenuKind = 'tabs' | 'chats' | 'spaces' | 'downloads';

export const SIDEBAR_MENU_COMMANDS = [
  'history',
  'bookmarks',
  'downloads',
  'extensions',
  'screenshot',
  'settings',
  'profile',
  'create-space',
  'edit-space',
  'import-space',
  'add-live-folder',
  'downloads-all',
  'downloads-folder',
] as const;
export type SidebarMenuCommand = (typeof SIDEBAR_MENU_COMMANDS)[number];

export interface SidebarMenu {
  kind: SidebarMenuKind;
  anchor: AnchorRect;
  tint: string | null;
  tabs: { id: TabId; title: string; url: string; faviconUrl: string | null }[];
  spaces: { id: string; name: string; icon: string | null; active: boolean }[];
  chats: AgentChatSession[];
  commands: SidebarMenuCommand[];
  downloadsActive: number;
  history: SidebarMenuLink[];
  bookmarks: SidebarMenuLink[];
  downloads: { id: string; filename: string; status: string }[];
  // Where menu rows can be dropped to become sidebar footer buttons; null when the footer is not customizable.
  footer: { rect: AnchorRect; items: SidebarFooterItem[] } | null;
}

export interface SidebarMenuLink {
  url: string;
  title: string;
  faviconUrl: string | null;
}
export interface AddressSuggestion {
  kind: 'tab' | 'bookmark' | 'history' | 'command';
  title: string;
  url: string;
  tabId?: TabId;
  commandId?: DevCommandId;
  hint?: string;
  faviconUrl?: string;
}

export interface CommandBarSuggestions {
  input: string;
  suggestions: AddressSuggestion[];
}

export type CommandBarAction =
  | { type: 'submit'; input: string; engine?: SearchEngineId }
  | { type: 'switch-tab'; id: TabId }
  | { type: 'run-command'; id: DevCommandId }
  | { type: 'dismiss' }
  | { type: 'input'; input: string }
  | { type: 'sidebar-command'; command: SidebarMenuCommand }
  | { type: 'switch-space'; id: string }
  | { type: 'open-space-menu'; id: string }
  | { type: 'open-chat'; id: string }
  | { type: 'open-link'; url: string }
  | { type: 'download-action'; id: string }
  | { type: 'place-footer-item'; item: SidebarFooterItem; index: number };

export const CommandBarChannel = {
  open: 'yalqen-command:open',
  suggestions: 'yalqen-command:suggestions',
  action: 'yalqen-command:action',
} as const;

export interface CommandBarApi {
  onOpen(listener: (open: CommandBarOpen) => void): () => void;
  onSuggestions(listener: (suggestions: CommandBarSuggestions) => void): () => void;
  send(action: CommandBarAction): void;
}
