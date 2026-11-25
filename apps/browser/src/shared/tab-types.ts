import type { AgentEpisodePreview } from './agent.js';
import type { PageOverrides } from './page-override-types.js';

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
