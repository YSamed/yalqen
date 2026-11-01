import fs from 'node:fs';
import path from 'node:path';
import type {
  AgentActionPolicy,
  InterfaceLanguage,
  PanelSide,
  PinnedDisplay,
  SecureDnsSetting,
  SettingsValues,
  ThemeSource,
  ToolbarButtonId,
} from '../../shared/types.js';
import {
  DEFAULT_GLASS_TINT,
  DEFAULT_ZOOM_FACTORS,
  REQUIRED_TOOLBAR_BUTTON,
  TOOLBAR_BUTTON_IDS,
} from '../../shared/types.js';
import { sanitizeStartupUrls } from '../../shared/startup-pages.js';
import { sanitizeSidebarWidgets } from '../../shared/sidebar-widgets.js';
import { DEFAULT_ACCENT, isAccentColor } from '../../shared/accent.js';
import { JsonFile } from '../storage/json-file.js';
import { DEFAULT_DISCARD_AFTER_MINUTES, isDiscardAfterMinutes } from '../tabs/memory-saver.js';
import { sanitizeAgentOrigins } from '../agent-bridge/tab-scope.js';
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES } from '../address-bar/search.js';
import { sanitizeProtectionExceptions } from '../privacy/site-protections.js';

export interface Settings extends SettingsValues {
  version: 1;
}

const DEFAULTS: Settings = {
  version: 1,
  searchEngine: DEFAULT_SEARCH_ENGINE,
  customSearchTemplate: null,
  theme: 'light',
  transparency: true,
  glassTint: DEFAULT_GLASS_TINT,
  startupBehavior: 'restore',
  startupUrls: [],
  panelCollapsed: false,
  panelSide: 'left',
  pinnedDisplay: 'always',
  sidebarVisible: true,
  sidebarWidgets: ['media'],
  toolbarVisible: true,
  toolbarButtons: [...TOOLBAR_BUTTON_IDS],
  discardAfterMinutes: DEFAULT_DISCARD_AFTER_MINUTES,
  adBlocking: true,
  threatProtection: true,
  adBlockExceptions: [],
  thirdPartyCookieExceptions: [],
  httpsOnly: false,
  blockThirdPartyCookies: false,
  secureDns: 'automatic',
  defaultZoom: 1,
  interfaceLanguage: 'system',
  pageTranslation: true,
  autoUpdate: true,
  autoUpdateExtensions: true,
  usageCounting: false,
  askBeforeDownload: true,
  downloadDirectory: null,
  welcomeCompleted: false,
  invitationSeen: false,
  displayName: '',
  accentColor: DEFAULT_ACCENT,
  dismissedAnnouncement: '',
  dismissedFeedback: '',
  dismissedUpdate: '',
  agentBridge: false,
  agentOrigins: [],
  agentActions: 'ask',
  agentTracing: false,
  agentTerminal: false,
};

const ENGINE_IDS = new Set<string>([...SEARCH_ENGINES.map((engine) => engine.id), 'custom']);
const THEMES = new Set<string>(['system', 'light', 'dark'] satisfies ThemeSource[]);
const PINNED_DISPLAYS = new Set<string>(['always', 'expanded', 'never'] satisfies PinnedDisplay[]);
const PANEL_SIDES = new Set<string>(['left', 'right'] satisfies PanelSide[]);
const SECURE_DNS = new Set<string>(['off', 'automatic', 'cloudflare', 'google', 'quad9'] satisfies SecureDnsSetting[]);
const STARTUP_BEHAVIORS = new Set<string>(['restore', 'new-tab', 'pages'] satisfies Settings['startupBehavior'][]);

const TOOLBAR_BUTTONS = new Set<string>(TOOLBAR_BUTTON_IDS);
const AGENT_ACTIONS = new Set<string>(['off', 'ask', 'allow'] satisfies AgentActionPolicy[]);

function sanitizeToolbarButtons(value: unknown, fallback: ToolbarButtonId[]): ToolbarButtonId[] {
  if (!Array.isArray(value)) return fallback;
  const buttons = [...new Set(value)].filter((id): id is ToolbarButtonId => TOOLBAR_BUTTONS.has(id));
  return buttons.includes(REQUIRED_TOOLBAR_BUTTON) ? buttons : [...buttons, REQUIRED_TOOLBAR_BUTTON];
}

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
    transparency,
    glassTint,
    startupBehavior,
    startupUrls,
    panelCollapsed,
    panelSide,
    pinnedDisplay,
    sidebarVisible,
    sidebarWidgets,
    toolbarVisible,
    toolbarButtons,
    discardAfterMinutes,
    adBlocking,
    threatProtection,
    adBlockExceptions,
    thirdPartyCookieExceptions,
    httpsOnly,
    blockThirdPartyCookies,
    secureDns,
    defaultZoom,
    interfaceLanguage,
    pageTranslation,
    autoUpdate,
    autoUpdateExtensions,
    usageCounting,
    askBeforeDownload,
    askDownloadLocation,
    downloadDirectory,
    welcomeCompleted,
    invitationSeen,
    displayName,
    accentColor,
    dismissedAnnouncement,
    dismissedFeedback,
    dismissedUpdate,
    agentBridge,
    agentOrigins,
    agentActions,
    agentTracing,
    agentTerminal,
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
    transparency: typeof transparency === 'boolean' ? transparency : base.transparency,
    glassTint:
      typeof glassTint === 'number' && Number.isFinite(glassTint)
        ? Math.round(Math.min(100, Math.max(0, glassTint)))
        : base.glassTint,
    startupBehavior:
      typeof startupBehavior === 'string' && STARTUP_BEHAVIORS.has(startupBehavior)
        ? (startupBehavior as Settings['startupBehavior'])
        : base.startupBehavior,
    startupUrls: Array.isArray(startupUrls) ? sanitizeStartupUrls(startupUrls) : base.startupUrls,
    panelCollapsed: typeof panelCollapsed === 'boolean' ? panelCollapsed : base.panelCollapsed,
    panelSide: typeof panelSide === 'string' && PANEL_SIDES.has(panelSide) ? (panelSide as PanelSide) : base.panelSide,
    pinnedDisplay:
      typeof pinnedDisplay === 'string' && PINNED_DISPLAYS.has(pinnedDisplay)
        ? (pinnedDisplay as PinnedDisplay)
        : base.pinnedDisplay,
    sidebarVisible: typeof sidebarVisible === 'boolean' ? sidebarVisible : base.sidebarVisible,
    sidebarWidgets: sanitizeSidebarWidgets(sidebarWidgets, base.sidebarWidgets),
    toolbarVisible: typeof toolbarVisible === 'boolean' ? toolbarVisible : base.toolbarVisible,
    toolbarButtons: sanitizeToolbarButtons(toolbarButtons, base.toolbarButtons),
    discardAfterMinutes: isDiscardAfterMinutes(discardAfterMinutes) ? discardAfterMinutes : base.discardAfterMinutes,
    adBlocking: typeof adBlocking === 'boolean' ? adBlocking : base.adBlocking,
    threatProtection: typeof threatProtection === 'boolean' ? threatProtection : base.threatProtection,
    adBlockExceptions: Array.isArray(adBlockExceptions)
      ? sanitizeProtectionExceptions(adBlockExceptions)
      : base.adBlockExceptions,
    thirdPartyCookieExceptions: Array.isArray(thirdPartyCookieExceptions)
      ? sanitizeProtectionExceptions(thirdPartyCookieExceptions)
      : base.thirdPartyCookieExceptions,
    httpsOnly: typeof httpsOnly === 'boolean' ? httpsOnly : base.httpsOnly,
    blockThirdPartyCookies:
      typeof blockThirdPartyCookies === 'boolean' ? blockThirdPartyCookies : base.blockThirdPartyCookies,
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
    autoUpdate: typeof autoUpdate === 'boolean' ? autoUpdate : base.autoUpdate,
    autoUpdateExtensions: typeof autoUpdateExtensions === 'boolean' ? autoUpdateExtensions : base.autoUpdateExtensions,
    usageCounting: typeof usageCounting === 'boolean' ? usageCounting : base.usageCounting,
    // The removed "ask where to save" option implied a prompt, so it keeps asking.
    askBeforeDownload:
      (typeof askBeforeDownload === 'boolean' ? askBeforeDownload : base.askBeforeDownload) ||
      askDownloadLocation === true,
    downloadDirectory:
      downloadDirectory === null ||
      (typeof downloadDirectory === 'string' && path.isAbsolute(downloadDirectory) && !downloadDirectory.includes('\0'))
        ? downloadDirectory
        : base.downloadDirectory,
    welcomeCompleted: typeof welcomeCompleted === 'boolean' ? welcomeCompleted : base.welcomeCompleted,
    invitationSeen: typeof invitationSeen === 'boolean' ? invitationSeen : base.invitationSeen,
    displayName: typeof displayName === 'string' ? sanitizeDisplayName(displayName) : base.displayName,
    accentColor: isAccentColor(accentColor) ? accentColor : base.accentColor,
    dismissedAnnouncement:
      typeof dismissedAnnouncement === 'string' ? dismissedAnnouncement.slice(0, 64) : base.dismissedAnnouncement,
    dismissedFeedback: typeof dismissedFeedback === 'string' ? dismissedFeedback.slice(0, 64) : base.dismissedFeedback,
    dismissedUpdate: typeof dismissedUpdate === 'string' ? dismissedUpdate.slice(0, 64) : base.dismissedUpdate,
    agentBridge: typeof agentBridge === 'boolean' ? agentBridge : base.agentBridge,
    agentOrigins: Array.isArray(agentOrigins) ? sanitizeAgentOrigins(agentOrigins) : base.agentOrigins,
    agentActions:
      typeof agentActions === 'string' && AGENT_ACTIONS.has(agentActions)
        ? (agentActions as AgentActionPolicy)
        : base.agentActions,
    agentTracing: typeof agentTracing === 'boolean' ? agentTracing : base.agentTracing,
    agentTerminal: typeof agentTerminal === 'boolean' ? agentTerminal : base.agentTerminal,
  };
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

  update(patch: unknown): Settings {
    const next = sanitizeSettings({ ...this.current, ...(patch as object) }, this.current);
    if (sameSettings(next, this.current)) return this.current;
    this.current = next;
    this.json.flush(() => next);
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
