import {
  WebContentsView,
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
  type DeviceId,
  type FindResult,
  type PageLanguage,
  type PageOverrides,
  type RequestRule,
  type TabId,
  type TabSnapshot,
} from '../../shared/types.js';
import { withoutHash } from '../address-bar/url.js';
import { signInUserAgent } from '../app/page-preferences.js';
import { FEEDBACK_URL, REPO_URL, type RepoPromptAction } from '../app/repo-prompt.js';
import {
  applyDeviceMetrics,
  resizeEmulation,
  rotateEmulation,
  scaleEmulation,
  type Emulation,
} from '../devtools/devices.js';
import { attachDebugger, captureFullPage } from '../devtools/page-debugger.js';
import { canViewSource } from '../devtools/page-export.js';
import { NO_OVERRIDES, hasOverrides } from '../devtools/page-overrides.js';
import type { HeaderValue, PausedRequest } from '../devtools/request-rules.js';
import { newTraceparent } from '../agent-bridge/tracing.js';
import { isSameVisit } from '../library/history.js';
import { ERR_ABORTED, errorPageScript, isCertificateError } from '../pages/error-page.js';
import {
  internalNavigation,
  isAllowedFrom,
  type AnnouncementAction,
  type FeedbackAction,
  type InternalNavigation,
} from '../pages/internal-navigation.js';
import { PROCEED_URL } from '../privacy/certificates.js';
import { PROCEED_HTTP_URL } from '../privacy/https-only.js';
import { MEASURE_STORAGE_SCRIPT, parseStorageUsage, type StorageUsage } from '../privacy/site-data.js';
import { securityState } from '../privacy/site-info.js';
import { AutoReloader } from './auto-reload.js';
import { shouldDiscard, type DiscardCandidate } from './memory-saver.js';
import { PagePlacement } from './page-placement.js';
import type { PersistChange, SavedTab, SavedWindow } from './persistence.js';
import { isActivation, mayOpenWindow, opensInPlace, recordBlocked } from './popups.js';
import { captureHistory, createTab, liveContents, savedTab, type RecentPage, type Tab } from './tab.js';
import { TabFreezer } from './tab-freezer.js';
import { answerPausedRequest, needsDebugger, pushOverrides, releaseDebugger, rulesFor } from './tab-overrides.js';
import { observeTab, unobserveTab } from './tab-agent.js';
import { captureReference, captureSelection, highlightSelector, startPicking, type PickSession } from './tab-picker.js';
import type { ReferenceCapture } from '../agent-bridge/reference.js';
import { isDevelopmentHost } from '../../shared/hosts.js';
import type { ElementSelection } from '../agent-bridge/selection.js';
import { episodePreview } from '../agent-bridge/timeline.js';
import { PAGE_TEXT_SCRIPT, PAGE_TEXT_WORLD_ID, parsePageText, type PageText } from '../agent-bridge/page-text.js';
import { playwrightTest } from '../agent-bridge/playwright.js';
import { tabForShortcut, tabListOrder } from './tab-shortcuts.js';
import { TabTranslation } from './tab-translation.js';
import { stepZoom } from './zoom.js';

const MAX_CLOSED_TABS = 20;
const STORAGE_WORLD_ID = 1001;
// Past this the badge reads "99+", so further errors need not re-render the chrome.
const MAX_CONSOLE_ERRORS = 99;
const MAX_PINCH_ZOOM = 3;

type Listen = WebContents['on'];

interface TabManagerOptions {
  window: BaseWindow;
  pagePreload: string;
  pageTheme: string;
  closed: SavedTab[];
  privateWindow: boolean;
  session: Session;
  privateSession: Session;
  onPrivateEnded: () => void;
  freezeBackground: () => boolean;
  onChange: (persist: PersistChange) => void;
  onPageSwipe: (direction: 'back' | 'forward') => void;
  onNewTabSearch: (query: string) => void;
  onRepoPrompt: (action: RepoPromptAction) => void;
  onAnnouncement: (action: AnnouncementAction) => void;
  onFeedback: (action: FeedbackAction) => void;
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
  agentScope: (tab: { url: string; isPrivate: boolean }) => boolean;
  agentTracing: () => boolean;
}

export type DetachedTab = Tab;

type PickOutcome =
  | { status: 'picked'; selection: ElementSelection }
  | { status: 'referenced'; tabId: TabId; reference: ReferenceCapture }
  | { status: 'cancelled' | 'failed' | 'agent-off' | 'not-local' };

export class TabManager {
  private readonly tabs: Tab[] = [];
  private activeId: TabId | null = null;
  private readonly openedPinned = new Map<TabId, TabId | null>();
  private readonly placement = new PagePlacement();
  private readonly autoReloader = new AutoReloader(() => this.tabs);
  private readonly freezer: TabFreezer;
  private readonly translation: TabTranslation;
  private picking: PickSession | null = null;

  constructor(private readonly options: TabManagerOptions) {
    this.freezer = new TabFreezer({
      enabled: () => options.freezeBackground(),
      isActive: (tab) => tab.id === this.activeId,
      hasLiveChild: (tab) => this.tabs.some((item) => item.openerId === tab.id && item.view),
      needsDebugger,
      changed: () => this.changed(),
    });
    this.translation = new TabTranslation({
      settings: () => options.translation(),
      changed: () => this.changed(),
    });
  }

  get activeTabId(): TabId | null {
    return this.activeId;
  }

  get activeUrl(): string {
    return this.active()?.url ?? NEW_TAB_URL;
  }

  get liveCount(): number {
    return this.tabs.filter((tab) => tab.view).length;
  }

  get count(): number {
    return this.tabs.length;
  }

  state(): Pick<BrowserState, 'tabs' | 'listOrder' | 'activeTabId' | 'device' | 'zoom'> {
    const contents = liveContents(this.active());
    return {
      tabs: this.tabs.map((tab) => this.snapshot(tab)),
      listOrder: tabListOrder(this.tabs, this.openedPinned).map((tab) => tab.id),
      activeTabId: this.activeId,
      device: this.placement.deviceFrame(this.active()),
      zoom: contents ? contents.getZoomFactor() : 1,
    };
  }

  snapshotFor(id: TabId | null = this.activeId): TabSnapshot | null {
    const tab = id ? this.find(id) : undefined;
    return tab ? this.snapshot(tab) : null;
  }

  setPageLayout(bounds: Rectangle, newTabCenterOffset: number): void {
    const { placement } = this;
    const current = placement.bounds;
    const boundsChanged =
      bounds.x !== current.x ||
      bounds.y !== current.y ||
      bounds.width !== current.width ||
      bounds.height !== current.height;
    if (!boundsChanged && newTabCenterOffset === placement.newTabCenterOffset) return;
    placement.bounds = bounds;
    placement.newTabCenterOffset = newTabCenterOffset;
    const tab = this.active();
    if (!tab) return;
    // The new tab applies the offset on its own resize, so it has to arrive before the bounds do.
    placement.syncNewTabCenter(tab);
    if (!boundsChanged || !tab.view) return;
    placement.place(tab, tab.view, true);
    if (tab.emulation) this.changed();
  }

  setPageRadius(radius: number): void {
    if (radius === this.placement.radius) return;
    this.placement.radius = radius;
    for (const tab of this.tabs) {
      if (!tab.emulation) tab.view?.setBorderRadius(radius);
    }
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

  open(url = NEW_TAB_URL, { activate = true, isPrivate = this.options.privateWindow } = {}): TabId {
    const upgraded = this.options.upgradeHttp(url);
    const tab = this.createRecord({ url: upgraded ?? url }, isPrivate);
    if (upgraded) tab.upgrade = { https: upgraded, http: url };
    this.insertAfterActive(tab);
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
    if (next.pinnedUrl && !this.openedPinned.has(id)) {
      this.openedPinned.set(id, this.tabs.findLast((tab) => !tab.pinnedUrl)?.id ?? null);
    }
    if (previous && previous.id !== id) {
      previous.inactiveSince = Date.now();
      this.freezer.maybeFreeze(previous);
    }
    const view = this.ensureLive(next);
    this.freezer.unfreeze(next);
    this.placement.syncNewTabCenter(next);
    this.placement.place(next, view);
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
    const neighbor = this.listNeighbor(id);
    if (pinnedUrl) {
      this.openedPinned.delete(id);
      this.unloadPinned(this.tabs[index], pinnedUrl, neighbor);
      return;
    }
    this.reanchorOpenedPinned(id);
    const [tab] = this.tabs.splice(index, 1);

    if (!tab.isPrivate) {
      this.options.closed.push(savedTab(tab));
      if (this.options.closed.length > MAX_CLOSED_TABS) this.options.closed.shift();
    }
    this.destroyView(tab);
    this.autoReloader.sync();
    if (tab.isPrivate && !this.tabs.some((item) => item.isPrivate)) this.options.onPrivateEnded();

    const opener = tab.openerId ? this.find(tab.openerId) : undefined;
    if (this.activeId === id) {
      this.activeId = null;
      if (opener) this.activate(opener.id);
      else if (neighbor) this.activate(neighbor);
      else this.open();
      return;
    }
    if (opener) this.freezer.maybeFreeze(opener);
    this.changed(true);
  }

  private listNeighbor(id: TabId): TabId | null {
    const order = tabListOrder(this.tabs, this.openedPinned);
    const position = order.findIndex((tab) => tab.id === id);
    if (position < 0) return null;
    return (order[position + 1] ?? order[position - 1])?.id ?? null;
  }

  reopenClosed(): void {
    const saved = this.options.closed.pop();
    if (!saved) return;
    const tab = this.createRecord(saved);
    this.insertAfterActive(tab);
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
    tab.history = captureHistory(tab);
    this.destroyView(tab);
    this.changed(true);
    return true;
  }

  discardCandidates(): (DiscardCandidate & { id: TabId })[] {
    const candidates: (DiscardCandidate & { id: TabId })[] = [];
    for (const tab of this.tabs) {
      const contents = liveContents(tab);
      if (!contents) continue;
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

  togglePin(id: TabId): void {
    const tab = this.find(id);
    if (!tab) return;
    if (tab.pinnedUrl) {
      tab.pinnedUrl = null;
      this.openedPinned.delete(id);
      this.freezer.maybeFreeze(tab);
    } else {
      if (tab.isPrivate || !/^https?:/.test(tab.url)) return;
      this.reanchorOpenedPinned(id);
      if (id === this.activeId) this.openedPinned.set(id, this.previousUnpinnedId(id));
      tab.pinnedUrl = tab.url;
      this.freezer.unfreeze(tab);
    }
    this.changed(true);
  }

  private previousUnpinnedId(id: TabId): TabId | null {
    return this.tabs.slice(0, this.indexOf(id)).findLast((tab) => !tab.pinnedUrl)?.id ?? null;
  }

  private reanchorOpenedPinned(id: TabId): void {
    const anchor = this.previousUnpinnedId(id);
    for (const [pinnedId, current] of this.openedPinned) {
      if (current === id) this.openedPinned.set(pinnedId, anchor);
    }
  }

  private unloadPinned(tab: Tab, pinnedUrl: string, neighbor: TabId | null): void {
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
    if (neighbor) this.activate(neighbor);
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
    return liveContents(this.active());
  }

  async restoreViewport(tabId: TabId, contents: WebContents): Promise<void> {
    if (contents.isDestroyed() || !contents.debugger.isAttached()) return;
    const tab = this.tabs.find((entry) => entry.id === tabId);
    if (tab && liveContents(tab) === contents && tab.emulation) {
      const frame = this.placement.deviceFrame(tab)!;
      await applyDeviceMetrics(contents, tab.emulation, frame.scale);
    } else {
      await contents.debugger.sendCommand('Emulation.clearDeviceMetricsOverride');
    }
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
        const contents = liveContents(tab);
        if (contents && tab.url.startsWith(prefix)) contents.reload();
      }
    });
  }

  private openSingle(url: string): void {
    const existing = this.tabs.find((tab) => tab.url.startsWith(url));
    if (existing) this.activate(existing.id);
    else this.open(url);
  }

  goBack(): boolean {
    const history = this.active()?.view?.webContents.navigationHistory;
    if (!history?.canGoBack()) return false;
    history.goBack();
    return true;
  }

  goForward(): boolean {
    const history = this.active()?.view?.webContents.navigationHistory;
    if (!history?.canGoForward()) return false;
    history.goForward();
    return true;
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
    const contents = liveContents(tab);
    if (!tab || !contents) return;
    const previous = tab.overrides;
    const next = { ...previous, ...patch };
    if ((Object.keys(next) as (keyof PageOverrides)[]).every((key) => next[key] === previous[key])) return;
    tab.overrides = next;
    this.changed();
    this.applyOverrides(tab, contents)
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
        this.applyOverrides(tab, contents).catch(() => undefined);
      });
  }

  async pageText(id: TabId, timeoutMs = 2000): Promise<PageText | null> {
    const contents = this.find(id)?.view?.webContents;
    if (!contents || contents.isDestroyed()) return null;
    const read = contents
      .executeJavaScriptInIsolatedWorld(PAGE_TEXT_WORLD_ID, [{ code: PAGE_TEXT_SCRIPT }])
      .then(parsePageText, () => null);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
    return Promise.race([read, timeout]);
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
      const contents = liveContents(tab);
      if ((!tab.overrides.requestRules && !tab.agent) || !contents) continue;
      this.applyOverrides(tab, contents).catch((error: unknown) => {
        console.warn('[request-rules] could not refresh interception:', error);
      });
    }
  }

  private applyOverrides(tab: Tab, contents: WebContents): Promise<void> {
    return pushOverrides(tab, contents, this.options.requestRules(), this.options.agentTracing());
  }

  toggleTranslation(): void {
    const tab = this.active();
    if (tab) this.translation.toggle(tab);
  }

  canTranslateSelection(): boolean {
    return this.translation.canTranslateSelection();
  }

  translateSelection(contents: WebContents): void {
    this.translation.translateSelection(contents);
  }

  setAutoReload(seconds: number | null): void {
    const tab = this.active();
    if (!tab) return;
    tab.autoReload = seconds ? { seconds, dueAt: Date.now() + seconds * 1000 } : null;
    this.freezer.unfreeze(tab);
    this.autoReloader.sync();
    this.changed();
  }

  async captureActive(fullPage: boolean): Promise<{ png: Buffer; title: string; url: string } | null> {
    const tab = this.active();
    const contents = liveContents(tab);
    if (!tab || !contents) return null;
    const { title, url } = tab;
    try {
      const png = fullPage ? await captureFullPage(contents) : (await contents.capturePage()).toPNG();
      return { png, title, url };
    } finally {
      if (fullPage) releaseDebugger(tab, contents);
    }
  }

  stop(): void {
    this.active()?.view?.webContents.stop();
  }

  syncAgent(): void {
    for (const tab of this.tabs) this.syncAgentFor(tab, tab.url);
  }

  observedTabs(): Tab[] {
    return this.tabs.filter((tab) => tab.agent && liveContents(tab));
  }

  observedTab(id: TabId): { tab: Tab; contents: WebContents } | null {
    const tab = this.find(id);
    const contents = liveContents(tab);
    return tab?.agent && contents ? { tab, contents } : null;
  }

  get isPicking(): boolean {
    return this.picking !== null;
  }

  cancelPicking(): void {
    this.picking?.cancel();
  }

  async pickElement(agentOn: boolean): Promise<PickOutcome> {
    const tab = this.active();
    const contents = liveContents(tab);
    if (!tab || !contents) return { status: 'cancelled' };
    if (!tab.agent) {
      if (!agentOn && isDevelopmentUrl(tab.url)) return { status: 'agent-off' };
      return this.pickReference(tab, contents);
    }
    this.picking?.cancel();
    const session = startPicking(contents);
    this.picking = session;
    contents.focus();
    const backendNodeId = await session.result;
    if (this.picking === session) this.picking = null;
    const runtime = tab.agent;
    if (backendNodeId === null || !runtime || contents.isDestroyed()) return { status: 'cancelled' };
    try {
      const selection = await captureSelection(contents, backendNodeId, tab);
      runtime.selections.push(selection);
      return { status: 'picked', selection };
    } catch (error) {
      console.warn(`[picker] could not read the element: ${(error as Error).message}`);
      return { status: 'failed' };
    }
  }

  // Pages outside local development are read once, when the user picks a part of them; the agent gets
  // no access to the tab itself.
  private async pickReference(tab: Tab, contents: WebContents): Promise<PickOutcome> {
    if (tab.isPrivate || !/^https?:/.test(tab.url)) return { status: 'not-local' };
    this.picking?.cancel();
    try {
      attachDebugger(contents);
    } catch {
      return { status: 'failed' };
    }
    const session = startPicking(contents);
    this.picking = session;
    contents.focus();
    try {
      const backendNodeId = await session.result;
      if (backendNodeId === null || contents.isDestroyed()) return { status: 'cancelled' };
      const reference = await captureReference(contents, backendNodeId, { url: tab.url, title: tab.title });
      return { status: 'referenced', tabId: tab.id, reference };
    } catch (error) {
      console.warn(`[picker] could not read the reference: ${(error as Error).message}`);
      return { status: 'failed' };
    } finally {
      if (this.picking === session) this.picking = null;
      if (!contents.isDestroyed()) releaseDebugger(tab, contents);
    }
  }

  async highlightSelection(selectionId: string): Promise<boolean> {
    for (const tab of this.observedTabs()) {
      const selection = [...(tab.agent?.selections.values() ?? [])].find((item) => item.id === selectionId);
      const contents = liveContents(tab);
      if (!selection || !contents) continue;
      this.activate(tab.id);
      return highlightSelector(contents, selection.selector);
    }
    return false;
  }

  async setAgentRules(id: TabId, rules: RequestRule[]): Promise<void> {
    const found = this.observedTab(id);
    if (!found?.tab.agent) return;
    found.tab.agent.rules = rules;
    await this.applyOverrides(found.tab, found.contents);
    this.changed();
  }

  agentPlaywrightTest(episodeId: string): string | null {
    const tab = this.active();
    const episode = tab?.agent?.timeline.episodes.values().find((item) => item.id === episodeId);
    return tab && episode ? playwrightTest(episode, tab.url) : null;
  }

  markAgentRead(id: TabId): void {
    const tab = this.find(id);
    if (!tab) return;
    tab.agentReadAt = Date.now();
    this.changed();
  }

  reloadTab(id: TabId, ignoreCache: boolean): void {
    const tab = this.find(id);
    const contents = liveContents(tab);
    if (!tab || !contents) return;
    this.freezer.unfreeze(tab);
    if (ignoreCache) contents.reloadIgnoringCache();
    else contents.reload();
  }

  // Only same-origin requests get a trace header: on a cross-origin request it would trigger a CORS
  // preflight the backend may refuse.
  private traceHeaders(tab: Tab, paused: PausedRequest): HeaderValue[] {
    if (!tab.agent || !this.options.agentTracing()) return [];
    if (paused.resourceType !== 'Fetch' && paused.resourceType !== 'XHR') return [];
    if (!isSameOrigin(paused.request.url, tab.url)) return [];
    const { traceId, header } = newTraceparent();
    tab.agent.traceRequest(traceId, paused.networkId ?? paused.requestId);
    return [{ name: 'traceparent', value: header }];
  }

  private syncAgentFor(tab: Tab, url: string): void {
    const contents = liveContents(tab);
    if (!contents) return;
    const inScope = this.options.agentScope({ url, isPrivate: tab.isPrivate });
    if (inScope === (tab.agent !== null)) return;
    const done = inScope ? observeTab(tab, contents) : unobserveTab(tab, contents);
    this.changed();
    void done.then(() => this.changed());
  }

  applyDefaultZoom(): void {
    for (const tab of this.tabs) {
      const contents = liveContents(tab);
      if (!contents || this.options.hasOwnZoom(tab.url, tab.isPrivate)) continue;
      contents.setZoomFactor(this.options.defaultZoom());
    }
    const active = this.active();
    if (active) this.placement.syncNewTabCenter(active);
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
    liveContents(this.find(id))?.stopFindInPage('keepSelection');
  }

  applyFreezeSetting(): void {
    for (const tab of this.tabs) {
      if (this.options.freezeBackground()) this.freezer.maybeFreeze(tab);
      else this.freezer.unfreeze(tab);
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
    const tab = tabForShortcut(tabListOrder(this.tabs, this.openedPinned), index);
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
      tabs: kept.map(savedTab),
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
    this.reanchorOpenedPinned(id);
    this.openedPinned.delete(id);
    this.tabs.splice(index, 1);
    this.freezer.unfreeze(tab);
    tab.detachListeners?.();
    tab.detachListeners = null;
    if (tab.view) this.options.window.contentView.removeChildView(tab.view);
    this.options.onHtmlFullScreenChange(tab.id, false);
    this.autoReloader.sync();
    if (this.activeId === id) {
      this.activeId = null;
      this.activate(this.tabs[Math.min(index, this.tabs.length - 1)].id);
    } else {
      this.changed(true);
    }
    return tab;
  }

  adopt(tab: DetachedTab): void {
    this.insertAfterActive(tab);
    if (tab.view) this.attachListeners(tab, tab.view);
    this.autoReloader.sync();
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
    this.autoReloader.sync();
  }

  private createRecord(saved: Partial<SavedTab> & { url: string }, isPrivate = false): Tab {
    return createTab(saved, isPrivate);
  }

  private insertAfterActive(tab: Tab): void {
    const index = this.activeId ? this.indexOf(this.activeId) + 1 : this.tabs.length;
    this.tabs.splice(index, 0, tab);
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
    const emulated = this.mount(tab, view);
    if (emulated) {
      void emulated.then(() => {
        if (tab.view === view) this.load(tab, view);
      });
    } else {
      this.load(tab, view);
    }
    return view;
  }

  private mount(tab: Tab, view: WebContentsView): Promise<void> | null {
    view.setBackgroundColor(tab.url === NEW_TAB_URL ? '#00000000' : '#ffffff');
    if (tab.muted) view.webContents.setAudioMuted(true);
    tab.view = view;
    this.attachListeners(tab, view);
    this.syncAgentFor(tab, tab.url);
    return this.placement.place(tab, view);
  }

  // Sign-in popups (Google and other OAuth providers) report back through window.opener,
  // so the tab must host the contents Chromium created for the popup instead of a fresh load.
  // Electron omits the contents for noopener popups, so those get a regular view.
  private openChild(url: string, opener: Tab, webContents: WebContents | undefined): WebContents {
    const tab = this.createRecord({ url }, opener.isPrivate);
    tab.openerId = opener.id;
    this.insertAfterActive(tab);
    let view: WebContentsView;
    if (webContents) {
      view = new WebContentsView({ webContents });
      this.mount(tab, view);
    } else {
      view = this.ensureLive(tab);
    }
    this.activate(tab.id);
    return view.webContents;
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
    this.placement.syncNewTabCenter(tab);
    this.options.onZoom(contents.getURL(), factor, tab.isPrivate);
    this.changed();
  }

  private updateDeviceMetrics(tab: Tab, emulation: Emulation): void {
    if (emulation === tab.emulation) return;
    tab.emulation = emulation;
    if (tab.view) void this.placement.place(tab, tab.view, true);
    this.changed();
  }

  private setEmulation(tab: Tab, emulation: Emulation | null): void {
    const wasEmulated = tab.emulation !== null;
    tab.emulation = emulation;
    this.placement.syncNewTabCenter(tab);
    const view = tab.view;
    if (view) {
      const applied = emulation ? this.placement.place(tab, view) : this.placement.clearDevice(tab, view);
      void (applied ?? Promise.resolve()).then(async () => {
        const contents = view.webContents;
        // Device changes reset the user agent, so the tab's own overrides go back on top.
        if (hasOverrides(tab.overrides) && tab.view === view && !contents.isDestroyed()) {
          await this.applyOverrides(tab, contents).catch((error: unknown) => {
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

  private attachListeners(tab: Tab, view: WebContentsView): void {
    const contents = view.webContents;
    const disposers: (() => void)[] = [];
    const listen = ((event: string, listener: (...args: never[]) => void) => {
      contents.on(event as never, listener);
      disposers.push(() => contents.off(event as never, listener));
      return contents;
    }) as unknown as Listen;
    tab.detachListeners = () => {
      for (const dispose of disposers) dispose();
    };
    // Registration order matters where several listeners share an event, so the groups run in sequence.
    this.listenForInput(tab, view, listen);
    this.listenForPageChrome(tab, view, listen);
    this.listenForWindowRequests(tab, contents, listen);
    this.listenForPageState(tab, view, listen);
    this.listenForLoads(tab, view, listen, disposers);
  }

  private listenForInput(tab: Tab, view: WebContentsView, listen: Listen): void {
    const contents = view.webContents;
    listen('before-input-event', (_event, input) => {
      const modifier = input.control || input.meta || input.alt || input.shift;
      if (input.type === 'keyDown' && input.key === 'Escape' && !modifier && tab.loading) contents.stop();
    });

    // A page-level wheel listener for pinch would make every scroll wait for the page's main thread,
    // so pinch uses Chromium's own visual zoom. A new renderer after navigation starts at the defaults.
    const allowPinch = () => void contents.setVisualZoomLevelLimits(1, MAX_PINCH_ZOOM).catch(() => {});
    allowPinch();
    listen('did-navigate', allowPinch);

    listen('ipc-message', (event, channel, direction) => {
      if (channel !== PageChannel.swipe || event.senderFrame !== contents.mainFrame || tab.id !== this.activeId) return;
      if (direction === 'back' || direction === 'forward') this.options.onPageSwipe(direction);
    });

    listen('ipc-message-sync', (event, channel) => {
      if (channel !== PageChannel.newTabCenter) return;
      event.returnValue =
        event.senderFrame === contents.mainFrame ? this.placement.newTabCenter(tab) : { offset: 0, width: null };
    });

    listen('zoom-changed', (_event, direction) => this.zoomView(tab, view, direction === 'in' ? 1 : -1));
  }

  private listenForPageChrome(tab: Tab, view: WebContentsView, listen: Listen): void {
    const contents = view.webContents;
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
  }

  private listenForWindowRequests(tab: Tab, contents: WebContents, listen: Listen): void {
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
        if (opensInPlace(url) && !this.options.upgradeHttp(url)) {
          return {
            action: 'allow',
            outlivesOpener: true,
            // Electron passes the popup's contents in the options, though its typings omit them.
            createWindow: (options) => this.openChild(url, tab, (options as { webContents?: WebContents }).webContents),
          };
        }
        this.open(url, { isPrivate: tab.isPrivate });
        return { action: 'deny' };
      }
      tab.blockedPopups = recordBlocked(tab.blockedPopups, url);
      this.changed();
      return { action: 'deny' };
    });
  }

  private listenForPageState(tab: Tab, view: WebContentsView, listen: Listen): void {
    const contents = view.webContents;
    listen('destroyed', () => {
      setImmediate(() => {
        if (tab.view !== view || this.find(tab.id) !== tab) return;
        // The listeners went away with the contents; removing them would touch the destroyed debugger.
        tab.detachListeners = null;
        this.destroyView(tab);
        this.close(tab.id);
      });
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
      // A navigation that started but never committed (a download, an abort) leaves the page where it was.
      this.syncAgentFor(tab, tab.url);
      this.options.onVisitTitle(tab.visitId, contents.getTitle());
      this.freezer.maybeFreeze(tab);
      this.changed();
    });
    listen('audio-state-changed', ({ audible }) => {
      if (!audible) this.freezer.maybeFreeze(tab);
      this.changed();
    });
    listen('devtools-closed', () => this.freezer.maybeFreeze(tab));
    listen('did-start-navigation', ({ url, isMainFrame, isSameDocument }) => {
      if (!isMainFrame || isSameDocument) return;
      const userAgent = signInUserAgent(url, process.platform) ?? contents.session.getUserAgent();
      if (contents.getUserAgent() !== userAgent) contents.setUserAgent(userAgent);
      this.syncAgentFor(tab, url);
      const hadTranslationState = tab.translation !== 'idle' || tab.pageLanguage !== null;
      this.translation.reset(tab);
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
  }

  private listenForLoads(tab: Tab, view: WebContentsView, listen: Listen, disposers: (() => void)[]): void {
    const contents = view.webContents;
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
      if (tab.view !== view || !needsDebugger(tab) || contents.isDestroyed()) return;
      tab.emulation = null;
      tab.overrides = NO_OVERRIDES;
      tab.agent = null;
      this.placement.place(tab, view);
      this.changed();
    };
    contents.debugger.on('detach', onDebuggerDetach);
    disposers.push(() => contents.debugger.off('detach', onDebuggerDetach));
    const onDebuggerMessage = (_event: Electron.Event, method: string, params: unknown) => {
      tab.agent?.handle(method, params);
      if (method !== 'Fetch.requestPaused' || contents.isDestroyed()) return;
      const paused = params as PausedRequest;
      answerPausedRequest(contents, rulesFor(tab, this.options.requestRules()), paused, this.traceHeaders(tab, paused));
    };
    contents.debugger.on('message', onDebuggerMessage);
    disposers.push(() => contents.debugger.off('message', onDebuggerMessage));
    listen('did-redirect-navigation', ({ url, isMainFrame }) => {
      if (isMainFrame) this.syncAgentFor(tab, url);
    });
    listen('did-navigate', () => {
      updateUrl(true);
      this.syncAgentFor(tab, tab.url);
      tab.agent?.timeline.navigation(tab.url);
    });
    let failure: string | null = null;
    listen('did-fail-load', (_event, code, name, url, isMainFrame) => {
      if (!isMainFrame || code === ERR_ABORTED) return;
      const upgrade = tab.upgrade;
      if (upgrade && withoutHash(url) === withoutHash(upgrade.https)) {
        const token = this.options.httpsOnlyWarning(upgrade.https, upgrade.http);
        failure = errorPageScript(this.options.pageTheme, code, name, url, `${PROCEED_HTTP_URL}${token}`, true);
      } else {
        const token = isCertificateError(code) ? this.options.certificateToken(url) : null;
        failure = errorPageScript(this.options.pageTheme, code, name, url, token ? `${PROCEED_URL}${token}` : null);
      }
      tab.url = url;
      tab.failed = true;
      tab.visitId = null;
      this.changed(true);
    });
    listen('did-finish-load', () => {
      this.placement.syncNewTabCenter(tab);
      this.translation.detectLanguage(tab, contents);
      if (!failure) return;
      const script = failure;
      failure = null;
      void contents.executeJavaScript(script).catch(() => {});
    });
    listen('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) updateUrl(!isSameVisit(tab.url, url));
    });
    listen('render-process-gone', () => {
      tab.history = captureHistory(tab);
      setImmediate(() => {
        if (tab.view !== view || this.find(tab.id) !== tab) return;
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
      case 'new-tab-repo':
        this.options.onRepoPrompt(navigation.action);
        if (navigation.action === 'star') void contents.loadURL(REPO_URL);
        else contents.reload();
        return;
      case 'new-tab-announcement':
        this.options.onAnnouncement(navigation.action);
        contents.reload();
        return;
      case 'new-tab-feedback':
        this.options.onFeedback(navigation.action);
        if (navigation.action === 'open') void contents.loadURL(FEEDBACK_URL);
        else contents.reload();
        return;
    }
  }

  private destroyView(tab: Tab): void {
    const view = tab.view;
    if (!view) return;
    tab.detachListeners?.();
    tab.detachListeners = null;
    this.options.onHtmlFullScreenChange(tab.id, false);
    tab.view = null;
    tab.loading = false;
    tab.frozen = false;
    tab.overrides = NO_OVERRIDES;
    tab.agent = null;
    this.translation.reset(tab);
    this.options.window.contentView.removeChildView(view);
    // A view drops its contents once a page closes itself, despite the typings.
    const contents = view.webContents as WebContents | undefined;
    if (contents && !contents.isDestroyed()) contents.close();
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
      translation: { status: tab.translation, available: this.translation.available(tab) },
      autoReloadSeconds: tab.autoReload?.seconds ?? null,
      audible: tab.view !== null && !tab.view.webContents.isDestroyed() && tab.view.webContents.isCurrentlyAudible(),
      muted: tab.muted,
      canGoBack: history?.canGoBack() ?? false,
      canGoForward: history?.canGoForward() ?? false,
      agentObserved: tab.agent !== null,
      agentReadAt: tab.agentReadAt,
      agentEpisode: episodePreview(tab.agent?.timeline.latestEpisode ?? null),
      agentRules: tab.agent?.rules.length ?? 0,
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

function isSameOrigin(url: string, pageUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}

function isDevelopmentUrl(url: string): boolean {
  try {
    return isDevelopmentHost(new URL(url).hostname);
  } catch {
    return false;
  }
}
