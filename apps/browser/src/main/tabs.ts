import { randomUUID } from 'node:crypto';
import {
  WebContentsView,
  net,
  type BaseWindow,
  type ContextMenuParams,
  type Rectangle,
  type Session,
  type WebContents,
  type WebPreferences,
} from 'electron';
import {
  BOOKMARKS_URL,
  DOWNLOADS_URL,
  HISTORY_URL,
  NEW_TAB_URL,
  PageChannel,
  SETTINGS_URL,
  type BrowserState,
  type CommandPage,
  type DeviceFrame,
  type DeviceId,
  type FindResult,
  type NewTabCenter,
  type PageLanguage,
  type PageOverrides,
  type RequestRule,
  type TabId,
  type TabSnapshot,
  type TranslationStatus,
} from '../shared/types.js';
import { PROCEED_URL } from './certificates.js';
import {
  applyDeviceMetrics,
  applyEmulation,
  clearEmulation,
  emulatedUserAgent,
  fitDevice,
  resizeEmulation,
  rotateEmulation,
  scaleEmulation,
  type Emulation,
} from './devices.js';
import { ERR_ABORTED, errorPageScript, isCertificateError } from './error-page.js';
import { isSameVisit } from './history.js';
import { PROCEED_HTTP_URL } from './https-only.js';
import { internalNavigation, isAllowedFrom, type InternalNavigation } from './internal-navigation.js';
import { shouldDiscard, type DiscardCandidate } from './memory-saver.js';
import { captureFullPage, sendCommands } from './page-debugger.js';
import { canViewSource } from './page-export.js';
import { NO_OVERRIDES, hasOverrides, overrideCommands } from './page-overrides.js';
import { pausedRequestCommand, type PausedRequest } from './request-rules.js';
import { MEASURE_STORAGE_SCRIPT, parseStorageUsage, type StorageUsage } from './site-data.js';
import { trimHistory, type PersistChange, type SavedHistory, type SavedTab, type SavedWindow } from './persistence.js';
import { isActivation, mayOpenWindow, recordBlocked } from './popups.js';
import { securityState } from './site-info.js';
import { withoutHash } from './url.js';
import { detectLanguage, restorePage, translatePage, translateSelection, type FetchLike } from './translate.js';
import { stepZoom } from './zoom.js';

const MAX_CLOSED_TABS = 20;
const STORAGE_WORLD_ID = 1001;
// Past this the badge reads "99+", so further errors need not re-render the chrome.
const MAX_CONSOLE_ERRORS = 99;
const NEW_TAB_TITLE = 'Yeni sekme';

interface Tab {
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
}

export interface TabManagerOptions {
  window: BaseWindow;
  pagePreload: string;
  closed: SavedTab[];
  privateWindow: boolean;
  session: Session;
  privateSession: Session;
  onPrivateEnded: () => void;
  freezeBackground: () => boolean;
  onChange: (persist: PersistChange) => void;
  onPageSwipe: (direction: 'back' | 'forward') => void;
  onNewTabSearch: (query: string) => void;
  onHtmlFullScreenChange: (tabId: TabId, fullScreen: boolean) => void;
  onVisit: (url: string, title: string) => string | null;
  onVisitTitle: (id: string | null, title: string) => void;
  onVisitFavicon: (id: string | null, faviconUrl: string) => void;
  onHistoryDelete: (id: string) => void;
  onHistoryClear: () => void;
  onFindResult: (result: FindResult) => void;
  zoomFor: (url: string, isPrivate: boolean) => number;
  defaultZoom: () => number;
  hasOwnZoom: (url: string, isPrivate: boolean) => boolean;
  pagePreferences: () => Partial<WebPreferences>;
  onZoom: (url: string, factor: number, isPrivate: boolean) => void;
  hasCertificateException: (url: string) => boolean;
  certificateToken: (url: string) => string | null;
  onCertificateProceed: (token: string, url: string) => boolean;
  popupsAllowed: (url: string, isPrivate: boolean) => boolean;
  onPageCommand: (page: CommandPage, command: string, params: URLSearchParams) => void;
  isBookmarked: (url: string) => boolean;
  upgradeHttp: (url: string) => string | null;
  httpsOnlyWarning: (https: string, http: string) => string;
  onProceedHttp: (token: string, currentUrl: string) => string | null;
  confirmHttpRedirect: (url: string) => Promise<boolean>;
  onContextMenu: (contents: WebContents, params: ContextMenuParams) => void;
  requestRules: () => readonly RequestRule[];
  translation: () => { enabled: boolean; language: PageLanguage };
}

export interface RecentPage {
  url: string;
  title: string;
  faviconUrl: string | null;
}

export type DetachedTab = Tab;

export function recentPages(closed: readonly SavedTab[], limit = 5): RecentPage[] {
  const pages: RecentPage[] = [];
  for (const tab of [...closed].reverse()) {
    if (!/^https?:/.test(tab.url) || pages.some((page) => page.url === tab.url)) continue;
    pages.push({ url: tab.url, title: tab.title, faviconUrl: tab.faviconUrl });
    if (pages.length === limit) break;
  }
  return pages;
}

const translationFetch: FetchLike = (endpoint, init) => net.fetch(endpoint, { ...init, credentials: 'omit' });

export class TabManager {
  private readonly tabs: Tab[] = [];
  private activeId: TabId | null = null;
  private pageBounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  private pageRadius = 0;
  private newTabCenterOffset = 0;
  private autoReloadTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: TabManagerOptions) {}

  get activeTabId(): TabId | null {
    return this.activeId;
  }

  get activeUrl(): string {
    return this.active()?.url ?? NEW_TAB_URL;
  }

  get liveCount(): number {
    return this.tabs.filter((tab) => tab.view).length;
  }

  get frozenCount(): number {
    return this.tabs.filter((tab) => tab.frozen).length;
  }

  get count(): number {
    return this.tabs.length;
  }

  forgetClosed(url: string): void {
    const closed = this.options.closed;
    for (let i = closed.length - 1; i >= 0; i--) {
      if (closed[i].url === url) closed.splice(i, 1);
    }
  }

  recentlyClosed(limit = 5): RecentPage[] {
    return recentPages(this.options.closed, limit);
  }

  state(): Pick<BrowserState, 'tabs' | 'activeTabId' | 'device' | 'zoom'> {
    const contents = this.active()?.view?.webContents;
    return {
      tabs: this.tabs.map((tab) => this.snapshot(tab)),
      activeTabId: this.activeId,
      device: this.deviceFrame(),
      zoom: contents && !contents.isDestroyed() ? contents.getZoomFactor() : 1,
    };
  }

  setPageLayout(bounds: Rectangle, newTabCenterOffset: number): void {
    const boundsChanged =
      bounds.x !== this.pageBounds.x ||
      bounds.y !== this.pageBounds.y ||
      bounds.width !== this.pageBounds.width ||
      bounds.height !== this.pageBounds.height;
    if (!boundsChanged && newTabCenterOffset === this.newTabCenterOffset) return;
    this.pageBounds = bounds;
    this.newTabCenterOffset = newTabCenterOffset;
    const tab = this.active();
    if (!tab) return;
    // The new tab applies the offset on its own resize, so it has to arrive before the bounds do.
    this.syncNewTabCenter(tab);
    if (!boundsChanged || !tab.view) return;
    this.layoutView(tab, tab.view, true);
    if (tab.emulation) this.changed();
  }

  private newTabCenter(tab: Tab): NewTabCenter {
    const contents = tab.view?.webContents;
    const zoom = contents && !contents.isDestroyed() ? contents.getZoomFactor() : 1;
    if (tab.emulation) return { offset: 0, width: null };
    return { offset: this.newTabCenterOffset / zoom, width: this.pageBounds.width / zoom };
  }

  private syncNewTabCenter(tab: Tab): void {
    if (tab.url !== NEW_TAB_URL) return;
    const contents = tab.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    contents.send(PageChannel.newTabCenter, this.newTabCenter(tab));
  }

  toggleEmulation(deviceId: DeviceId): void {
    const tab = this.active();
    if (!tab) return;
    this.setEmulation(tab, tab.emulation ? null : { deviceId, landscape: false });
  }

  toggleResponsive(): void {
    const tab = this.active();
    if (!tab) return;
    const responsive = tab.emulation?.deviceId === 'responsive';
    this.setEmulation(tab, responsive ? null : { deviceId: 'responsive', landscape: false });
  }

  selectDevice(deviceId: DeviceId): void {
    const tab = this.active();
    if (!tab) return;
    this.setEmulation(tab, { deviceId, landscape: tab.emulation?.landscape ?? false });
  }

  rotateDevice(): void {
    const tab = this.active();
    if (!tab?.emulation) return;
    this.setEmulation(tab, rotateEmulation(tab.emulation));
  }

  resizeDevice(size: { width: number; height: number }): void {
    const tab = this.active();
    if (tab?.emulation) this.updateDeviceMetrics(tab, resizeEmulation(tab.emulation, size));
  }

  setDeviceScaleFactor(scaleFactor: number): void {
    const tab = this.active();
    if (tab?.emulation) this.updateDeviceMetrics(tab, scaleEmulation(tab.emulation, scaleFactor));
  }

  private updateDeviceMetrics(tab: Tab, emulation: Emulation): void {
    if (emulation === tab.emulation) return;
    tab.emulation = emulation;
    if (tab.view) void this.layoutView(tab, tab.view, true);
    this.changed();
  }

  setPageRadius(radius: number): void {
    if (radius === this.pageRadius) return;
    this.pageRadius = radius;
    for (const tab of this.tabs) {
      if (!tab.emulation) tab.view?.setBorderRadius(radius);
    }
  }

  open(url = NEW_TAB_URL, { activate = true, isPrivate = this.options.privateWindow } = {}): TabId {
    const upgraded = this.options.upgradeHttp(url);
    const tab = this.createRecord({ url: upgraded ?? url }, isPrivate);
    if (upgraded) tab.upgrade = { https: upgraded, http: url };
    const index = this.activeId ? this.indexOf(this.activeId) + 1 : this.tabs.length;
    this.tabs.splice(index, 0, tab);
    if (activate) {
      this.activate(tab.id);
    } else {
      this.ensureLive(tab);
      this.changed(true);
    }
    return tab.id;
  }

  activate(id: TabId): void {
    const next = this.find(id);
    if (!next) return;

    const previous = this.active();
    if (previous?.view && previous.id !== id) {
      this.options.window.contentView.removeChildView(previous.view);
    }

    this.activeId = id;
    if (previous && previous.id !== id) {
      previous.inactiveSince = Date.now();
      this.maybeFreeze(previous);
    }
    const view = this.ensureLive(next);
    this.unfreeze(next);
    this.syncNewTabCenter(next);
    this.layoutView(next, view);
    this.options.window.contentView.addChildView(view);
    if (next.url !== 'about:blank') view.webContents.focus();
    this.changed(true);
  }

  focusActive(): boolean {
    const tab = this.active();
    if (!tab?.view || tab.url === 'about:blank') return false;
    tab.view.webContents.focus();
    return true;
  }

  close(id: TabId): void {
    const index = this.indexOf(id);
    if (index < 0) return;
    const { pinnedUrl } = this.tabs[index];
    if (pinnedUrl) {
      this.unloadPinned(this.tabs[index], pinnedUrl);
      return;
    }
    const [tab] = this.tabs.splice(index, 1);

    if (!tab.isPrivate) {
      this.options.closed.push(this.toSaved(tab));
      if (this.options.closed.length > MAX_CLOSED_TABS) this.options.closed.shift();
    }
    this.destroyView(tab);
    this.syncAutoReloadTimer();
    if (tab.isPrivate && !this.tabs.some((item) => item.isPrivate)) this.options.onPrivateEnded();

    if (this.activeId === id) {
      this.activeId = null;
      const neighbor = this.tabs[Math.min(index, this.tabs.length - 1)];
      if (neighbor) {
        this.activate(neighbor.id);
      } else {
        this.open();
      }
      return;
    }
    this.changed(true);
  }

  reopenClosed(): void {
    const saved = this.options.closed.pop();
    if (!saved) return;
    const tab = this.createRecord(saved);
    const index = this.activeId ? this.indexOf(this.activeId) + 1 : this.tabs.length;
    this.tabs.splice(index, 0, tab);
    this.activate(tab.id);
  }

  move(id: TabId, toIndex: number): void {
    const from = this.indexOf(id);
    if (from < 0) return;
    const [tab] = this.tabs.splice(from, 1);
    const target = Math.max(0, Math.min(toIndex, this.tabs.length));
    this.tabs.splice(target, 0, tab);
    this.changed(true);
  }

  discard(id: TabId): boolean {
    const tab = this.find(id);
    if (!tab?.view || id === this.activeId) return false;
    tab.history = this.captureHistory(tab);
    this.destroyView(tab);
    this.changed(true);
    return true;
  }

  discardCandidates(): (DiscardCandidate & { id: TabId })[] {
    const candidates: (DiscardCandidate & { id: TabId })[] = [];
    for (const tab of this.tabs) {
      const contents = tab.view?.webContents;
      if (!contents || contents.isDestroyed()) continue;
      candidates.push({
        id: tab.id,
        live: true,
        active: tab.id === this.activeId,
        pinned: tab.pinnedUrl !== null,
        loading: tab.loading,
        audible: contents.isCurrentlyAudible(),
        devToolsOpen: contents.isDevToolsOpened(),
        edited: tab.edited,
        inactiveSince: tab.inactiveSince,
      });
    }
    return candidates;
  }

  discardInactive(now: number, afterMinutes: number): number {
    let count = 0;
    for (const candidate of this.discardCandidates()) {
      if (shouldDiscard(candidate, now, afterMinutes) && this.discard(candidate.id)) count++;
    }
    return count;
  }

  discardBackground(): number {
    let count = 0;
    for (const tab of this.tabs) {
      if (!tab.pinnedUrl && this.discard(tab.id)) count++;
    }
    return count;
  }

  togglePin(id: TabId): void {
    const tab = this.find(id);
    if (!tab) return;
    if (tab.pinnedUrl) {
      tab.pinnedUrl = null;
      this.maybeFreeze(tab);
    } else {
      if (tab.isPrivate || !/^https?:/.test(tab.url)) return;
      tab.pinnedUrl = tab.url;
      this.unfreeze(tab);
    }
    this.changed(true);
  }

  private unloadPinned(tab: Tab, pinnedUrl: string): void {
    this.destroyView(tab);
    tab.url = pinnedUrl;
    tab.history = null;
    tab.failed = false;
    tab.upgrade = null;
    tab.blockedPopups = [];
    if (this.activeId !== tab.id) {
      this.changed(true);
      return;
    }
    const index = this.indexOf(tab.id);
    const others = [...this.tabs.slice(index + 1), ...this.tabs.slice(0, index).reverse()];
    const next = others.find((item) => !item.pinnedUrl) ?? others[0];
    if (next) this.activate(next.id);
    else this.open();
  }

  blockedPopups(): string[] {
    return [...(this.active()?.blockedPopups ?? [])];
  }

  openBlockedPopup(url: string): void {
    const tab = this.active();
    if (!tab) return;
    tab.blockedPopups = tab.blockedPopups.filter((item) => item !== url);
    this.open(url, { isPrivate: tab.isPrivate });
  }

  clearBlockedPopups(): void {
    const tab = this.active();
    if (!tab || tab.blockedPopups.length === 0) return;
    tab.blockedPopups = [];
    this.changed();
  }

  toggleMute(id: TabId): void {
    const tab = this.find(id);
    if (!tab) return;
    tab.muted = !tab.muted;
    tab.view?.webContents.setAudioMuted(tab.muted);
    this.changed();
  }

  navigate(url: string): void {
    const tab = this.active();
    if (!tab) return;
    const upgraded = this.options.upgradeHttp(url);
    tab.upgrade = upgraded ? { https: upgraded, http: url } : null;
    if (upgraded) url = upgraded;
    if (!tab.view && tab.emulation) {
      tab.url = url;
      tab.history = null;
      this.ensureLive(tab);
      return;
    }
    void this.ensureLive(tab).webContents.loadURL(url);
  }

  openHistory(): void {
    this.openSingle(HISTORY_URL);
  }

  openDownloads(): void {
    this.openSingle(DOWNLOADS_URL);
  }

  openBookmarks(): void {
    this.openSingle(BOOKMARKS_URL);
  }

  openSettings(pane?: string): void {
    this.openSingle(pane ? `${SETTINGS_URL}${pane}` : SETTINGS_URL);
  }

  activeContents(): WebContents | null {
    const contents = this.active()?.view?.webContents;
    return contents && !contents.isDestroyed() ? contents : null;
  }

  viewSource(): void {
    const tab = this.active();
    if (tab && canViewSource(tab.url)) this.open(`view-source:${tab.url}`, { isPrivate: tab.isPrivate });
  }

  activePage(): { url: string; title: string } | null {
    const tab = this.active();
    return tab ? { url: tab.url, title: tab.title } : null;
  }

  reloadPages(prefix: string): void {
    setImmediate(() => {
      for (const tab of this.tabs) {
        const contents = tab.view?.webContents;
        if (contents && !contents.isDestroyed() && tab.url.startsWith(prefix)) contents.reload();
      }
    });
  }

  private openSingle(url: string): void {
    const existing = this.tabs.find((tab) => tab.url.startsWith(url));
    if (existing) this.activate(existing.id);
    else this.open(url);
  }

  goBack(): void {
    const history = this.active()?.view?.webContents.navigationHistory;
    if (history?.canGoBack()) history.goBack();
  }

  goForward(): void {
    const history = this.active()?.view?.webContents.navigationHistory;
    if (history?.canGoForward()) history.goForward();
  }

  reload(): void {
    this.active()?.view?.webContents.reload();
  }

  reloadIgnoringCache(): void {
    this.active()?.view?.webContents.reloadIgnoringCache();
  }

  activeOverrides(): PageOverrides {
    return this.active()?.overrides ?? NO_OVERRIDES;
  }

  updateOverrides(patch: Partial<PageOverrides>): void {
    const tab = this.active();
    const contents = tab?.view?.webContents;
    if (!tab || !contents || contents.isDestroyed()) return;
    const previous = tab.overrides;
    const next = { ...previous, ...patch };
    if ((Object.keys(next) as (keyof PageOverrides)[]).every((key) => next[key] === previous[key])) return;
    tab.overrides = next;
    this.changed();
    this.pushOverrides(tab, contents)
      .then(() => {
        const userAgentChanged = next.userAgent !== previous.userAgent;
        if (userAgentChanged && tab.overrides === next && !contents.isDestroyed() && contents.getURL() !== '') {
          contents.reload();
        }
      })
      .catch((error: unknown) => {
        console.warn('[overrides] could not apply page overrides:', error);
        if (tab.overrides !== next) return;
        tab.overrides = previous;
        this.changed();
        this.pushOverrides(tab, contents).catch(() => undefined);
      });
  }

  async measureActiveStorage(timeoutMs = 500): Promise<StorageUsage | null> {
    const contents = this.activeContents();
    if (!contents) return null;
    const measured = contents
      .executeJavaScriptInIsolatedWorld(STORAGE_WORLD_ID, [{ code: MEASURE_STORAGE_SCRIPT }])
      .then(parseStorageUsage, () => null);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
    return Promise.race([measured, timeout]);
  }

  refreshRequestRules(): void {
    for (const tab of this.tabs) {
      const contents = tab.view?.webContents;
      if (!tab.overrides.requestRules || !contents || contents.isDestroyed()) continue;
      this.pushOverrides(tab, contents).catch((error: unknown) => {
        console.warn('[request-rules] could not refresh interception:', error);
      });
    }
  }

  private async pushOverrides(tab: Tab, contents: WebContents): Promise<void> {
    const commands = overrideCommands(tab.overrides, emulatedUserAgent(tab.emulation), this.options.requestRules());
    await sendCommands(contents, commands);
    this.releaseDebugger(tab, contents);
  }

  toggleTranslation(): void {
    const tab = this.active();
    const contents = tab?.view?.webContents;
    if (!tab || !contents || contents.isDestroyed()) return;
    if (tab.translation === 'translating') return;
    if (tab.translation === 'translated') {
      tab.translationRun++;
      tab.translation = 'idle';
      restorePage(contents).catch(() => undefined);
      this.changed();
      return;
    }
    if (!this.translationAvailable(tab)) return;
    const run = ++tab.translationRun;
    const url = contents.getURL();
    const cancelled = () => tab.translationRun !== run || contents.isDestroyed() || contents.getURL() !== url;
    tab.translation = 'translating';
    this.changed();
    translatePage(contents, translationFetch, this.options.translation().language, { cancelled })
      .then((result) => {
        if (cancelled()) return;
        tab.translation = result ? 'translated' : 'failed';
        this.changed();
      })
      .catch((error: unknown) => {
        console.warn('[translate] could not translate page:', error);
        if (cancelled()) return;
        tab.translation = 'failed';
        this.changed();
      });
  }

  canTranslateSelection(): boolean {
    return this.options.translation().enabled;
  }

  translateSelection(contents: WebContents): void {
    if (!this.canTranslateSelection() || contents.isDestroyed()) return;
    translateSelection(contents, translationFetch, this.options.translation().language).catch((error: unknown) => {
      console.warn('[translate] could not translate selection:', error);
    });
  }

  private translationAvailable(tab: Tab): boolean {
    const { enabled, language } = this.options.translation();
    if (!enabled || !tab.view || !/^https?:/i.test(tab.url) || tab.failed) return false;
    return tab.translation !== 'idle' || (tab.pageLanguage !== null && tab.pageLanguage !== language);
  }

  private resetTranslation(tab: Tab): void {
    tab.translationRun++;
    tab.translation = 'idle';
    tab.pageLanguage = null;
  }

  private detectPageLanguage(tab: Tab, contents: WebContents): void {
    const run = tab.translationRun;
    detectLanguage(contents)
      .then((language) => {
        if (tab.translationRun !== run || tab.pageLanguage === language) return;
        tab.pageLanguage = language;
        this.changed();
      })
      .catch(() => undefined);
  }

  setAutoReload(seconds: number | null): void {
    const tab = this.active();
    if (!tab) return;
    tab.autoReload = seconds ? { seconds, dueAt: Date.now() + seconds * 1000 } : null;
    this.unfreeze(tab);
    this.syncAutoReloadTimer();
    this.changed();
  }

  async captureActive(fullPage: boolean): Promise<{ png: Buffer; title: string; url: string } | null> {
    const tab = this.active();
    const contents = tab?.view?.webContents;
    if (!tab || !contents || contents.isDestroyed()) return null;
    const { title, url } = tab;
    try {
      const png = fullPage ? await captureFullPage(contents) : (await contents.capturePage()).toPNG();
      return { png, title, url };
    } finally {
      if (fullPage) this.releaseDebugger(tab, contents);
    }
  }

  private needsDebugger(tab: Tab): boolean {
    return tab.emulation !== null || hasOverrides(tab.overrides);
  }

  private releaseDebugger(tab: Tab, contents: WebContents): void {
    if (!this.needsDebugger(tab) && !contents.isDestroyed() && contents.debugger.isAttached()) {
      contents.debugger.detach();
    }
  }

  private syncAutoReloadTimer(): void {
    const needed = this.tabs.some((tab) => tab.autoReload);
    if (needed && !this.autoReloadTimer) {
      this.autoReloadTimer = setInterval(() => this.runAutoReload(), 1000);
    } else if (!needed && this.autoReloadTimer) {
      clearInterval(this.autoReloadTimer);
      this.autoReloadTimer = null;
    }
  }

  private runAutoReload(): void {
    const now = Date.now();
    for (const tab of this.tabs) {
      const contents = tab.view?.webContents;
      if (!tab.autoReload || now < tab.autoReload.dueAt || !contents || contents.isDestroyed()) continue;
      tab.autoReload.dueAt = now + tab.autoReload.seconds * 1000;
      // Typed but unsent form input would be lost, so the page waits until it is submitted.
      if (!tab.loading && !tab.edited) contents.reload();
    }
  }

  stop(): void {
    this.active()?.view?.webContents.stop();
  }

  applyDefaultZoom(): void {
    for (const tab of this.tabs) {
      const contents = tab.view?.webContents;
      if (!contents || contents.isDestroyed() || this.options.hasOwnZoom(tab.url, tab.isPrivate)) continue;
      contents.setZoomFactor(this.options.defaultZoom());
    }
    const active = this.active();
    if (active) this.syncNewTabCenter(active);
    this.changed();
  }

  zoom(direction: 1 | -1 | 0): void {
    const tab = this.active();
    if (tab?.view) this.zoomView(tab, tab.view, direction);
  }

  findInPage(text: string, forward: boolean, next: boolean): void {
    const contents = this.active()?.view?.webContents;
    if (!contents) return;
    if (text === '') {
      contents.stopFindInPage('clearSelection');
      this.options.onFindResult({ active: 0, matches: 0 });
      return;
    }
    contents.findInPage(text, { forward, findNext: !next });
  }

  stopFind(id: TabId): void {
    const contents = this.find(id)?.view?.webContents;
    if (contents && !contents.isDestroyed()) contents.stopFindInPage('keepSelection');
  }

  applyFreezeSetting(): void {
    for (const tab of this.tabs) {
      if (this.options.freezeBackground()) this.maybeFreeze(tab);
      else this.unfreeze(tab);
    }
    this.changed();
  }

  toggleDevTools(): void {
    this.active()?.view?.webContents.toggleDevTools();
  }

  openDevTools(): void {
    const contents = this.activeContents();
    if (contents && !contents.isDevToolsOpened()) contents.openDevTools();
  }

  selectByIndex(index: number): void {
    const tab = index < 0 ? this.tabs.at(-1) : this.tabs[index];
    if (tab) this.activate(tab.id);
  }

  selectRelative(offset: number): void {
    if (this.tabs.length < 2 || !this.activeId) return;
    const count = this.tabs.length;
    const index = (((this.indexOf(this.activeId) + offset) % count) + count) % count;
    this.activate(this.tabs[index].id);
  }

  restore(session: SavedWindow, url?: string): void {
    for (const saved of session.tabs) {
      this.tabs.push(this.createRecord(saved));
    }
    const active = session.activeTabId ? this.find(session.activeTabId) : undefined;
    if (active) {
      this.activate(active.id);
    } else {
      this.open(url);
    }
  }

  toSavedWindow(): SavedWindow {
    const kept = this.tabs.filter((tab) => !tab.isPrivate);
    return {
      activeTabId: kept.some((tab) => tab.id === this.activeId) ? this.activeId : (kept[0]?.id ?? null),
      tabs: kept.map((tab) => this.toSaved(tab)),
    };
  }

  hasContents(contents: WebContents): boolean {
    return this.tabs.some((tab) => tab.view?.webContents === contents);
  }

  suggestionTabs(): { id: TabId; title: string; url: string }[] {
    return this.tabs.filter((tab) => tab.id !== this.activeId).map(({ id, title, url }) => ({ id, title, url }));
  }

  get pinnedPages(): RecentPage[] {
    return this.tabs.flatMap((tab) =>
      tab.pinnedUrl ? [{ url: tab.pinnedUrl, title: tab.title, faviconUrl: tab.faviconUrl }] : [],
    );
  }

  get hasPrivateTabs(): boolean {
    return this.tabs.some((tab) => tab.isPrivate);
  }

  detach(id: TabId): DetachedTab | null {
    const index = this.indexOf(id);
    const tab = this.tabs[index];
    if (!tab || this.tabs.length < 2) return null;
    this.tabs.splice(index, 1);
    this.unfreeze(tab);
    tab.detachListeners?.();
    tab.detachListeners = null;
    if (tab.view) this.options.window.contentView.removeChildView(tab.view);
    this.options.onHtmlFullScreenChange(tab.id, false);
    this.syncAutoReloadTimer();
    if (this.activeId === id) {
      this.activeId = null;
      this.activate(this.tabs[Math.min(index, this.tabs.length - 1)].id);
    } else {
      this.changed(true);
    }
    return tab;
  }

  adopt(tab: DetachedTab): void {
    const index = this.activeId ? this.indexOf(this.activeId) + 1 : this.tabs.length;
    this.tabs.splice(index, 0, tab);
    if (tab.view) this.attachListeners(tab, tab.view);
    this.syncAutoReloadTimer();
    this.activate(tab.id);
  }

  get activeIsPrivate(): boolean {
    return this.active()?.isPrivate ?? false;
  }

  isPrivateContents(contents: WebContents): boolean {
    return this.tabs.some((tab) => tab.isPrivate && tab.view?.webContents === contents);
  }

  destroyAll(): void {
    for (const tab of this.tabs) {
      tab.autoReload = null;
      this.destroyView(tab);
    }
    this.syncAutoReloadTimer();
  }

  private createRecord(saved: Partial<SavedTab> & { url: string }, isPrivate = false): Tab {
    return {
      id: saved.id ?? randomUUID(),
      view: null,
      url: saved.url,
      title: saved.title ?? NEW_TAB_TITLE,
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
    };
  }

  private ensureLive(tab: Tab): WebContentsView {
    if (tab.view) return tab.view;

    const view = new WebContentsView({
      webPreferences: {
        ...this.options.pagePreferences(),
        preload: this.options.pagePreload,
        session: tab.isPrivate ? this.options.privateSession : this.options.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    view.setBackgroundColor(tab.url === NEW_TAB_URL ? '#00000000' : '#ffffff');
    if (tab.muted) view.webContents.setAudioMuted(true);
    tab.view = view;
    this.attachListeners(tab, view);
    const emulated = this.layoutView(tab, view);
    if (emulated) {
      void emulated.then(() => {
        if (tab.view === view) this.load(tab, view);
      });
    } else {
      this.load(tab, view);
    }
    return view;
  }

  private load(tab: Tab, view: WebContentsView): void {
    const history = tab.history;
    tab.history = null;
    const contents = view.webContents;
    if (history && history.entries.length > 0) {
      contents.navigationHistory.restore({ entries: history.entries, index: history.index }).catch(() => {
        if (tab.view === view && !contents.isDestroyed() && contents.navigationHistory.length() === 0) {
          void contents.loadURL(tab.url);
        }
      });
    } else {
      void contents.loadURL(tab.url);
    }
  }

  private zoomView(tab: Tab, view: WebContentsView, direction: 1 | -1 | 0): void {
    const contents = view.webContents;
    const factor = direction === 0 ? this.options.defaultZoom() : stepZoom(contents.getZoomFactor(), direction);
    contents.setZoomFactor(factor);
    this.syncNewTabCenter(tab);
    this.options.onZoom(contents.getURL(), factor, tab.isPrivate);
    this.changed();
  }

  private setEmulation(tab: Tab, emulation: Emulation | null): void {
    const wasEmulated = tab.emulation !== null;
    tab.emulation = emulation;
    this.syncNewTabCenter(tab);
    const view = tab.view;
    if (view) {
      const applied = emulation ? this.layoutView(tab, view) : this.clearDevice(tab, view);
      void (applied ?? Promise.resolve()).then(async () => {
        const contents = view.webContents;
        // Device changes reset the user agent, so the tab's own overrides go back on top.
        if (hasOverrides(tab.overrides) && tab.view === view && !contents.isDestroyed()) {
          await this.pushOverrides(tab, contents).catch((error: unknown) => {
            console.warn('[overrides] could not restore page overrides:', error);
          });
        }
        if (wasEmulated !== (emulation !== null) && !contents.isDestroyed() && contents.getURL() !== '') {
          contents.reload();
        }
      });
    }
    this.changed();
  }

  private clearDevice(tab: Tab, view: WebContentsView): Promise<void> {
    this.layoutView(tab, view);
    return clearEmulation(view.webContents).catch((error: unknown) => {
      console.warn('[emulation] could not clear device overrides:', error);
    });
  }

  private layoutView(tab: Tab, view: WebContentsView, metricsOnly = false): Promise<void> | null {
    if (!tab.emulation) {
      view.setBorderRadius(this.pageRadius);
      view.setBounds(this.pageBounds);
      return null;
    }
    const frame = fitDevice(tab.emulation, this.pageBounds);
    view.setBorderRadius(Math.round(frame.cornerRadius * frame.scale));
    view.setBounds({
      x: this.pageBounds.x + frame.x,
      y: this.pageBounds.y + frame.y,
      width: frame.viewWidth,
      height: frame.viewHeight,
    });
    const apply = metricsOnly ? applyDeviceMetrics : applyEmulation;
    return apply(view.webContents, tab.emulation, frame.scale).catch((error: unknown) => {
      console.warn('[emulation] could not apply device overrides:', error);
    });
  }

  private deviceFrame(): DeviceFrame | null {
    const emulation = this.active()?.emulation;
    return emulation ? fitDevice(emulation, this.pageBounds) : null;
  }

  private attachListeners(tab: Tab, view: WebContentsView): void {
    const contents = view.webContents;
    const disposers: (() => void)[] = [];
    const listen = ((event: string, listener: (...args: never[]) => void) => {
      contents.on(event as never, listener);
      disposers.push(() => contents.off(event as never, listener));
      return contents;
    }) as unknown as WebContents['on'];
    tab.detachListeners = () => {
      for (const dispose of disposers) dispose();
    };

    listen('before-input-event', (_event, input) => {
      const modifier = input.control || input.meta || input.alt || input.shift;
      if (input.type === 'keyDown' && input.key === 'Escape' && !modifier && tab.loading) contents.stop();
    });

    listen('ipc-message', (event, channel, direction) => {
      if (channel !== PageChannel.swipe || event.senderFrame !== contents.mainFrame || tab.id !== this.activeId) return;
      if (direction === 'back' || direction === 'forward') this.options.onPageSwipe(direction);
    });

    listen('ipc-message-sync', (event, channel) => {
      if (channel !== PageChannel.newTabCenter) return;
      event.returnValue =
        event.senderFrame === contents.mainFrame ? this.newTabCenter(tab) : { offset: 0, width: null };
    });

    listen('zoom-changed', (_event, direction) => this.zoomView(tab, view, direction === 'in' ? 1 : -1));
    listen('did-navigate', (_event, url) => {
      tab.edited = false;
      view.setBackgroundColor(url === NEW_TAB_URL ? '#00000000' : '#ffffff');
      const factor = this.options.zoomFor(url, tab.isPrivate);
      if (Math.abs(contents.getZoomFactor() - factor) > 0.001) contents.setZoomFactor(factor);
    });

    listen('context-menu', (_event, params) => this.options.onContextMenu(contents, params));

    listen('found-in-page', (_event, result) => {
      if (tab.id !== this.activeId || result.matches === undefined) return;
      this.options.onFindResult({ active: result.activeMatchOrdinal ?? 0, matches: result.matches });
    });

    listen('enter-html-full-screen', () => this.options.onHtmlFullScreenChange(tab.id, true));
    listen('leave-html-full-screen', () => this.options.onHtmlFullScreenChange(tab.id, false));

    listen('will-navigate', (event) => {
      const navigation = internalNavigation(event.url);
      if (navigation) {
        event.preventDefault();
        if (isAllowedFrom(navigation, contents.getURL())) this.runInternalNavigation(tab, contents, navigation);
        return;
      }
      const upgraded = this.options.upgradeHttp(event.url);
      if (!upgraded) return;
      event.preventDefault();
      tab.upgrade = { https: upgraded, http: event.url };
      void contents.loadURL(upgraded);
    });
    listen('input-event', (_event, input) => {
      if (isActivation(input.type)) tab.activatedAt = Date.now();
      if (input.type === 'char') tab.edited = true;
    });
    contents.setWindowOpenHandler(({ url }) => {
      if (mayOpenWindow(tab.activatedAt, Date.now(), this.options.popupsAllowed(contents.getURL(), tab.isPrivate))) {
        tab.activatedAt = 0;
        this.open(url, { isPrivate: tab.isPrivate });
      } else {
        tab.blockedPopups = recordBlocked(tab.blockedPopups, url);
        this.changed();
      }
      return { action: 'deny' };
    });
    listen('page-title-updated', (_event, title) => {
      if (tab.url === contents.getURL()) this.options.onVisitTitle(tab.visitId, title);
      if (tab.title === title) return;
      tab.title = title;
      this.changed('lazy');
    });
    listen('page-favicon-updated', (_event, favicons) => {
      const faviconUrl = favicons[0] ?? null;
      if (faviconUrl && tab.url === contents.getURL()) this.options.onVisitFavicon(tab.visitId, faviconUrl);
      if (tab.faviconUrl === faviconUrl) return;
      tab.faviconUrl = faviconUrl;
      this.changed('lazy');
    });
    listen('did-start-loading', () => {
      tab.loading = true;
      this.changed();
    });
    listen('did-stop-loading', () => {
      tab.loading = false;
      this.options.onVisitTitle(tab.visitId, contents.getTitle());
      this.maybeFreeze(tab);
      this.changed();
    });
    listen('audio-state-changed', ({ audible }) => {
      if (!audible) this.maybeFreeze(tab);
      this.changed();
    });
    listen('devtools-closed', () => this.maybeFreeze(tab));
    listen('did-start-navigation', ({ isMainFrame, isSameDocument }) => {
      if (!isMainFrame || isSameDocument) return;
      const hadTranslationState = tab.translation !== 'idle' || tab.pageLanguage !== null;
      this.resetTranslation(tab);
      if (tab.blockedPopups.length === 0 && tab.consoleErrors === 0 && !hadTranslationState) return;
      tab.blockedPopups = [];
      tab.consoleErrors = 0;
      this.changed();
    });
    listen('console-message', ({ level }) => {
      if (level !== 'error' || tab.consoleErrors > MAX_CONSOLE_ERRORS) return;
      tab.consoleErrors++;
      this.changed();
    });
    listen('will-redirect', (event) => {
      if (!event.isMainFrame) return;
      if (!this.options.upgradeHttp(event.url)) return;
      event.preventDefault();
      const http = event.url;
      void this.options.confirmHttpRedirect(http).then((follow) => {
        if (!follow || tab.view !== view || contents.isDestroyed()) return;
        const load = () => {
          if (tab.view !== view || contents.isDestroyed()) return;
          tab.upgrade = null;
          void contents.loadURL(http);
        };
        if (contents.isLoading()) contents.once('did-stop-loading', load);
        else load();
      });
    });
    const updateUrl = (newVisit: boolean) => {
      tab.url = contents.getURL();
      tab.failed = false;
      tab.upgrade = null;
      const title = contents.getTitle();
      if (title && title !== tab.title) tab.title = title;
      if (newVisit) tab.visitId = tab.isPrivate ? null : this.options.onVisit(tab.url, tab.url);
      this.changed(true);
    };
    const onDebuggerDetach = () => {
      if (tab.view !== view || !this.needsDebugger(tab) || contents.isDestroyed()) return;
      tab.emulation = null;
      tab.overrides = NO_OVERRIDES;
      this.layoutView(tab, view);
      this.changed();
    };
    contents.debugger.on('detach', onDebuggerDetach);
    disposers.push(() => contents.debugger.off('detach', onDebuggerDetach));
    // A paused request stalls the page until it is answered, so every pause gets a reply.
    const onDebuggerMessage = (_event: Electron.Event, method: string, params: unknown) => {
      if (method !== 'Fetch.requestPaused' || contents.isDestroyed()) return;
      const paused = params as PausedRequest;
      const { method: command, params: reply } = pausedRequestCommand(this.options.requestRules(), paused);
      contents.debugger.sendCommand(command, reply).catch(() => {
        if (contents.isDestroyed() || !contents.debugger.isAttached()) return;
        contents.debugger.sendCommand('Fetch.continueRequest', { requestId: paused.requestId }).catch(() => undefined);
      });
    };
    contents.debugger.on('message', onDebuggerMessage);
    disposers.push(() => contents.debugger.off('message', onDebuggerMessage));
    listen('did-navigate', () => updateUrl(true));
    let failure: string | null = null;
    listen('did-fail-load', (_event, code, name, url, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return;
      const upgrade = tab.upgrade;
      if (upgrade && withoutHash(url) === withoutHash(upgrade.https)) {
        const token = this.options.httpsOnlyWarning(upgrade.https, upgrade.http);
        failure = errorPageScript(code, name, url, `${PROCEED_HTTP_URL}${token}`, true);
      } else {
        const token = isCertificateError(code) ? this.options.certificateToken(url) : null;
        failure = errorPageScript(code, name, url, token ? `${PROCEED_URL}${token}` : null);
      }
      tab.url = url;
      tab.failed = true;
      tab.visitId = null;
      this.changed(true);
    });
    listen('did-finish-load', () => {
      this.syncNewTabCenter(tab);
      this.detectPageLanguage(tab, contents);
      if (!failure) return;
      const script = failure;
      failure = null;
      void contents.executeJavaScript(script).catch(() => {});
    });
    listen('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) updateUrl(!isSameVisit(tab.url, url));
    });
    listen('render-process-gone', () => {
      tab.history = this.captureHistory(tab);
      setImmediate(() => {
        this.destroyView(tab);
        this.changed(true);
      });
    });
  }

  private runInternalNavigation(tab: Tab, contents: WebContents, navigation: InternalNavigation): void {
    switch (navigation.type) {
      case 'proceed-http': {
        const http = this.options.onProceedHttp(navigation.token, contents.getURL());
        if (!http) return;
        tab.upgrade = null;
        void contents.loadURL(http);
        return;
      }
      case 'proceed-certificate':
        if (this.options.onCertificateProceed(navigation.token, contents.getURL())) contents.reload();
        return;
      case 'page-command':
        this.options.onPageCommand(navigation.page, navigation.name, navigation.params);
        return;
      case 'history-delete':
        this.options.onHistoryDelete(navigation.id);
        contents.reload();
        return;
      case 'history-clear':
        this.options.onHistoryClear();
        void contents.loadURL(HISTORY_URL);
        return;
      case 'new-tab-search':
        this.options.onNewTabSearch(navigation.query);
        return;
      case 'new-tab-forget':
        this.forgetClosed(navigation.url);
        contents.reload();
        return;
    }
  }

  private maybeFreeze(tab: Tab): void {
    const contents = tab.view?.webContents;
    if (!contents || contents.isDestroyed() || tab.frozen || tab.loading) return;
    if (!this.options.freezeBackground() || tab.id === this.activeId || tab.pinnedUrl || tab.autoReload) return;
    if (contents.isCurrentlyAudible() || contents.isDevToolsOpened()) return;
    tab.frozen = true;
    this.setLifecycleState(tab, 'frozen');
    this.changed();
  }

  private unfreeze(tab: Tab): void {
    if (!tab.frozen) return;
    tab.frozen = false;
    this.setLifecycleState(tab, 'active');
  }

  private setLifecycleState(tab: Tab, state: 'frozen' | 'active'): void {
    const contents = tab.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
    const failed = (error: unknown) => {
      console.warn(`[freeze] ${state} failed for ${tab.url}: ${(error as Error).message}`);
      if (state === 'frozen' && tab.frozen && tab.view?.webContents === contents) {
        tab.frozen = false;
        this.changed();
      }
    };
    try {
      if (!contents.debugger.isAttached()) contents.debugger.attach('1.3');
    } catch (error) {
      failed(error);
      return;
    }
    contents.debugger
      .sendCommand('Page.setWebLifecycleState', { state })
      .then(() => {
        const settled = tab.frozen === (state === 'frozen');
        if (settled && !this.needsDebugger(tab) && !contents.isDestroyed() && contents.debugger.isAttached()) {
          contents.debugger.detach();
        }
      })
      .catch((error: unknown) => {
        if (!contents.isDestroyed()) failed(error);
      });
  }

  private captureHistory(tab: Tab): SavedHistory | null {
    const history = tab.view?.webContents.navigationHistory;
    if (!history) return tab.history;
    const entries = history.getAllEntries();
    return entries.length > 0 ? { entries, index: history.getActiveIndex() } : tab.history;
  }

  private destroyView(tab: Tab): void {
    const view = tab.view;
    if (!view) return;
    this.options.onHtmlFullScreenChange(tab.id, false);
    tab.view = null;
    tab.loading = false;
    tab.frozen = false;
    tab.overrides = NO_OVERRIDES;
    this.resetTranslation(tab);
    this.options.window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  private toSaved(tab: Tab): SavedTab {
    const history = this.captureHistory(tab);
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      faviconUrl: tab.faviconUrl,
      pinnedUrl: tab.pinnedUrl,
      history: history && trimHistory(history),
    };
  }

  private snapshot(tab: Tab): TabSnapshot {
    const history = tab.view?.webContents.navigationHistory;
    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      faviconUrl: tab.faviconUrl,
      live: tab.view !== null,
      frozen: tab.frozen,
      loading: tab.loading,
      pinned: tab.pinnedUrl !== null,
      isPrivate: tab.isPrivate,
      bookmarked: this.options.isBookmarked(tab.url),
      security: tab.failed ? 'local' : securityState(tab.url, this.options.hasCertificateException(tab.url)),
      blockedPopups: tab.blockedPopups.length,
      consoleErrors: tab.consoleErrors,
      overrides: tab.overrides,
      translation: { status: tab.translation, available: this.translationAvailable(tab) },
      autoReloadSeconds: tab.autoReload?.seconds ?? null,
      audible: tab.view !== null && !tab.view.webContents.isDestroyed() && tab.view.webContents.isCurrentlyAudible(),
      muted: tab.muted,
      canGoBack: history?.canGoBack() ?? false,
      canGoForward: history?.canGoForward() ?? false,
    };
  }

  private active(): Tab | undefined {
    return this.activeId ? this.find(this.activeId) : undefined;
  }

  private find(id: TabId): Tab | undefined {
    return this.tabs.find((tab) => tab.id === id);
  }

  private indexOf(id: TabId): number {
    return this.tabs.findIndex((tab) => tab.id === id);
  }

  private changed(persist: PersistChange = false): void {
    this.options.onChange(persist);
  }
}
