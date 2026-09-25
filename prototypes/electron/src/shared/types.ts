export type TabId = string;

/** Scheme for the browser's own pages, served from the tab session. */
export const INTERNAL_SCHEME = 'yalqen';
export const NEW_TAB_URL = 'yalqen://newtab/';

export type SearchEngineId = 'google' | 'yandex' | 'duckduckgo' | 'bing' | 'brave' | 'ecosia' | 'custom';
export type ThemeSource = 'system' | 'light' | 'dark';

/** Tab data exposed to the UI. A tab can exist without a live page. */
export interface TabSnapshot {
  id: TabId;
  title: string;
  url: string;
  faviconUrl: string | null;
  live: boolean;
  /** Live, but its page is frozen in the background (no JS, timers or animations). */
  frozen: boolean;
  loading: boolean;
  keepAlive: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export type DeviceId = 'iphone-15' | 'iphone-se' | 'pixel-8' | 'ipad-mini';

/** Where the emulated device screen sits, relative to the page area. */
export interface DeviceFrame {
  label: string;
  /** Emulated size in CSS pixels. */
  width: number;
  height: number;
  /** Rendered size divided by emulated size; below 1 when the window is too small. */
  scale: number;
  cornerRadius: number;
  x: number;
  y: number;
  viewWidth: number;
  viewHeight: number;
}

/**
 * `glass`: the window is transparent over the system glass material and only the
 * page card is opaque. `opaque`: no glass view (other platforms, addon missing)
 * or the system "Reduce transparency" setting is on.
 */
export type WindowMaterial = 'glass' | 'opaque';

export interface BrowserState {
  tabs: TabSnapshot[];
  activeTabId: TabId | null;
  totalMemoryMB: number | null;
  addressPlaceholder: string;
  panelCollapsed: boolean;
  material: WindowMaterial;
  /** Set while the active tab is shown as a device. */
  device: DeviceFrame | null;
}

/** Regions of the window reserved for the UI; the page view fills the rest. */
export interface ChromeLayout {
  panelWidth: number;
  /** Whether the macOS window controls fit at the top of the tab panel. */
  windowControls: boolean;
  /** Gap between the page card and the left, top and bottom window edges. */
  pageInset: number;
  /** Corner radius of the page card. */
  pageRadius: number;
}

export type UiCommand = { type: 'focus-address' };

/** Requests the UI sends to the main process. */
export type UiAction =
  | { type: 'new-tab'; url?: string }
  | { type: 'activate-tab'; id: TabId }
  | { type: 'close-tab'; id: TabId }
  | { type: 'discard-tab'; id: TabId }
  | { type: 'toggle-keep-alive'; id: TabId }
  | { type: 'move-tab'; id: TabId; toIndex: number }
  | { type: 'navigate'; input: string }
  | { type: 'go-back' }
  | { type: 'go-forward' }
  | { type: 'reload' }
  | { type: 'toggle-panel' }
  | { type: 'open-settings' };

export const IpcChannel = {
  getState: 'yalqen:get-state',
  state: 'yalqen:state',
  command: 'yalqen:command',
  setLayout: 'yalqen:set-layout',
  action: 'yalqen:action',
} as const;

/** API exposed to the UI renderer by the preload script. */
export interface YalqenApi {
  getState(): Promise<BrowserState>;
  onState(listener: (state: BrowserState) => void): () => void;
  onCommand(listener: (command: UiCommand) => void): () => void;
  setLayout(layout: ChromeLayout): void;
  send(action: UiAction): void;
}

/** User settings the settings window can change. */
export interface SettingsValues {
  searchEngine: SearchEngineId;
  /** Used when `searchEngine` is `custom`; `%s` marks the query. */
  customSearchTemplate: string | null;
  theme: ThemeSource;
  panelCollapsed: boolean;
  /** Freeze background tabs' pages when switching away from them. */
  freezeBackgroundTabs: boolean;
}

export interface SettingsView {
  values: SettingsValues;
  engines: { id: SearchEngineId; label: string }[];
  customTemplateValid: boolean;
}

export const SettingsChannel = {
  get: 'yalqen-settings:get',
  update: 'yalqen-settings:update',
  changed: 'yalqen-settings:changed',
} as const;

/** API exposed to the settings window by its preload script. */
export interface SettingsApi {
  get(): Promise<SettingsView>;
  update(patch: Partial<SettingsValues>): Promise<SettingsView>;
  onChange(listener: (view: SettingsView) => void): () => void;
}
