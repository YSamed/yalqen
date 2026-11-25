import type {
  AgentActionPolicy,
  AgentBridgeView,
  AgentClientId,
  AgentConnections,
  AgentSetupKind,
  AgentSetupResult,
} from './agent.js';
import type { SidebarFooterItem } from './chrome-types.js';
import type { RequestRule } from './page-override-types.js';
import type { InterfaceLanguage, SearchEngineId, SecureDnsSetting, ThemeSource } from './tab-types.js';

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
  screenshotsInDownloads: boolean;
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
  pageSwipe: boolean;
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
  spaceShares: { id: string; spaceIds: string[] }[];
}

export type SpaceAction = 'create' | 'rename' | 'remove' | 'share';

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
  spaceAction: 'yalqen-settings:space-action',
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
  spaceAction(action: SpaceAction, id?: string, value?: string | null): Promise<string | null>;
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
