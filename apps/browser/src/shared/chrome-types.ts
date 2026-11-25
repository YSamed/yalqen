import type {
  AgentBackgroundChat,
  AgentChatState,
  AgentElementRef,
  AgentProjectSummary,
  AgentProviderId,
  AgentSessionState,
  ProjectRunState,
} from './agent.js';
import type { DeviceFrame, Favorite, TabId, TabSnapshot } from './tab-types.js';

export type WindowMaterial = 'glass' | 'opaque';

export const TOOLBAR_BUTTON_IDS = [
  'home',
  'bookmarks',
  'history',
  'extensions',
  'profile',
  'settings',
  'screenshot',
  'downloads',
] as const;
export type ToolbarButtonId = (typeof TOOLBAR_BUTTON_IDS)[number];

export const SIDEBAR_FOOTER_ITEMS = [
  'history',
  'bookmarks',
  'spaces',
  'downloads',
  'extensions',
  'screenshot',
  'settings',
  'profile',
] as const;
export type SidebarFooterItem = (typeof SIDEBAR_FOOTER_ITEMS)[number];
export const MAX_SIDEBAR_FOOTER_ITEMS = 4;
export const DEFAULT_SIDEBAR_FOOTER_ITEMS: SidebarFooterItem[] = ['spaces', 'downloads', 'screenshot'];

export function isSidebarFooterItem(value: unknown): value is SidebarFooterItem {
  return (SIDEBAR_FOOTER_ITEMS as readonly unknown[]).includes(value);
}

export function sanitizeSidebarFooterItems(value: unknown, fallback: SidebarFooterItem[]): SidebarFooterItem[] {
  if (!Array.isArray(value)) return fallback;
  return [...new Set(value)].filter(isSidebarFooterItem).slice(0, MAX_SIDEBAR_FOOTER_ITEMS);
}

export function placeSidebarFooterItem(
  items: readonly SidebarFooterItem[],
  item: SidebarFooterItem,
  index: number,
): SidebarFooterItem[] {
  const rest = items.filter((candidate) => candidate !== item);
  rest.splice(Math.max(0, Math.min(index, rest.length)), 0, item);
  return rest.slice(0, MAX_SIDEBAR_FOOTER_ITEMS);
}

export const DEFAULT_ZOOM_FACTORS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;

export const DISCARD_AFTER_MINUTES = [0, 15, 30, 60, 120] as const;
export const AUTO_ARCHIVE_HOURS = [0, 12, 24, 168, 720] as const;

export interface BrowserState {
  tabs: TabSnapshot[];
  listOrder: TabId[];
  developer: boolean;
  activeTabId: TabId | null;
  selectedTabIds: TabId[];
  splitTabIds: TabId[];
  splitGroups?: TabId[][];
  splitWeights?: (number[] | null)[];
  devToolsDivider?: { x: number; y: number; width: number; height: number; value: number } | null;
  tabGroups?: import('./tab-groups').TabGroup[];
  liveFolders?: import('./live-folders').LiveFolderView[];
  spaces: import('./workspaces').SpaceView[];
  activeSpaceId: string;
  pageFullScreen: boolean;
  windowFullScreen: boolean;
  windowMenu?: boolean;
  panelCollapsed: boolean;
  tabCleanup?: boolean;
  tabModes?: boolean;
  bookmarksPanel?: import('./bookmarks-panel').BookmarksPanelView | null;
  modeSwitch?: boolean;
  favorites: Favorite[];
  sidebarVisible: boolean;
  media: import('./sidebar-widgets').MediaInfo | null;
  toolbarButtons: ToolbarButtonId[];
  sidebarFooterItems: SidebarFooterItem[];
  material: WindowMaterial;
  frameTheme?: import('./frame-theme').FrameTheme;
  accent: string;
  device: DeviceFrame | null;
  zoom: number;
  defaultZoom: number;
  downloads: DownloadsSummary;
  extensions: boolean;
  profile: ProfileKind;
  agentPanelOpen: boolean;
  agentFloating?: boolean;
  agentSession: AgentSessionState;
  agentChat: AgentChatState;
  agentProviders: AgentProviderId[];
  projectRun: ProjectRunState;
  agentElements: AgentElementRef[];
  agentTerminal: boolean;
  agentProjects: AgentProjectSummary[];
  agentProjectId: string;
  agentConversationId: string;
  agentBackgroundChats: AgentBackgroundChat[];
  updateReady?: boolean;
}

export type ProfileKind = 'personal' | 'developer' | 'private';

export interface DownloadsSummary {
  active: number;
  progress: number | null;
  started: number;
}

export interface ChromeLayout {
  panelWidth: number;
  panelSlide: number;
  chromeHeight: number;
  pageInset: number;
  pageRadius: number;
  agentPanelWidth?: number;
}

export interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
