import { randomUUID } from 'node:crypto';
import type { WebContentsView } from 'electron';
import { t } from '../../shared/i18n.js';
import type { PageOverrides, TabId, TranslationStatus } from '../../shared/types.js';
import type { TabRuntime } from '../agent-bridge/runtime-buffer.js';
import type { Emulation } from '../devtools/devices.js';
import { NO_OVERRIDES } from '../devtools/page-overrides.js';
import { captureSavedHistory, trimHistory, type SavedHistory, type SavedTab } from './persistence.js';

export interface Tab {
  id: TabId;
  view: WebContentsView | null;
  url: string;
  title: string;
  faviconUrl: string | null;
  pinnedUrl: string | null;
  muted: boolean;
  isPrivate: boolean;
  detachListeners: (() => void) | null;
  upgrade: { https: string; http: string } | null;
  failed: boolean;
  activatedAt: number;
  inactiveSince: number;
  edited: boolean;
  blockedPopups: string[];
  consoleErrors: number;
  overrides: PageOverrides;
  autoReload: { seconds: number; dueAt: number } | null;
  pageLanguage: string | null;
  translation: TranslationStatus;
  translationRun: number;
  loading: boolean;
  frozen: boolean;
  history: SavedHistory | null;
  emulation: Emulation | null;
  visitId: string | null;
  openerId: TabId | null;
  agent: TabRuntime | null;
  agentReadAt: number | null;
}

export interface RecentPage {
  url: string;
  title: string;
  faviconUrl: string | null;
}

export function createTab(saved: Partial<SavedTab> & { url: string }, isPrivate = false): Tab {
  return {
    id: saved.id ?? randomUUID(),
    view: null,
    url: saved.url,
    title: saved.title ?? t('tabs.newTab'),
    faviconUrl: saved.faviconUrl ?? null,
    pinnedUrl: saved.pinnedUrl ?? (saved.keepAlive ? saved.url : null),
    muted: false,
    isPrivate,
    detachListeners: null,
    upgrade: null,
    failed: false,
    activatedAt: 0,
    inactiveSince: Date.now(),
    edited: false,
    blockedPopups: [],
    consoleErrors: 0,
    overrides: NO_OVERRIDES,
    autoReload: null,
    pageLanguage: null,
    translation: 'idle',
    translationRun: 0,
    loading: false,
    frozen: false,
    history: saved.history ?? null,
    emulation: null,
    visitId: null,
    openerId: null,
    agent: null,
    agentReadAt: null,
  };
}

export function savedTab(tab: Tab): SavedTab {
  const navigation = tab.view?.webContents.navigationHistory;
  const history = navigation ? captureSavedHistory(navigation) : tab.history && trimHistory(tab.history);
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title,
    faviconUrl: tab.faviconUrl,
    pinnedUrl: tab.pinnedUrl,
    history,
  };
}

export function liveContents(tab: Tab | undefined): Electron.WebContents | null {
  const contents = tab?.view?.webContents;
  return contents && !contents.isDestroyed() ? contents : null;
}

export function captureHistory(tab: Tab): SavedHistory | null {
  const history = tab.view?.webContents.navigationHistory;
  if (!history) return tab.history;
  const entries = history.getAllEntries();
  return entries.length > 0 ? { entries, index: history.getActiveIndex() } : tab.history;
}
