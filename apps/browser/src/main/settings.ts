import fs from 'node:fs';
import path from 'node:path';
import type {
  FontSizeSetting,
  PageLanguage,
  PanelSide,
  SecureDnsSetting,
  SettingsValues,
  ThemeSource,
  ToolbarButtonId,
} from '../shared/types.js';
import { REQUIRED_TOOLBAR_BUTTON, TOOLBAR_BUTTON_IDS } from '../shared/types.js';
import { JsonFile } from './json-file.js';
import { DEFAULT_DISCARD_AFTER_MINUTES, isDiscardAfterMinutes } from './memory-saver.js';
import { DEFAULT_ZOOM_FACTORS, FONT_SIZES } from './page-preferences.js';
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINES } from './search.js';

export interface Settings extends SettingsValues {
  version: 1;
}

const DEFAULTS: Settings = {
  version: 1,
  searchEngine: DEFAULT_SEARCH_ENGINE,
  customSearchTemplate: null,
  theme: 'light',
  startupBehavior: 'restore',
  panelCollapsed: false,
  panelSide: 'left',
  sidebarVisible: true,
  toolbarVisible: true,
  toolbarTabs: true,
  toolbarButtons: [...TOOLBAR_BUTTON_IDS],
  freezeBackgroundTabs: true,
  discardAfterMinutes: DEFAULT_DISCARD_AFTER_MINUTES,
  adBlocking: true,
  httpsOnly: false,
  blockThirdPartyCookies: false,
  secureDns: 'automatic',
  fontSize: 'medium',
  defaultZoom: 1,
  pageLanguage: 'tr',
  pageTranslation: true,
  autoUpdate: true,
  askBeforeDownload: true,
  welcomeCompleted: false,
};

const ENGINE_IDS = new Set<string>([...SEARCH_ENGINES.map((engine) => engine.id), 'custom']);
const THEMES = new Set<string>(['system', 'light', 'dark'] satisfies ThemeSource[]);
const PANEL_SIDES = new Set<string>(['left', 'right'] satisfies PanelSide[]);
const SECURE_DNS = new Set<string>(['off', 'automatic', 'cloudflare', 'google', 'quad9'] satisfies SecureDnsSetting[]);
const STARTUP_BEHAVIORS = new Set<string>(['restore', 'new-tab'] satisfies Settings['startupBehavior'][]);

const TOOLBAR_BUTTONS = new Set<string>(TOOLBAR_BUTTON_IDS);

function sanitizeToolbarButtons(value: unknown, fallback: ToolbarButtonId[]): ToolbarButtonId[] {
  if (!Array.isArray(value)) return fallback;
  const buttons = [...new Set(value)].filter((id): id is ToolbarButtonId => TOOLBAR_BUTTONS.has(id));
  return buttons.includes(REQUIRED_TOOLBAR_BUTTON) ? buttons : [...buttons, REQUIRED_TOOLBAR_BUTTON];
}

export function sanitizeSettings(data: unknown, base: Settings = DEFAULTS): Settings {
  const input = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
  const {
    searchEngine,
    customSearchTemplate,
    theme,
    startupBehavior,
    panelCollapsed,
    panelSide,
    sidebarVisible,
    toolbarVisible,
    toolbarTabs,
    toolbarButtons,
    freezeBackgroundTabs,
    discardAfterMinutes,
    adBlocking,
    httpsOnly,
    blockThirdPartyCookies,
    secureDns,
    fontSize,
    defaultZoom,
    pageLanguage,
    pageTranslation,
    autoUpdate,
    askBeforeDownload,
    welcomeCompleted,
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
    startupBehavior:
      typeof startupBehavior === 'string' && STARTUP_BEHAVIORS.has(startupBehavior)
        ? (startupBehavior as Settings['startupBehavior'])
        : base.startupBehavior,
    panelCollapsed: typeof panelCollapsed === 'boolean' ? panelCollapsed : base.panelCollapsed,
    panelSide: typeof panelSide === 'string' && PANEL_SIDES.has(panelSide) ? (panelSide as PanelSide) : base.panelSide,
    sidebarVisible: typeof sidebarVisible === 'boolean' ? sidebarVisible : base.sidebarVisible,
    toolbarVisible: typeof toolbarVisible === 'boolean' ? toolbarVisible : base.toolbarVisible,
    toolbarTabs: typeof toolbarTabs === 'boolean' ? toolbarTabs : base.toolbarTabs,
    toolbarButtons: sanitizeToolbarButtons(toolbarButtons, base.toolbarButtons),
    freezeBackgroundTabs: typeof freezeBackgroundTabs === 'boolean' ? freezeBackgroundTabs : base.freezeBackgroundTabs,
    discardAfterMinutes: isDiscardAfterMinutes(discardAfterMinutes) ? discardAfterMinutes : base.discardAfterMinutes,
    adBlocking: typeof adBlocking === 'boolean' ? adBlocking : base.adBlocking,
    httpsOnly: typeof httpsOnly === 'boolean' ? httpsOnly : base.httpsOnly,
    blockThirdPartyCookies:
      typeof blockThirdPartyCookies === 'boolean' ? blockThirdPartyCookies : base.blockThirdPartyCookies,
    secureDns:
      typeof secureDns === 'string' && SECURE_DNS.has(secureDns) ? (secureDns as SecureDnsSetting) : base.secureDns,
    fontSize: typeof fontSize === 'string' && fontSize in FONT_SIZES ? (fontSize as FontSizeSetting) : base.fontSize,
    defaultZoom:
      typeof defaultZoom === 'number' && (DEFAULT_ZOOM_FACTORS as readonly number[]).includes(defaultZoom)
        ? defaultZoom
        : base.defaultZoom,
    pageLanguage: pageLanguage === 'tr' || pageLanguage === 'en' ? (pageLanguage as PageLanguage) : base.pageLanguage,
    pageTranslation: typeof pageTranslation === 'boolean' ? pageTranslation : base.pageTranslation,
    autoUpdate: typeof autoUpdate === 'boolean' ? autoUpdate : base.autoUpdate,
    askBeforeDownload: typeof askBeforeDownload === 'boolean' ? askBeforeDownload : base.askBeforeDownload,
    welcomeCompleted: typeof welcomeCompleted === 'boolean' ? welcomeCompleted : base.welcomeCompleted,
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
    this.current = this.load();
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

  private load(): Settings {
    try {
      return sanitizeSettings(JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      return { ...DEFAULTS };
    }
  }
}
