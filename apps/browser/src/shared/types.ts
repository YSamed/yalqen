import type { VisualComparisonApi } from './visual-comparison.js';
import type { ResponsiveScanApi } from './responsive-scan.js';

export type TabId = string;

export const INTERNAL_SCHEME = 'yalqen';
export const NEW_TAB_URL = 'yalqen://newtab/';
export const HISTORY_URL = 'yalqen://history/';
export const DOWNLOADS_URL = 'yalqen://downloads/';
export const BOOKMARKS_URL = 'yalqen://bookmarks/';
export const SETTINGS_URL = 'yalqen://settings/';
export type CommandPage = 'downloads' | 'bookmarks';

export type SearchEngineId =
  'google' | 'yandex' | 'duckduckgo' | 'bing' | 'brave' | 'ecosia' | 'startpage' | 'kagi' | 'custom';
export type ThemeSource = 'system' | 'light' | 'dark';
export type SecureDnsSetting = 'off' | 'automatic' | 'cloudflare' | 'google' | 'quad9';
export type FontSizeSetting = 'small' | 'medium' | 'large' | 'xlarge';
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
  live: boolean;
  frozen: boolean;
  loading: boolean;
  pinned: boolean;
  group?: string | null;
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
  agentObserved: boolean;
  agentReadAt: number | null;
  agentEpisode: AgentEpisodePreview | null;
  agentRules: number;
}

export interface AgentEpisodePreview {
  id: string;
  lines: string[];
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

export type PanelSide = 'left' | 'right';

export type PinnedDisplay = 'always' | 'expanded' | 'never';

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
export const REQUIRED_TOOLBAR_BUTTON: ToolbarButtonId = 'settings';

export const DEFAULT_ZOOM_FACTORS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;
export const DISCARD_AFTER_MINUTES = [0, 15, 30, 60, 120] as const;

export interface BrowserState {
  tabs: TabSnapshot[];
  listOrder: TabId[];
  developer: boolean;
  activeTabId: TabId | null;
  selectedTabIds: TabId[];
  tabGroups?: import('./tab-groups').TabGroup[];
  pageFullScreen: boolean;
  windowFullScreen: boolean;
  addressPlaceholder: string;
  panelCollapsed: boolean;
  panelSide: PanelSide;
  pinnedDisplay: PinnedDisplay;
  sidebarVisible: boolean;
  toolbarVisible: boolean;
  toolbarTabs: boolean;
  toolbarButtons: ToolbarButtonId[];
  material: WindowMaterial;
  device: DeviceFrame | null;
  zoom: number;
  defaultZoom: number;
  downloads: DownloadsSummary;
  extensions: boolean;
  profile: ProfileKind;
  profileName?: string;
  agentPanelOpen: boolean;
  agentSession: AgentSessionState;
  agentChat: AgentChatState;
  agentProviders: AgentProviderId[];
  projectRun: ProjectRunState;
  agentElements: AgentElementRef[];
  agentTerminal: boolean;
  agentProjects: AgentProjectSummary[];
  agentProjectId: string;
  // The active tab's conversation within the project; the chat view starts over when it changes.
  agentConversationId: string;
  agentBackgroundChats: AgentBackgroundChat[];
}

export interface AgentProjectSummary {
  id: string;
  directory: string | null;
  busy: boolean;
  waiting: boolean;
}

export interface AgentTerminalSize {
  cols: number;
  rows: number;
}

export interface AgentSessionState {
  id: string | null;
  directory: string | null;
  status: 'idle' | 'starting' | 'running' | 'exited' | 'error';
  exitCode: number | null;
  error:
    'claude-not-found' | 'invalid-directory' | 'terminal-unavailable' | 'connection-failed' | 'start-failed' | null;
}

export interface ProjectRunState {
  directory: string | null;
  command: string | null;
  status: 'idle' | 'starting' | 'running' | 'exited' | 'error';
  url: string | null;
  exitCode: number | null;
}

export interface AgentTerminalOutput {
  sessionId: string;
  sequence: number;
  data: string;
}

export interface AgentTerminalSnapshot {
  state: AgentSessionState;
  sequence: number;
  data: string;
}

export type AgentPermissionMode = 'default' | 'acceptEdits' | 'auto' | 'plan';
export type AgentProviderId = 'claude' | 'codex' | 'gemini';
export type AgentWorkMode = 'normal' | 'verify' | 'review' | 'design';
export type AgentReplyLength = 'short' | 'detailed';
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AgentChatModel {
  value: string;
  label: string;
  efforts: AgentEffort[];
}

export interface AgentChatCommand {
  name: string;
  description: string;
  argumentHint: string;
}

export interface AgentChatSession {
  id: string;
  title: string;
  updatedAt: number;
  branch: string | null;
}

export interface AgentChatUsage {
  cost: number;
  contextTokens: number | null;
  contextLimit: number | null;
}

export interface AgentChatSettings {
  workMode?: AgentWorkMode;
  replyLength?: AgentReplyLength;
  permissionMode?: AgentPermissionMode;
  model?: string | null;
  effort?: AgentEffort | null;
}

export interface AgentChatState {
  id: string | null;
  provider: AgentProviderId;
  workMode: AgentWorkMode;
  replyLength: AgentReplyLength;
  directory: string | null;
  status: 'idle' | 'starting' | 'thinking' | 'approval' | 'ready' | 'stopped' | 'error';
  model: string | null;
  modelChoice: string | null;
  effort: AgentEffort | null;
  permissionMode: AgentPermissionMode;
  models: AgentChatModel[];
  commands: AgentChatCommand[];
  usage: AgentChatUsage | null;
  error:
    | 'claude-not-found'
    | 'invalid-directory'
    | 'connection-failed'
    | 'authentication-required'
    | 'start-failed'
    | 'request-failed'
    | null;
}

export type AgentChatPart =
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      id: string;
      name: string;
      input: string;
      output: string;
      status: 'running' | 'done' | 'error' | 'stopped';
      verification: 'passed' | 'failed' | null;
      task: AgentChatTask | null;
      steps: string[];
    };

export interface AgentChatTask {
  description: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  toolUses: number;
  summary: string | null;
}

export interface AgentRewindPreview {
  canRewind: boolean;
  error: string | null;
  files: string[];
  insertions: number;
  deletions: number;
}

export interface AgentChatContext {
  id: TabId;
  title: string;
  url: string;
  local: boolean;
}

export interface AgentElementRef {
  id: string;
  tabId: TabId;
  url: string;
  label: string;
  component: string | null;
  source: string | null;
  // Picked on a site outside local development, as a design reference.
  reference?: boolean;
}

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: AgentChatPart[];
  context: AgentChatContext | null;
  contexts?: AgentChatContext[];
  elements: AgentElementRef[];
  episode: AgentEpisodePreview | null;
  images: string[];
  reverted: boolean;
  workMode: AgentWorkMode;
}

export interface AgentChatImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  data: string;
  thumbnail: string;
}

interface AgentChatQuestion {
  question: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

export interface AgentChatPermission {
  id: string;
  tool: string;
  title: string;
  input: string;
  plan: string | null;
  questions: AgentChatQuestion[];
  canAlwaysAllow: boolean;
}

export interface AgentChatSnapshot {
  state: AgentChatState;
  revision: number;
  messages: AgentChatMessage[];
  queue: AgentChatMessage[];
  permissions: AgentChatPermission[];
}

export type ProfileKind = 'personal' | 'developer' | 'private';

export interface DownloadsSummary {
  active: number;
  progress: number | null;
  started: number;
}

export interface ChromeLayout {
  panelWidth: number;
  // While the panel animates, how far it still is from panelWidth. The page slides by this much
  // instead of resizing, so it moves with the panel without reflowing every frame.
  panelSlide: number;
  panelSide: PanelSide;
  chromeHeight: number;
  pageInset: number;
  pageRadius: number;
  newTabCenterOffset: number;
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
  | { type: 'activate-tab'; id: TabId }
  | { type: 'select-tab'; id: TabId; mode: 'toggle' | 'range' }
  | { type: 'clear-tab-selection' }
  | { type: 'close-selected-tabs' }
  | { type: 'set-tab-group'; name: string | null }
  | { type: 'rename-tab-group'; name: string; next: string }
  | { type: 'toggle-tab-group'; name: string }
  | { type: 'remove-tab-group'; name: string }
  | { type: 'close-tab'; id: TabId }
  | { type: 'discard-tab'; id: TabId }
  | { type: 'toggle-pin'; id: TabId }
  | { type: 'toggle-mute'; id: TabId }
  | { type: 'open-tab-menu'; id: TabId }
  | { type: 'move-tab'; id: TabId; toIndex: number }
  | { type: 'navigate'; input: string }
  | { type: 'go-home' }
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
  | { type: 'toggle-agent-panel' }
  | { type: 'open-address' }
  | { type: 'open-profile-menu' }
  | { type: 'switch-profile'; profile: ProfileKind }
  | { type: 'open-downloads' }
  | { type: 'open-extensions-menu'; anchor: AnchorRect }
  | { type: 'open-extension-store' }
  | { type: 'open-history' }
  | { type: 'toggle-translation' }
  | { type: 'open-settings' };

export const PageChannel = {
  swipe: 'yalqen:page-swipe',
  newTabCenter: 'yalqen:newtab-center',
  credentialSubmitted: 'yalqen:credential-submitted',
  credentialAccepted: 'yalqen:credential-accepted',
  generatePassword: 'yalqen:generate-password',
  savedLogins: 'yalqen:saved-logins',
  fillSavedLogin: 'yalqen:fill-saved-login',
  chooseSavedLogin: 'yalqen:choose-saved-login',
  autofillAvailable: 'yalqen:autofill-available',
  chooseAutofill: 'yalqen:choose-autofill',
} as const;

export interface SubmittedCredential {
  username: string;
  password: string;
}

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

export interface Wallpaper {
  dataUrl: string;
  split: boolean;
}

export interface YalqenApi extends VisualComparisonApi, ResponsiveScanApi {
  getState(): Promise<BrowserState>;
  // State arrives as JSON: the context bridge deep-copies objects, but a string crosses it cheaply.
  onState(listener: (serializedState: string) => void): () => void;
  onWallpaper(listener: (wallpaper: Wallpaper | null) => void): () => void;
  setLayout(layout: ChromeLayout): void;
  send(action: UiAction): void;
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
  startupBehavior: 'restore' | 'new-tab' | 'pages';
  homePageUrl: string | null;
  startupUrls: string[];
  panelCollapsed: boolean;
  panelSide: PanelSide;
  pinnedDisplay: PinnedDisplay;
  sidebarVisible: boolean;
  toolbarVisible: boolean;
  toolbarTabs: boolean;
  toolbarButtons: ToolbarButtonId[];
  freezeBackgroundTabs: boolean;
  discardAfterMinutes: number;
  adBlocking: boolean;
  threatProtection: boolean;
  adBlockExceptions: string[];
  thirdPartyCookieExceptions: string[];
  httpsOnly: boolean;
  blockThirdPartyCookies: boolean;
  secureDns: SecureDnsSetting;
  fontSize: FontSizeSetting;
  defaultZoom: number;
  interfaceLanguage: InterfaceLanguage;
  pageTranslation: boolean;
  autoUpdate: boolean;
  autoUpdateExtensions: boolean;
  usageCounting: boolean;
  askBeforeDownload: boolean;
  askDownloadLocation: boolean;
  downloadDirectory: string | null;
  welcomeCompleted: boolean;
  dismissedAnnouncement: string;
  dismissedFeedback: string;
  dismissedUpdate: string;
  agentBridge: boolean;
  agentOrigins: string[];
  agentActions: AgentActionPolicy;
  agentTracing: boolean;
  agentTerminal: boolean;
}

export type AgentActionPolicy = 'off' | 'ask' | 'allow';

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
  updateThreatLists: 'yalqen-settings:update-threat-lists',
  profiles: 'yalqen-settings:profiles',
  profileAction: 'yalqen-settings:profile-action',
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

export type SitePermission = 'camera' | 'microphone' | 'geolocation' | 'notifications' | 'popups';
export type PermissionDecision = 'allow' | 'deny';
export type SystemDevice = 'camera' | 'microphone' | 'screen';
export type SystemAccess = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown';

export interface SitePermissionsView {
  sites: { origin: string; permissions: { kind: SitePermission; decision: PermissionDecision }[] }[];
  // Null where the OS has no per-app device switches (not macOS).
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

export interface SavedPasswordInfo {
  id: string;
  origin: string;
  username: string;
  updatedAt: number;
}

export interface PasswordsView {
  available: boolean;
  passwords: SavedPasswordInfo[];
  neverSave: string[];
}

export type AgentSetupKind = 'claude' | 'codex' | 'token' | 'otel';

export interface AgentBackgroundChat {
  id: string;
  title: string;
  status: AgentChatState['status'];
}

export type AgentSetupResult = { ok: true } | { ok: false; reason: 'not-found' | 'failed'; detail: string };

export type AgentClientId = 'claude' | 'codex';

// unavailable: the client's CLI is not installed; stale: registered with an old address or token.
export type AgentConnectionState = 'connected' | 'stale' | 'missing' | 'unavailable';

export type AgentConnections = Record<AgentClientId, AgentConnectionState>;

export interface AgentBridgeView {
  enabled: boolean;
  port: number | null;
  error: string | null;
  lastCallAt: number | null;
  calls: number;
  client: string | null;
  staleTokenAt: number | null;
  url: string | null;
  // Shown with the token hidden; copying puts the real one on the clipboard.
  claudeCommand: string | null;
  codexConfig: string | null;
  otelConfig: string | null;
  observedTabs: number;
  // Bumped whenever a client registration changes, so the settings page reloads the states it shows.
  connectionsRevision: number;
}

export const AgentBridgeChannel = {
  status: 'yalqen-agent:status',
  copy: 'yalqen-agent:copy',
  regenerate: 'yalqen-agent:regenerate',
  connections: 'yalqen-agent:connections',
  connect: 'yalqen-agent:connect',
  disconnect: 'yalqen-agent:disconnect',
  changed: 'yalqen-agent:changed',
} as const;

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
