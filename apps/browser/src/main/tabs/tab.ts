import { randomUUID } from 'node:crypto';
import { tabGroupName } from '../../shared/tab-groups.js';
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
  group: string | null;
  muted: boolean;
  isPrivate: boolean;
  detachListeners: (() => void) | null;
  upgrade: { https: string; http: string } | null;
  failed: boolean;
  activatedAt: number;
  inactiveSince: number;
  edited: boolean;
  interacted: boolean;
  blockedPopups: string[];
  overrides: PageOverrides;
  autoReload: { seconds: number; dueAt: number } | null;
  pageLanguage: string | null;
  translation: TranslationStatus;
  translationRun: number;
  loading: boolean;
  frozen: boolean;
  playingMedia: number;
  pip: boolean;
  soundAt: number;
  history: SavedHistory | null;
  emulation: Emulation | null;
  visitId: string | null;
  openerId: TabId | null;
  agent: TabRuntime | null;
  agentReadAt: number | null;
  // Unread items a mail or chat site shows in its title; null on other pages.
  unread: number | null;
}

export interface RecentPage {
  url: string;
  title: string;
  faviconUrl: string | null;
}

function restoredInactiveSince(saved: unknown): number {
  const now = Date.now();
  return typeof saved === 'number' && Number.isFinite(saved) && saved > 0 && saved <= now ? saved : now;
}

export function createTab(saved: Partial<SavedTab> & { url: string }, isPrivate = false): Tab {
  return {
    id: saved.id ?? randomUUID(),
    view: null,
    url: saved.url,
    title: saved.title ?? t('tabs.newTab'),
    faviconUrl: saved.faviconUrl ?? null,
    pinnedUrl: saved.pinnedUrl ?? (saved.keepAlive ? saved.url : null),
    group: tabGroupName(saved.group),
    muted: false,
    isPrivate,
    detachListeners: null,
    upgrade: null,
    failed: false,
    activatedAt: 0,
    inactiveSince: restoredInactiveSince(saved.inactiveSince),
    edited: false,
    interacted: false,
    blockedPopups: [],
    overrides: NO_OVERRIDES,
    autoReload: null,
    pageLanguage: null,
    translation: 'idle',
    translationRun: 0,
    loading: false,
    frozen: false,
    playingMedia: 0,
    pip: false,
    soundAt: 0,
    history: saved.history ?? null,
    emulation: null,
    visitId: null,
    openerId: null,
    agent: null,
    agentReadAt: null,
    unread: null,
  };
}

export function savedTab(tab: Tab): SavedTab {
  const navigation = liveContents(tab)?.navigationHistory;
  const history = navigation ? captureSavedHistory(navigation) : tab.history && trimHistory(tab.history);
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title,
    faviconUrl: tab.faviconUrl,
    pinnedUrl: tab.pinnedUrl,
    ...(tab.group && { group: tab.group }),
    history,
  };
}

export function liveContents(tab: Tab | undefined): Electron.WebContents | null {
  const contents = tab?.view?.webContents;
  return contents && !contents.isDestroyed() ? contents : null;
}

export function captureHistory(tab: Tab): SavedHistory | null {
  const history = liveContents(tab)?.navigationHistory;
  if (!history) return tab.history;
  const entries = history.getAllEntries();
  return entries.length > 0 ? { entries, index: history.getActiveIndex() } : tab.history;
}
