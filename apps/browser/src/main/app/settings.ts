import fs from 'node:fs';
import path from 'node:path';
import type {
  InterfaceLanguage,
  PromptPermission,
  SecureDnsSetting,
  SettingsValues,
  ThemeSource,
} from '../../shared/types.js';
import type { AgentActionPolicy } from '../../shared/agent.js';
import { DEFAULT_SIDEBAR_FOOTER_ITEMS, sanitizeSidebarFooterItems, DEFAULT_ZOOM_FACTORS } from '../../shared/types.js';
import { sanitizeStartupUrls } from '../../shared/startup-pages.js';
import { sanitizeSpaceRules } from '../../shared/space-rules.js';
import { sanitizeSidebarWidgets } from '../../shared/sidebar-widgets.js';
import { DEFAULT_ACCENT, isAccentColor } from '../../shared/accent.js';
import { DEFAULT_FRAME_THEME, sanitizeFrameTheme } from '../../shared/frame-theme.js';
import { JsonFile } from '../storage/json-file.js';
import { isAutoArchiveHours } from '../tabs/auto-archive.js';
import { DEFAULT_DISCARD_AFTER_MINUTES, isDiscardAfterMinutes } from '../tabs/memory-saver.js';
import { sanitizeAgentOrigins } from '../agent-bridge/tab-scope.js';
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES } from '../address-bar/search.js';
import { sanitizeProtectionExceptions } from '../privacy/site-protections.js';
import { sanitizeShortcuts } from '../../shared/shortcuts.js';

export interface Settings extends SettingsValues {
  version: 1;
}

const DEFAULTS: Settings = {
  version: 1,
  searchEngine: DEFAULT_SEARCH_ENGINE,
  customSearchTemplate: null,
  theme: 'dark',
  darkSites: false,
  frameTheme: DEFAULT_FRAME_THEME,
  startupBehavior: 'restore',
  startupUrls: [],
  spaceRules: [],
  panelCollapsed: true,
  pinnedTabsStayHome: false,
  manualTabCleanup: false,
  tabModes: false,
  autoDeveloperMode: true,
  bookmarksPanel: false,
  touchIdPasskeys: false,
  sidebarWidgets: ['media'],
  sidebarFooterItems: [...DEFAULT_SIDEBAR_FOOTER_ITEMS],
  discardAfterMinutes: DEFAULT_DISCARD_AFTER_MINUTES,
  autoArchiveHours: 0,
  adBlocking: true,
  threatProtection: true,
  adBlockExceptions: [],
  thirdPartyCookieExceptions: [],
  httpsOnly: false,
  stripTrackingOnCopy: true,
  blockThirdPartyCookies: false,
  clearOnExit: false,
  blockedPermissionRequests: [],
  secureDns: 'automatic',
  defaultZoom: 1,
  interfaceLanguage: 'system',
  pageTranslation: true,
  miniWindow: true,
  pictureInPicture: false,
  autoUpdate: true,
  autoUpdateExtensions: true,
  usageCounting: false,
  askBeforeDownload: true,
  screenshotsInDownloads: false,
  downloadDirectory: null,
  displayName: '',
  accentColor: DEFAULT_ACCENT,
  dismissedUpdate: '',
  defaultBrowserPromptDismissed: false,
  agentBridge: false,
  agentOrigins: [],
  agentActions: 'ask',
  agentTracing: false,
  agentTerminal: false,
  agentFloating: false,
  recentTabCycling: true,
  pageSwipe: true,
  shortcuts: {},
};

const ENGINE_IDS = new Set<string>([...SEARCH_ENGINES.map((engine) => engine.id), 'custom']);
const THEMES = new Set<string>(['system', 'light', 'dark'] satisfies ThemeSource[]);
const SECURE_DNS = new Set<string>(['off', 'automatic', 'cloudflare', 'google', 'quad9'] satisfies SecureDnsSetting[]);
const STARTUP_BEHAVIORS = new Set<string>(['restore', 'new-tab', 'pages'] satisfies Settings['startupBehavior'][]);

const PROMPT_PERMISSIONS: readonly PromptPermission[] = ['camera', 'microphone', 'geolocation', 'notifications'];

function sanitizeBlockedPermissions(value: unknown, fallback: PromptPermission[]): PromptPermission[] {
  if (!Array.isArray(value)) return fallback;
  return PROMPT_PERMISSIONS.filter((kind) => value.includes(kind));
}

const AGENT_ACTIONS = new Set<string>(['off', 'ask', 'allow'] satisfies AgentActionPolicy[]);

const MAX_DISPLAY_NAME = 40;

function sanitizeDisplayName(value: string): string {
  const name = [...value.replace(/\s+/g, ' ').trim()].filter(
    (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
  );
  return name.slice(0, MAX_DISPLAY_NAME).join('').trim();
}

export function sanitizeSettings(data: unknown, base: Settings = DEFAULTS): Settings {
  const input = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const {
    searchEngine,
    customSearchTemplate,
    theme,
    darkSites,
    frameTheme,
    startupBehavior,
    startupUrls,
    spaceRules,
    panelCollapsed,
    pinnedTabsStayHome,
    manualTabCleanup,
    tabModes,
    autoDeveloperMode,
    bookmarksPanel,
    touchIdPasskeys,
    sidebarWidgets,
    sidebarFooterItems,
    discardAfterMinutes,
    autoArchiveHours,
    adBlocking,
    threatProtection,
    adBlockExceptions,
    thirdPartyCookieExceptions,
    httpsOnly,
    stripTrackingOnCopy,
    blockThirdPartyCookies,
    clearOnExit,
    blockedPermissionRequests,
    secureDns,
    defaultZoom,
    interfaceLanguage,
    pageTranslation,
    miniWindow,
    pictureInPicture,
    autoUpdate,
    autoUpdateExtensions,
    usageCounting,
    askBeforeDownload,
    screenshotsInDownloads,
    askDownloadLocation,
    downloadDirectory,
    displayName,
    accentColor,
    dismissedUpdate,
    defaultBrowserPromptDismissed,
    agentBridge,
    agentOrigins,
    agentActions,
    agentTracing,
    agentTerminal,
    agentFloating,
    recentTabCycling,
    pageSwipe,
    shortcuts,
  } = input;
  return {
    version: 1,
    searchEngine:
      typeof searchEngine === 'string' && ENGINE_IDS.has(searchEngine)
        ? (searchEngine as Settings['searchEngine'])
        : base.searchEngine,
    customSearchTemplate:
      customSearchTemplate === null || typeof customSearchTemplate === 'string'
        ? customSearchTemplate?.trim() || null
        : base.customSearchTemplate,
    theme: typeof theme === 'string' && THEMES.has(theme) ? (theme as ThemeSource) : base.theme,
    darkSites: typeof darkSites === 'boolean' ? darkSites : base.darkSites,
    frameTheme: sanitizeFrameTheme(frameTheme, base.frameTheme),
    startupBehavior:
      typeof startupBehavior === 'string' && STARTUP_BEHAVIORS.has(startupBehavior)
        ? (startupBehavior as Settings['startupBehavior'])
        : base.startupBehavior,
    startupUrls: Array.isArray(startupUrls) ? sanitizeStartupUrls(startupUrls) : base.startupUrls,
    spaceRules: Array.isArray(spaceRules) ? sanitizeSpaceRules(spaceRules) : base.spaceRules,
    panelCollapsed: typeof panelCollapsed === 'boolean' ? panelCollapsed : base.panelCollapsed,
    pinnedTabsStayHome: typeof pinnedTabsStayHome === 'boolean' ? pinnedTabsStayHome : base.pinnedTabsStayHome,
    manualTabCleanup: typeof manualTabCleanup === 'boolean' ? manualTabCleanup : base.manualTabCleanup,
    tabModes: typeof tabModes === 'boolean' ? tabModes : base.tabModes,
    autoDeveloperMode: typeof autoDeveloperMode === 'boolean' ? autoDeveloperMode : base.autoDeveloperMode,
    bookmarksPanel: typeof bookmarksPanel === 'boolean' ? bookmarksPanel : base.bookmarksPanel,
    touchIdPasskeys: typeof touchIdPasskeys === 'boolean' ? touchIdPasskeys : base.touchIdPasskeys,
    sidebarWidgets: sanitizeSidebarWidgets(sidebarWidgets, base.sidebarWidgets),
    sidebarFooterItems: sanitizeSidebarFooterItems(sidebarFooterItems, base.sidebarFooterItems),
    discardAfterMinutes: isDiscardAfterMinutes(discardAfterMinutes) ? discardAfterMinutes : base.discardAfterMinutes,
    autoArchiveHours: isAutoArchiveHours(autoArchiveHours) ? autoArchiveHours : base.autoArchiveHours,
    adBlocking: typeof adBlocking === 'boolean' ? adBlocking : base.adBlocking,
    threatProtection: typeof threatProtection === 'boolean' ? threatProtection : base.threatProtection,
    adBlockExceptions: Array.isArray(adBlockExceptions)
      ? sanitizeProtectionExceptions(adBlockExceptions)
      : base.adBlockExceptions,
    thirdPartyCookieExceptions: Array.isArray(thirdPartyCookieExceptions)
      ? sanitizeProtectionExceptions(thirdPartyCookieExceptions)
      : base.thirdPartyCookieExceptions,
    httpsOnly: typeof httpsOnly === 'boolean' ? httpsOnly : base.httpsOnly,
    stripTrackingOnCopy: typeof stripTrackingOnCopy === 'boolean' ? stripTrackingOnCopy : base.stripTrackingOnCopy,
    blockThirdPartyCookies:
      typeof blockThirdPartyCookies === 'boolean' ? blockThirdPartyCookies : base.blockThirdPartyCookies,
    clearOnExit: typeof clearOnExit === 'boolean' ? clearOnExit : base.clearOnExit,
    blockedPermissionRequests: sanitizeBlockedPermissions(blockedPermissionRequests, base.blockedPermissionRequests),
    secureDns:
      typeof secureDns === 'string' && SECURE_DNS.has(secureDns) ? (secureDns as SecureDnsSetting) : base.secureDns,
    defaultZoom:
      typeof defaultZoom === 'number' && (DEFAULT_ZOOM_FACTORS as readonly number[]).includes(defaultZoom)
        ? defaultZoom
        : base.defaultZoom,
    interfaceLanguage:
      interfaceLanguage === 'system' || interfaceLanguage === 'tr' || interfaceLanguage === 'en'
        ? (interfaceLanguage as InterfaceLanguage)
        : base.interfaceLanguage,
    pageTranslation: typeof pageTranslation === 'boolean' ? pageTranslation : base.pageTranslation,
    miniWindow: typeof miniWindow === 'boolean' ? miniWindow : base.miniWindow,
    pictureInPicture: typeof pictureInPicture === 'boolean' ? pictureInPicture : base.pictureInPicture,
    autoUpdate: typeof autoUpdate === 'boolean' ? autoUpdate : base.autoUpdate,
    autoUpdateExtensions: typeof autoUpdateExtensions === 'boolean' ? autoUpdateExtensions : base.autoUpdateExtensions,
    usageCounting: typeof usageCounting === 'boolean' ? usageCounting : base.usageCounting,
    askBeforeDownload:
      (typeof askBeforeDownload === 'boolean' ? askBeforeDownload : base.askBeforeDownload) ||
      askDownloadLocation === true,
    screenshotsInDownloads:
      typeof screenshotsInDownloads === 'boolean' ? screenshotsInDownloads : base.screenshotsInDownloads,
    downloadDirectory:
      downloadDirectory === null ||
      (typeof downloadDirectory === 'string' && path.isAbsolute(downloadDirectory) && !downloadDirectory.includes('\0'))
        ? downloadDirectory
        : base.downloadDirectory,
    displayName: typeof displayName === 'string' ? sanitizeDisplayName(displayName) : base.displayName,
    accentColor: isAccentColor(accentColor) ? accentColor : base.accentColor,
    dismissedUpdate: typeof dismissedUpdate === 'string' ? dismissedUpdate.slice(0, 64) : base.dismissedUpdate,
    defaultBrowserPromptDismissed:
      typeof defaultBrowserPromptDismissed === 'boolean'
        ? defaultBrowserPromptDismissed
        : base.defaultBrowserPromptDismissed,
    agentBridge: typeof agentBridge === 'boolean' ? agentBridge : base.agentBridge,
    agentOrigins: Array.isArray(agentOrigins) ? sanitizeAgentOrigins(agentOrigins) : base.agentOrigins,
    agentActions:
      typeof agentActions === 'string' && AGENT_ACTIONS.has(agentActions)
        ? (agentActions as AgentActionPolicy)
        : base.agentActions,
    agentTracing: typeof agentTracing === 'boolean' ? agentTracing : base.agentTracing,
    agentTerminal: typeof agentTerminal === 'boolean' ? agentTerminal : base.agentTerminal,
    agentFloating: typeof agentFloating === 'boolean' ? agentFloating : base.agentFloating,
    recentTabCycling: typeof recentTabCycling === 'boolean' ? recentTabCycling : base.recentTabCycling,
    pageSwipe: typeof pageSwipe === 'boolean' ? pageSwipe : base.pageSwipe,
    shortcuts: shortcuts === undefined ? base.shortcuts : sanitizeShortcuts(shortcuts),
  };
}

// Left out of settings files: AI agent access and usage consent must be granted on each Mac, and the rest are
// tied to this machine (a folder path, the Keychain group, a dismissed update or default-browser prompt).
const LOCAL_ONLY_KEYS = [
  'agentBridge',
  'agentOrigins',
  'agentActions',
  'agentTracing',
  'agentTerminal',
  'agentFloating',
  'usageCounting',
  'downloadDirectory',
  'touchIdPasskeys',
  'dismissedUpdate',
  'defaultBrowserPromptDismissed',
] as const satisfies readonly (keyof Settings)[];

export const SETTINGS_FILE_FORMAT = 'yalqen-settings';

function withoutLocalKeys(values: Record<string, unknown>): Record<string, unknown> {
  const portable = { ...values };
  for (const key of LOCAL_ONLY_KEYS) delete portable[key];
  return portable;
}

export function settingsFileText(values: SettingsValues): string {
  return JSON.stringify(
    { format: SETTINGS_FILE_FORMAT, version: 1, settings: withoutLocalKeys({ ...values }) },
    null,
    2,
  );
}

export function parseSettingsFile(text: string): Record<string, unknown> | null {
  try {
    const file = JSON.parse(text) as unknown;
    if (typeof file !== 'object' || file === null) return null;
    const { format, settings } = file as Record<string, unknown>;
    if (format !== SETTINGS_FILE_FORMAT || typeof settings !== 'object' || settings === null || Array.isArray(settings))
      return null;
    return withoutLocalKeys(settings as Record<string, unknown>);
  } catch {
    return null;
  }
}

function sameSettings(a: Settings, b: Settings): boolean {
  return (Object.keys(a) as (keyof Settings)[]).every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));
}

export class SettingsStore {
  readonly file: string;
  private readonly json: JsonFile;
  private current: Settings;

  constructor(directory: string) {
    this.file = path.join(directory, 'settings.json');
    this.json = new JsonFile(this.file, 'settings');
    this.current = this.load(DEFAULTS);
  }

  get(): Settings {
    return this.current;
  }

  update(patch: unknown): Settings | null {
    const next = sanitizeSettings({ ...this.current, ...(patch as object) }, this.current);
    if (sameSettings(next, this.current)) return this.current;
    if (!this.json.flush(() => next)) return null;
    this.current = next;
    return next;
  }

  private load(defaults: Settings): Settings {
    try {
      return sanitizeSettings(JSON.parse(fs.readFileSync(this.file, 'utf8')), defaults);
    } catch {
      return defaults;
    }
  }
}
