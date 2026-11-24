import type { VisualComparisonApi } from './visual-comparison.js';
import type { ResponsiveScanApi } from './responsive-scan.js';
import type {
  AgentEpisodePreview,
  AgentProjectSummary,
  AgentTerminalSize,
  AgentSessionState,
  ProjectRunState,
  AgentTerminalOutput,
  AgentTerminalSnapshot,
  AgentProviderId,
  AgentChatSession,
  AgentChatSettings,
  AgentChatState,
  AgentRewindPreview,
  AgentElementRef,
  AgentChatImage,
  AgentChatSnapshot,
  AgentActionPolicy,
  AgentSetupKind,
  AgentBackgroundChat,
  AgentSetupResult,
  AgentClientId,
  AgentConnections,
  AgentBridgeView,
} from './agent.js';

export type TabId = string;

export const INTERNAL_SCHEME = 'yalqen';
export const NEW_TAB_URL = 'yalqen://newtab/';
export const HISTORY_URL = 'yalqen://history/';
export const ARCHIVE_URL = 'yalqen://archive/';
export const DOWNLOADS_URL = 'yalqen://downloads/';
export const BOOKMARKS_URL = 'yalqen://bookmarks/';
export const SETTINGS_URL = 'yalqen://settings/';
export type CommandPage = 'downloads' | 'bookmarks';

export type SearchEngineId =
  'google' | 'yandex' | 'duckduckgo' | 'bing' | 'brave' | 'ecosia' | 'startpage' | 'kagi' | 'custom';
export type ThemeSource = 'system' | 'light' | 'dark';
export type SecureDnsSetting = 'off' | 'automatic' | 'cloudflare' | 'google' | 'quad9';
export type PageLanguage = 'tr' | 'en';
export type InterfaceLanguage = 'system' | 'tr' | 'en';
export type SecurityState = 'secure' | 'insecure' | 'dangerous' | 'local';
export type TranslationStatus = 'idle' | 'translating' | 'translated' | 'failed';

export interface TabTranslation {
  status: TranslationStatus;
  available: boolean;
}

export interface TabSnapshot {
  id: TabId;
  title: string;
  url: string;
  faviconUrl: string | null;
  pageColor?: string | null;
  live: boolean;
  frozen: boolean;
  loading: boolean;
  pinned: boolean;
  group?: string | null;
  security: SecurityState;
  isPrivate: boolean;
  developer?: boolean;
  bookmarked: boolean;
  blockedPopups: number;
  overrides: PageOverrides;
  translation: TabTranslation;
  autoReloadSeconds: number | null;
  audible: boolean;
  muted: boolean;
  unread: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  agentObserved: boolean;
  agentReadAt: number | null;
  agentEpisode: AgentEpisodePreview | null;
  agentRules: number;
}

export interface Favorite {
  url: string;
  title: string;
  faviconUrl: string | null;
}

export type DeviceId =
  | 'iphone-15'
  | 'iphone-15-pro-max'
  | 'iphone-16-pro'
  | 'iphone-se'
  | 'pixel-8'
  | 'pixel-9'
  | 'galaxy-s24'
  | 'ipad-mini'
  | 'responsive';

export interface DeviceFrame {
  label: string;
  width: number;
  height: number;
  scale: number;
  cornerRadius: number;
  resizable: boolean;
  deviceScaleFactor: number;
  x: number;
  y: number;
  viewWidth: number;
  viewHeight: number;
}

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

export type UiAction =
  | { type: 'new-tab'; url?: string }
  | { type: 'activate-tab'; id: TabId; animate?: boolean }
  | { type: 'select-tab'; id: TabId; mode: 'toggle' | 'range' }
  | { type: 'clear-tab-selection' }
  | { type: 'close-selected-tabs' }
  | { type: 'clean-tabs' }
  | { type: 'rename-tab-group'; name: string; next: string }
  | { type: 'toggle-tab-group'; name: string }
  | { type: 'move-tab-to-group'; id: TabId; name: string | null }
  | { type: 'move-tab-group'; name: string; parent: string | null }
  | { type: 'open-folder-menu'; name: string }
  | { type: 'add-live-folder'; kind: import('./live-folders').LiveFolderKind; input: string }
  | { type: 'toggle-live-folder'; id: string }
  | { type: 'refresh-live-folder'; id: string }
  | { type: 'open-live-folder-menu'; id: string }
  | { type: 'open-live-item'; id: string; itemId: string }
  | { type: 'switch-space'; id: string }
  | { type: 'create-space' }
  | { type: 'import-space' }
  | { type: 'open-space-menu'; id: string }
  | { type: 'close-tab'; id: TabId }
  | { type: 'open-favorite'; url: string }
  | { type: 'open-favorite-menu'; url: string }
  | { type: 'toggle-mute'; id: TabId }
  | { type: 'toggle-media'; id: TabId }
  | { type: 'show-tooltip'; tooltip: import('./tooltip').TooltipRequest }
  | { type: 'hide-tooltip' }
  | { type: 'show-preview'; preview: import('./previews').PreviewRequest }
  | { type: 'leave-preview' }
  | { type: 'hide-preview' }
  | { type: 'seek-media'; id: TabId; seconds: number }
  | { type: 'skip-media'; id: TabId; direction: import('./sidebar-widgets').MediaSkip }
  | { type: 'open-tab-menu'; id: TabId }
  | { type: 'move-tab'; id: TabId; toIndex: number }
  | { type: 'preview-split'; id: TabId | null; side: 'left' | 'right' }
  | { type: 'split-tab'; id: TabId; side: 'left' | 'right' }
  | { type: 'navigate'; input: string }
  | { type: 'go-home' }
  | { type: 'go-back' }
  | { type: 'go-forward' }
  | { type: 'reload' }
  | { type: 'resize-devtools'; x: number }
  | { type: 'resize-split'; index: number; x: number }
  | { type: 'open-dev-menu' }
  | { type: 'dev-command'; id: DevCommandId }
  | { type: 'resize-device'; width: number; height: number }
  | { type: 'set-device-scale-factor'; value: number }
  | { type: 'stop' }
  | { type: 'reset-zoom' }
  | { type: 'open-site-info' }
  | { type: 'set-tab-mode'; mode: import('./tab-modes').TabMode }
  | { type: 'open-blocked-popups' }
  | { type: 'toggle-bookmark' }
  | { type: 'open-bookmarks-menu' }
  | { type: 'toggle-bookmarks-panel' }
  | { type: 'open-bookmark'; url: string }
  | { type: 'edit-bookmark'; id: string; title: string; url: string }
  | { type: 'rename-bookmark-folder'; id: string; title: string }
  | { type: 'open-bookmarks-page' }
  | { type: 'toggle-panel' }
  | { type: 'toggle-agent-panel' }
  | { type: 'set-agent-floating'; floating: boolean }
  | { type: 'move-floating-chat'; dx: number; dy: number }
  | { type: 'window-control'; control: 'close' | 'exit-full-screen' }
  | { type: 'open-address' }
  | { type: 'open-profile-menu' }
  | { type: 'open-sidebar-menu'; kind: SidebarMenuKind; anchor: AnchorRect; footer?: AnchorRect }
  | { type: 'set-sidebar-footer-items'; items: SidebarFooterItem[] }
  | { type: 'open-downloads' }
  | { type: 'install-update' }
  | { type: 'open-extensions-menu'; anchor: AnchorRect }
  | { type: 'open-history' }
  | { type: 'toggle-translation' }
  | { type: 'open-app-menu' }
  | { type: 'open-settings' };

export const PageChannel = {
  tabTransition: 'yalqen:tab-transition',
  swipe: 'yalqen:page-swipe',
  pointerDown: 'yalqen:page-pointer-down',
  credentialSubmitted: 'yalqen:credential-submitted',
  credentialAccepted: 'yalqen:credential-accepted',
  generatePassword: 'yalqen:generate-password',
  savedLogins: 'yalqen:saved-logins',
  fillSavedLogin: 'yalqen:fill-saved-login',
  chooseSavedLogin: 'yalqen:choose-saved-login',
  autofillAvailable: 'yalqen:autofill-available',
  chooseAutofill: 'yalqen:choose-autofill',
  oneTimeCodeAvailable: 'yalqen:one-time-code-available',
  chooseOneTimeCode: 'yalqen:choose-one-time-code',
} as const;

export interface SubmittedCredential {
  username: string;
  password: string;
}

export const IpcChannel = {
  getState: 'yalqen:get-state',
  state: 'yalqen:state',
  setLayout: 'yalqen:set-layout',
  action: 'yalqen:action',
  agentDraft: 'yalqen:agent-draft',
  agentDraftUpdate: 'yalqen:agent-draft-update',
  agentSnapshot: 'yalqen:agent-snapshot',
  agentSelectDirectory: 'yalqen:agent-select-directory',
  agentStart: 'yalqen:agent-start',
  agentStop: 'yalqen:agent-stop',
  agentInput: 'yalqen:agent-input',
  agentResize: 'yalqen:agent-resize',
  agentOutput: 'yalqen:agent-output',
  agentChatSnapshot: 'yalqen:agent-chat-snapshot',
  agentChatSend: 'yalqen:agent-chat-send',
  visualComparisonGet: 'yalqen:visual-comparison-get',
  visualComparisonCapture: 'yalqen:visual-comparison-capture',
  visualComparisonClear: 'yalqen:visual-comparison-clear',
  visualComparisonReview: 'yalqen:visual-comparison-review',
  responsiveScanGet: 'yalqen:responsive-scan-get',
  responsiveScanRun: 'yalqen:responsive-scan-run',
  responsiveScanCancel: 'yalqen:responsive-scan-cancel',
  responsiveScanClear: 'yalqen:responsive-scan-clear',
  responsiveScanReview: 'yalqen:responsive-scan-review',
  agentChatFix: 'yalqen:agent-chat-fix',
  agentChatInterrupt: 'yalqen:agent-chat-interrupt',
  agentChatSignIn: 'yalqen:agent-chat-sign-in',
  agentChatSignOut: 'yalqen:agent-chat-sign-out',
  agentChatReset: 'yalqen:agent-chat-reset',
  agentChatNew: 'yalqen:agent-chat-new',
  agentChatShowBackground: 'yalqen:agent-chat-show-background',
  agentChatDismissBackground: 'yalqen:agent-chat-dismiss-background',
  pagePress: 'yalqen:page-press',
  addLiveFolder: 'yalqen:add-live-folder',
  agentChatOpenBackground: 'yalqen:agent-chat-open-background',
  agentChatContinueBackground: 'yalqen:agent-chat-continue-background',
  agentChatPermission: 'yalqen:agent-chat-permission',
  agentChatConfigure: 'yalqen:agent-chat-configure',
  agentChatRewind: 'yalqen:agent-chat-rewind',
  agentChatOpenFile: 'yalqen:agent-chat-open-file',
  agentChatHistory: 'yalqen:agent-chat-history',
  agentChatOpen: 'yalqen:agent-chat-open',
  agentChatDelete: 'yalqen:agent-chat-delete',
  agentChatFiles: 'yalqen:agent-chat-files',
  agentChatProvider: 'yalqen:agent-chat-provider',
  agentChatCancelQueued: 'yalqen:agent-chat-cancel-queued',
  agentChatUpdate: 'yalqen:agent-chat-update',
  agentProjectAdd: 'yalqen:agent-project-add',
  agentProjectSelect: 'yalqen:agent-project-select',
  agentProjectClose: 'yalqen:agent-project-close',
  agentElementRemove: 'yalqen:agent-element-remove',
  agentElementHighlight: 'yalqen:agent-element-highlight',
  projectRunStart: 'yalqen:project-run-start',
  projectRunStop: 'yalqen:project-run-stop',
} as const;

export interface YalqenApi extends VisualComparisonApi, ResponsiveScanApi {
  getState(): Promise<BrowserState>;
  onState(listener: (serializedState: string) => void): () => void;
  setLayout(layout: ChromeLayout): void;
  send(action: UiAction): void;
  getAgentDraft(projectId: string, id: string): Promise<import('./agent-panel').AgentChatComposer | null>;
  updateAgentDraft(projectId: string, id: string, patch: Partial<import('./agent-panel').AgentChatComposer>): void;
  getAgentTerminal(): Promise<AgentTerminalSnapshot | null>;
  selectAgentDirectory(): Promise<AgentSessionState | null>;
  startAgentSession(size: AgentTerminalSize): Promise<AgentSessionState | null>;
  stopAgentSession(sessionId: string): Promise<void>;
  writeAgentTerminal(sessionId: string, data: string): void;
  resizeAgentTerminal(sessionId: string, size: AgentTerminalSize): void;
  onAgentOutput(listener: (output: AgentTerminalOutput) => void): () => void;
  removeAgentElement(id: string): Promise<void>;
  highlightAgentElement(id: string): Promise<boolean>;
  startProjectRun(): Promise<boolean>;
  stopProjectRun(): Promise<void>;
  getAgentChat(): Promise<AgentChatSnapshot | null>;
  sendAgentChat(
    sessionId: string | null,
    text: string,
    tabIds: TabId | TabId[] | null,
    images?: AgentChatImage[],
  ): Promise<boolean>;
  fixAgentEpisode(tabId: TabId): Promise<boolean>;
  interruptAgentChat(sessionId: string): Promise<void>;
  signInAgent(): Promise<boolean>;
  newAgentChat(): Promise<void>;
  showBackgroundAgentChat(id: string): Promise<boolean>;
  dismissBackgroundAgentChat(id: string): Promise<boolean>;
  openBackgroundAgentChatInTab(id: string): Promise<boolean>;
  continueAgentChatInProject(id: string): Promise<boolean>;
  signOutAgent(): Promise<boolean>;
  resetAgentChat(sessionId: string | null): Promise<void>;
  respondAgentChat(
    sessionId: string,
    requestId: string,
    allow: boolean,
    answers?: Record<string, string>,
    always?: boolean,
  ): Promise<void>;
  configureAgentChat(sessionId: string | null, settings: AgentChatSettings): Promise<void>;
  rewindAgentChat(sessionId: string, messageId: string, dryRun: boolean): Promise<AgentRewindPreview | null>;
  openAgentFile(path: string): Promise<boolean>;
  listAgentChats(): Promise<AgentChatSession[]>;
  openAgentChat(sessionId: string, fork: boolean): Promise<boolean>;
  deleteAgentChat(sessionId: string): Promise<boolean>;
  searchAgentFiles(query: string): Promise<string[]>;
  selectAgentProvider(provider: AgentProviderId): Promise<boolean>;
  newAgentProject(): Promise<boolean>;
  selectAgentProject(id: string): Promise<boolean>;
  closeAgentProject(id: string): Promise<boolean>;
  cancelQueuedAgentChat(sessionId: string, messageId: string): Promise<void>;
  onAgentChat(listener: (serializedSnapshot: string) => void): () => void;
  onPagePress(listener: () => void): () => void;
  onAddLiveFolder(listener: () => void): () => void;
}

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

export const NETWORK_PRESETS = ['offline', 'slow-3g', 'fast-3g', 'fast-4g'] as const;
export type NetworkPreset = (typeof NETWORK_PRESETS)[number];

export const USER_AGENT_PRESETS = ['firefox', 'safari', 'edge', 'iphone', 'android', 'googlebot'] as const;
export type UserAgentPreset = (typeof USER_AGENT_PRESETS)[number];

export interface PageOverrides {
  cacheDisabled: boolean;
  network: NetworkPreset | null;
  colorScheme: 'light' | 'dark' | null;
  reducedMotion: boolean;
  printMedia: boolean;
  userAgent: UserAgentPreset | null;
  requestRules: boolean;
}

export type RequestRuleAction = 'block' | 'mock' | 'redirect' | 'headers';

export interface RequestRule {
  id: string;
  enabled: boolean;
  pattern: string;
  action: RequestRuleAction;
  status: number;
  contentType: string;
  body: string;
  redirectUrl: string;
  headers: string;
}

export const AUTO_RELOAD_SECONDS = [5, 10, 30, 60] as const;
export type AutoReloadSeconds = (typeof AUTO_RELOAD_SECONDS)[number];

export type DevCommandId =
  | 'hard-reload'
  | 'toggle-cache'
  | `network-${NetworkPreset}`
  | 'network-online'
  | 'color-scheme-light'
  | 'color-scheme-dark'
  | 'color-scheme-auto'
  | 'toggle-reduced-motion'
  | 'toggle-print-media'
  | `user-agent-${UserAgentPreset}`
  | 'user-agent-default'
  | 'reset-overrides'
  | 'developer-window'
  | 'toggle-request-rules'
  | 'edit-request-rules'
  | `auto-reload-${AutoReloadSeconds}`
  | 'auto-reload-off'
  | 'devtools'
  | 'view-source'
  | 'device'
  | 'responsive'
  | 'rotate-device'
  | 'screenshot'
  | 'full-page-screenshot'
  | 'capture-area'
  | 'copy-address'
  | 'copy-markdown'
  | 'copy-curl'
  | 'clear-cache'
  | 'clear-site-data'
  | 'pick-element';

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

export interface WelcomeImportSource {
  id: number;
  browser: string;
  profile: string;
}

export interface WelcomeOpen {
  name: string;
  accent: import('./accent').AccentColorId;
  theme: ThemeSource;
  material: WindowMaterial;
  sources: WelcomeImportSource[];
}

export type WelcomeAction =
  | { type: 'appearance'; accent?: import('./accent').AccentColorId; theme?: ThemeSource }
  | { type: 'name'; name: string }
  | { type: 'finish' };

export interface WelcomeImportRequest {
  source: number;
  bookmarks: boolean;
  history: boolean;
}

export interface WelcomeImportResult {
  ok: boolean;
  bookmarks: number;
  visits: number;
}

export const WelcomeChannel = {
  open: 'yalqen-welcome:open',
  action: 'yalqen-welcome:action',
  import: 'yalqen-welcome:import',
} as const;

export interface WelcomeApi {
  onOpen(listener: (open: WelcomeOpen) => void): () => void;
  send(action: WelcomeAction): void;
  importFrom(request: WelcomeImportRequest): Promise<WelcomeImportResult>;
}

export interface ConfirmRequest {
  icon: 'extensions' | 'trash';
  title: string;
  message?: string;
  items: string[];
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
}

export interface ConfirmOpen extends ConfirmRequest {
  accent: string;
}

export const ConfirmChannel = {
  open: 'yalqen-confirm:open',
  answer: 'yalqen-confirm:answer',
} as const;

export interface ConfirmApi {
  onOpen(listener: (open: ConfirmOpen) => void): () => void;
  answer(confirmed: boolean): void;
}

export interface FindResult {
  active: number;
  matches: number;
}

export type FindBarAction = { type: 'find'; text: string; forward: boolean; next: boolean } | { type: 'close' };

export const FindBarChannel = {
  open: 'yalqen-find:open',
  result: 'yalqen-find:result',
  action: 'yalqen-find:action',
} as const;

export interface FindBarApi {
  onOpen(listener: () => void): () => void;
  onResult(listener: (result: FindResult) => void): () => void;
  send(action: FindBarAction): void;
}

export const PeekChannel = {
  update: 'yalqen-peek:update',
  action: 'yalqen-peek:action',
} as const;

export interface PeekState {
  title: string;
  url: string;
}

export type PeekAction = 'close' | 'promote';

export interface PeekApi {
  onUpdate(listener: (state: PeekState) => void): () => void;
  send(action: PeekAction): void;
}

export interface SettingsValues {
  searchEngine: SearchEngineId;
  customSearchTemplate: string | null;
  theme: ThemeSource;
  darkSites: boolean;
  frameTheme: import('./frame-theme').FrameTheme;
  startupBehavior: 'restore' | 'new-tab' | 'pages';
  startupUrls: string[];
  spaceRules: import('./space-rules').SpaceRule[];
  panelCollapsed: boolean;
  pinnedTabsStayHome: boolean;
  manualTabCleanup: boolean;
  tabModes: boolean;
  autoDeveloperMode: boolean;
  bookmarksPanel: boolean;
  // Passkeys kept on this Mac and unlocked with Touch ID; only signed releases can, and only after a restart.
  touchIdPasskeys: boolean;
  sidebarWidgets: import('./sidebar-widgets').SidebarWidgetId[];
  sidebarFooterItems: SidebarFooterItem[];
  discardAfterMinutes: number;
  autoArchiveHours: number;
  adBlocking: boolean;
  threatProtection: boolean;
  adBlockExceptions: string[];
  thirdPartyCookieExceptions: string[];
  httpsOnly: boolean;
  stripTrackingOnCopy: boolean;
  blockThirdPartyCookies: boolean;
  clearOnExit: boolean;
  blockedPermissionRequests: PromptPermission[];
  secureDns: SecureDnsSetting;
  defaultZoom: number;
  interfaceLanguage: InterfaceLanguage;
  pageTranslation: boolean;
  miniWindow: boolean;
  pictureInPicture: boolean;
  autoUpdate: boolean;
  autoUpdateExtensions: boolean;
  usageCounting: boolean;
  askBeforeDownload: boolean;
  downloadDirectory: string | null;
  welcomeCompleted: boolean;
  invitationSeen: boolean;
  displayName: string;
  accentColor: import('./accent').AccentColorId;
  dismissedAnnouncement: string;
  dismissedFeedback: string;
  dismissedUpdate: string;
  agentBridge: boolean;
  agentOrigins: string[];
  agentActions: AgentActionPolicy;
  agentTracing: boolean;
  agentTerminal: boolean;
  agentFloating: boolean;
  recentTabCycling: boolean;
  shortcuts: import('./shortcuts').ShortcutOverrides;
}

export type UpdateStatus =
  | { state: 'unavailable' }
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'failed' };

export interface ThreatListsView {
  domains: number;
  hashes: number;
  domainUpdatedAt: number | null;
  hashUpdatedAt: number | null;
  updating: boolean;
  failed: boolean;
}

export interface PersistentProfileInfo {
  id: string;
  name: string;
  active: boolean;
  default: boolean;
  running: boolean;
}
export interface ProfilesView {
  currentId: string;
  profiles: PersistentProfileInfo[];
}
export interface ProfilesResult {
  view: ProfilesView;
  error: 'invalid-name' | 'missing' | 'busy' | 'protected' | 'failed' | null;
}

export interface SettingsView {
  values: SettingsValues;
  downloadDirectory: string;
  defaultBrowser: boolean;
  engines: { id: SearchEngineId; label: string }[];
  customTemplateValid: boolean;
  version: string;
  update: UpdateStatus;
  threatLists?: ThreatListsView;
  spaces: import('./workspaces').SpaceView[];
}

export type ClearDataRange = 'hour' | 'day' | 'week' | 'month' | 'all';

export interface ClearDataRequest {
  range: ClearDataRange;
  history: boolean;
  downloads: boolean;
  siteData: boolean;
  cache: boolean;
}

export const SettingsChannel = {
  get: 'yalqen-settings:get',
  update: 'yalqen-settings:update',
  changed: 'yalqen-settings:changed',
  clearData: 'yalqen-settings:clear-data',
  makeDefault: 'yalqen-settings:make-default',
  relaunch: 'yalqen-settings:relaunch',
  processUsage: 'yalqen-settings:process-usage',
  checkForUpdates: 'yalqen-settings:check-for-updates',
  installUpdate: 'yalqen-settings:install-update',
  chooseDownloadDirectory: 'yalqen-settings:choose-download-directory',
  setSpaceTheme: 'yalqen-settings:set-space-theme',
  updateThreatLists: 'yalqen-settings:update-threat-lists',
  profiles: 'yalqen-settings:profiles',
  profileAction: 'yalqen-settings:profile-action',
  siteIcons: 'yalqen-settings:site-icons',
  showImportMenu: 'yalqen-settings:show-import-menu',
} as const;

export type ProcessGroupKind = 'pages' | 'interface' | 'extensions' | 'browser' | 'gpu' | 'utility' | 'other';

export interface ProcessGroup {
  kind: ProcessGroupKind;
  count: number;
  memoryMB: number;
}

export interface PageProcess {
  pid: number;
  titles: string[];
  memoryMB: number;
}

export interface ProcessUsage {
  totalMB: number;
  groups: ProcessGroup[];
  pages: PageProcess[];
}

export type SitePermission = 'camera' | 'microphone' | 'geolocation' | 'notifications' | 'popups' | 'apps';
export type PromptPermission = Exclude<SitePermission, 'popups' | 'apps'>;
export type PermissionDecision = 'allow' | 'deny';
export type SystemDevice = 'camera' | 'microphone' | 'screen';
export type SystemAccess = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';

export interface SitePermissionsView {
  sites: { origin: string; permissions: { kind: SitePermission; decision: PermissionDecision }[] }[];
  system: Record<SystemDevice, SystemAccess> | null;
}

export const SitePermissionsChannel = {
  list: 'yalqen-permissions:list',
  set: 'yalqen-permissions:set',
  forget: 'yalqen-permissions:forget',
  openSystemSettings: 'yalqen-permissions:open-system-settings',
} as const;

export const RequestRulesChannel = {
  list: 'yalqen-rules:list',
  save: 'yalqen-rules:save',
} as const;

export interface ExtensionSiteAccess {
  mode: 'all' | 'sites' | 'click';
  sites: string[];
}

export interface ExtensionInfo {
  path: string;
  id: string | null;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  error: string | null;
  icon: string | null;
  hasOptions: boolean;
  fromStore: boolean;
  updating: boolean;
  updateError: string | null;
  access: ExtensionSiteAccess;
  sessionSites: string[];
}

export const ExtensionsChannel = {
  list: 'yalqen-extensions:list',
  install: 'yalqen-extensions:install',
  installFromStore: 'yalqen-extensions:install-from-store',
  openStore: 'yalqen-extensions:open-store',
  checkUpdates: 'yalqen-extensions:check-updates',
  remove: 'yalqen-extensions:remove',
  setEnabled: 'yalqen-extensions:set-enabled',
  openOptions: 'yalqen-extensions:open-options',
  setAccess: 'yalqen-extensions:set-access',
  changed: 'yalqen-extensions:changed',
} as const;

export interface SavedLoginChoice {
  id: string;
  username: string;
}

export interface SavedLoginsView {
  generateLabel?: string | null;
  choices: SavedLoginChoice[];
  chooseLabel: string;
}

export type PasswordIssue = 'weak' | 'reused' | 'old';

export interface SavedPasswordInfo {
  id: string;
  origin: string;
  username: string;
  updatedAt: number;
  issues: PasswordIssue[];
}

export interface PasswordsView {
  available: boolean;
  passwords: SavedPasswordInfo[];
  neverSave: string[];
}

export interface PasswordTransferResult {
  status: 'success' | 'cancelled' | 'failed';
  added: number;
  skipped: number;
}
export interface ManualPassword {
  id: string | null;
  url: string;
  username: string;
  password: string;
}

export const PasswordsChannel = {
  save: 'yalqen-passwords:save',
  generate: 'yalqen-passwords:generate',
  transfer: 'yalqen-passwords:transfer',
  list: 'yalqen-passwords:list',
  reveal: 'yalqen-passwords:reveal',
  copy: 'yalqen-passwords:copy',
  copyUsername: 'yalqen-passwords:copy-username',
  remove: 'yalqen-passwords:remove',
  allowSaving: 'yalqen-passwords:allow-saving',
  changed: 'yalqen-passwords:changed',
} as const;

export const AutofillChannel = {
  list: 'yalqen-autofill:list',
  save: 'yalqen-autofill:save',
  read: 'yalqen-autofill:read',
  remove: 'yalqen-autofill:remove',
  changed: 'yalqen-autofill:changed',
} as const;

export interface SettingsApi {
  get(): Promise<SettingsView>;
  update(patch: Partial<SettingsValues>): Promise<SettingsView>;
  onChange(listener: (view: SettingsView) => void): () => void;
  clearData(request: ClearDataRequest): Promise<void>;
  makeDefault(): Promise<SettingsView>;
  relaunch(): Promise<void>;
  processUsage(): Promise<ProcessUsage>;
  checkForUpdates(): Promise<void>;
  installUpdate(): Promise<void>;
  chooseDownloadDirectory(): Promise<SettingsView>;
  setSpaceTheme(id: string, theme: import('./frame-theme').FrameTheme | null): Promise<SettingsView>;
  showImportMenu(kind: 'bookmarks' | 'history'): Promise<void>;
  updateThreatLists(): Promise<SettingsView>;
  profiles(): Promise<ProfilesView>;
  profileAction(
    action: 'create' | 'rename' | 'default' | 'open' | 'remove',
    id?: string,
    name?: string,
  ): Promise<ProfilesResult>;
  requestRules(): Promise<RequestRule[]>;
  saveRequestRules(rules: RequestRule[]): Promise<RequestRule[]>;
  sitePermissions(): Promise<SitePermissionsView>;
  setSitePermission(
    origin: string,
    kind: SitePermission,
    decision: PermissionDecision | null,
  ): Promise<SitePermissionsView>;
  forgetSitePermissions(origin: string): Promise<SitePermissionsView>;
  siteIcons(domains: string[]): Promise<Record<string, string>>;
  openSystemSettings(device: SystemDevice): Promise<void>;
  extensions(): Promise<ExtensionInfo[]>;
  checkExtensionUpdates(): Promise<string | null>;
  installExtension(): Promise<string | null>;
  installExtensionFromStore(input: string): Promise<string | null>;
  openExtensionStore(): Promise<void>;
  removeExtension(path: string): Promise<void>;
  setExtensionEnabled(path: string, enabled: boolean): Promise<void>;
  setExtensionAccess(path: string, access: ExtensionSiteAccess): Promise<string | null>;
  openExtensionOptions(path: string): Promise<void>;
  onExtensionsChange(listener: (extensions: ExtensionInfo[]) => void): () => void;
  passwords(): Promise<PasswordsView>;
  savePassword(value: ManualPassword): Promise<boolean>;
  generatePassword(): Promise<string | null>;
  transferPasswords(mode: 'import' | 'export'): Promise<PasswordTransferResult>;
  revealPassword(id: string): Promise<string | null>;
  copyPassword(id: string): Promise<boolean>;
  copyUsername(id: string): Promise<boolean>;
  removePassword(id: string): Promise<void>;
  allowSaving(origin: string): Promise<void>;
  onPasswordsChange(listener: (view: PasswordsView) => void): () => void;
  autofill(): Promise<import('./autofill.js').AutofillView>;
  saveAutofill(value: import('./autofill.js').ManualAutofill): Promise<boolean>;
  readAutofill(id: string): Promise<import('./autofill.js').AutofillData | null>;
  removeAutofill(id: string): Promise<boolean>;
  onAutofillChange(listener: (view: import('./autofill.js').AutofillView) => void): () => void;
  siteStorage(query: string, offset: number): Promise<import('./site-storage.js').SiteStorageView | null>;
  clearSiteStorage(domain: string | null): Promise<boolean>;
  agentBridge(): Promise<AgentBridgeView>;
  copyAgentSetup(kind: AgentSetupKind): Promise<boolean>;
  regenerateAgentToken(): Promise<AgentBridgeView>;
  agentConnections(): Promise<AgentConnections | null>;
  connectAgent(id: AgentClientId): Promise<AgentSetupResult>;
  disconnectAgent(id: AgentClientId): Promise<AgentSetupResult>;
  onAgentBridgeChange(listener: (view: AgentBridgeView) => void): () => void;
}
