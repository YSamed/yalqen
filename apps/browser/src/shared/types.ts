export type TabId = string;

export const INTERNAL_SCHEME = 'yalqen';
export const NEW_TAB_URL = 'yalqen://newtab/';
export const HISTORY_URL = 'yalqen://history/';
export const DOWNLOADS_URL = 'yalqen://downloads/';
export const BOOKMARKS_URL = 'yalqen://bookmarks/';
export const SETTINGS_URL = 'yalqen://settings/';
export type CommandPage = 'downloads' | 'bookmarks';

export type SearchEngineId = 'google' | 'yandex' | 'duckduckgo' | 'bing' | 'brave' | 'ecosia' | 'startpage' | 'custom';
export type ThemeSource = 'system' | 'light' | 'dark';
export type SecureDnsSetting = 'off' | 'automatic' | 'cloudflare' | 'google' | 'quad9';
export type FontSizeSetting = 'small' | 'medium' | 'large' | 'xlarge';
export type PageLanguage = 'tr' | 'en';
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
  live: boolean;
  frozen: boolean;
  loading: boolean;
  pinned: boolean;
  security: SecurityState;
  isPrivate: boolean;
  bookmarked: boolean;
  blockedPopups: number;
  consoleErrors: number;
  overrides: PageOverrides;
  translation: TabTranslation;
  autoReloadSeconds: number | null;
  audible: boolean;
  muted: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export type DeviceId =
  'iphone-15' | 'iphone-15-pro-max' | 'iphone-se' | 'pixel-8' | 'galaxy-s24' | 'ipad-mini' | 'responsive';

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

export type PanelSide = 'left' | 'right';

export interface BrowserState {
  tabs: TabSnapshot[];
  developer: boolean;
  activeTabId: TabId | null;
  pageFullScreen: boolean;
  windowFullScreen: boolean;
  addressPlaceholder: string;
  panelCollapsed: boolean;
  panelSide: PanelSide;
  sidebarVisible: boolean;
  toolbarVisible: boolean;
  toolbarTabs: boolean;
  material: WindowMaterial;
  device: DeviceFrame | null;
  zoom: number;
  defaultZoom: number;
  downloads: DownloadsSummary;
  extensions: boolean;
  updateReady: string | null;
}

export interface DownloadsSummary {
  active: number;
  progress: number | null;
  started: number;
}

export interface ChromeLayout {
  panelWidth: number;
  panelSide: PanelSide;
  chromeHeight: number;
  pageInset: number;
  pageRadius: number;
  newTabCenterOffset: number;
}

export interface AnchorRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type UiAction =
  | { type: 'new-tab'; url?: string }
  | { type: 'activate-tab'; id: TabId }
  | { type: 'close-tab'; id: TabId }
  | { type: 'discard-tab'; id: TabId }
  | { type: 'toggle-pin'; id: TabId }
  | { type: 'toggle-mute'; id: TabId }
  | { type: 'move-tab'; id: TabId; toIndex: number }
  | { type: 'navigate'; input: string }
  | { type: 'go-back' }
  | { type: 'go-forward' }
  | { type: 'reload' }
  | { type: 'open-devtools' }
  | { type: 'open-dev-menu' }
  | { type: 'dev-command'; id: DevCommandId }
  | { type: 'resize-device'; width: number; height: number }
  | { type: 'set-device-scale-factor'; value: number }
  | { type: 'stop' }
  | { type: 'reset-zoom' }
  | { type: 'open-site-info' }
  | { type: 'open-blocked-popups' }
  | { type: 'toggle-bookmark' }
  | { type: 'open-bookmarks-menu' }
  | { type: 'toggle-panel' }
  | { type: 'toggle-sidebar' }
  | { type: 'open-address' }
  | { type: 'open-profile-menu' }
  | { type: 'open-downloads' }
  | { type: 'open-extensions-menu'; anchor: AnchorRect }
  | { type: 'open-history' }
  | { type: 'toggle-translation' }
  | { type: 'open-settings' }
  | { type: 'install-update' };

export const PageChannel = {
  swipe: 'yalqen:page-swipe',
  newTabCenter: 'yalqen:newtab-center',
} as const;

export interface NewTabCenter {
  offset: number;
  width: number | null;
}

export const IpcChannel = {
  getState: 'yalqen:get-state',
  state: 'yalqen:state',
  setLayout: 'yalqen:set-layout',
  action: 'yalqen:action',
  wallpaper: 'yalqen:wallpaper',
} as const;

export interface Wallpaper {
  dataUrl: string;
  split: boolean;
}

export interface YalqenApi {
  getState(): Promise<BrowserState>;
  onState(listener: (state: BrowserState) => void): () => void;
  onWallpaper(listener: (wallpaper: Wallpaper | null) => void): () => void;
  setLayout(layout: ChromeLayout): void;
  send(action: UiAction): void;
}

export interface CommandBarOpen {
  placeholder: string;
  mode: 'navigate' | 'new-tab';
  value?: string;
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
  | 'copy-address'
  | 'copy-markdown'
  | 'copy-curl'
  | 'clear-cache'
  | 'clear-site-data';

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
  | { type: 'submit'; input: string }
  | { type: 'switch-tab'; id: TabId }
  | { type: 'run-command'; id: DevCommandId }
  | { type: 'dismiss' }
  | { type: 'input'; input: string };

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

export interface SettingsValues {
  searchEngine: SearchEngineId;
  customSearchTemplate: string | null;
  theme: ThemeSource;
  startupBehavior: 'restore' | 'new-tab';
  panelCollapsed: boolean;
  panelSide: PanelSide;
  sidebarVisible: boolean;
  toolbarVisible: boolean;
  toolbarTabs: boolean;
  freezeBackgroundTabs: boolean;
  discardAfterMinutes: number;
  adBlocking: boolean;
  httpsOnly: boolean;
  blockThirdPartyCookies: boolean;
  secureDns: SecureDnsSetting;
  fontSize: FontSizeSetting;
  defaultZoom: number;
  pageLanguage: PageLanguage;
  pageTranslation: boolean;
  autoUpdate: boolean;
  askBeforeDownload: boolean;
  welcomeCompleted: boolean;
}

export type UpdateStatus =
  | { state: 'unavailable' }
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'up-to-date' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'failed' };

export interface SettingsView {
  values: SettingsValues;
  defaultBrowser: boolean;
  engines: { id: SearchEngineId; label: string }[];
  customTemplateValid: boolean;
  version: string;
  update: UpdateStatus;
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
  processUsage: 'yalqen-settings:process-usage',
  checkForUpdates: 'yalqen-settings:check-for-updates',
  installUpdate: 'yalqen-settings:install-update',
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

export const RequestRulesChannel = {
  list: 'yalqen-rules:list',
  save: 'yalqen-rules:save',
} as const;

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
}

export const ExtensionsChannel = {
  list: 'yalqen-extensions:list',
  install: 'yalqen-extensions:install',
  remove: 'yalqen-extensions:remove',
  setEnabled: 'yalqen-extensions:set-enabled',
  openOptions: 'yalqen-extensions:open-options',
  changed: 'yalqen-extensions:changed',
} as const;

export interface SettingsApi {
  get(): Promise<SettingsView>;
  update(patch: Partial<SettingsValues>): Promise<SettingsView>;
  onChange(listener: (view: SettingsView) => void): () => void;
  clearData(request: ClearDataRequest): Promise<void>;
  makeDefault(): Promise<SettingsView>;
  processUsage(): Promise<ProcessUsage>;
  checkForUpdates(): Promise<void>;
  installUpdate(): Promise<void>;
  requestRules(): Promise<RequestRule[]>;
  saveRequestRules(rules: RequestRule[]): Promise<RequestRule[]>;
  extensions(): Promise<ExtensionInfo[]>;
  installExtension(): Promise<string | null>;
  removeExtension(path: string): Promise<void>;
  setExtensionEnabled(path: string, enabled: boolean): Promise<void>;
  openExtensionOptions(path: string): Promise<void>;
  onExtensionsChange(listener: (extensions: ExtensionInfo[]) => void): () => void;
}
