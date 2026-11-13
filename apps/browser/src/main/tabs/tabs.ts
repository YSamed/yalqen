import {
  WebContentsView,
  type BaseWindow,
  type ContextMenuParams,
  type Rectangle,
  type Session,
  type WebContents,
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
import { authRedirectExtension } from '../../shared/extension-bridge.js';
import { unreadCount } from '../../shared/unread.js';
import { leavesPinnedSite } from './pinned-home.js';
import { previewKind } from '../../shared/previews.js';
import { PREVIEW_WORLD_ID, type PreviewTab } from './previews.js';
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
import { PROCEED_THREAT_URL, type ThreatGuard } from '../privacy/threat-guard.js';
import { t } from '../../shared/i18n.js';
import {
  internalNavigation,
  isAllowedFrom,
  type AnnouncementAction,
  type FeedbackAction,
  type UpdateCardAction,
  type InternalNavigation,
} from '../pages/internal-navigation.js';
import { PROCEED_URL } from '../privacy/certificates.js';
import { PROCEED_HTTP_URL } from '../privacy/https-only.js';
import { MEASURE_STORAGE_SCRIPT, parseStorageUsage, type StorageUsage } from '../privacy/site-data.js';
import { securityState } from '../privacy/site-info.js';
import { shouldArchive } from './auto-archive.js';
import { AutoReloader } from './auto-reload.js';
import { shouldDiscard, type DiscardCandidate } from './memory-saver.js';
import { PagePlacement, SPLIT_GAP, type PaneSlot } from './page-placement.js';
import type { PersistChange, SavedGroups, SavedTab, SavedWindow } from './persistence.js';
import { isActivation, mayOpenWindow, opensInPlace, opensPeek, recordBlocked } from './popups.js';
import { captureHistory, createTab, liveContents, savedTab, type RecentPage, type Tab } from './tab.js';
import { checkBeforeUnload } from './before-unload.js';
import { keepsPlaying, TabFreezer } from './tab-freezer.js';
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
import { READING_LIST_URL } from '../../shared/reading-list.js';
import type { MediaInfo, MediaSkip } from '../../shared/sidebar-widgets.js';
import {
  MEDIA_READ_SCRIPT,
  MEDIA_TOGGLE_SCRIPT,
  MEDIA_WORLD_ID,
  PIP_ENTER_SCRIPT,
  PIP_EXIT_SCRIPT,
  pipSwitch,
  mediaSeekScript,
  mediaSkipScript,
  parsePageMedia,
  type PageMedia,
} from './media.js';
import {
  canNestGroup,
  groupAncestors,
  groupOrder,
  parseGroupParents,
  pruneGroupParents,
  tabGroupName,
  type TabGroup,
} from '../../shared/tab-groups.js';
import { DEFAULT_SPACE_ID, WORKSPACES_URL } from '../../shared/workspaces.js';
import { BOOSTS_URL } from '../../shared/boosts.js';
import { EASELS_URL } from '../../shared/easels.js';
import { boostOrigin } from '../library/boosts.js';
import { webAppContains } from '../../shared/web-apps.js';
import { bulkCloseTargets, type BulkCloseMode } from './bulk-tabs.js';
import { selectTabIds, moveTabSelection, type TabSelectionMode } from '../../shared/tab-selection.js';
import { TabTranslation } from './tab-translation.js';
import { certificateChainFor, type CertificateDetails } from '../privacy/certificate-details.js';
import { stepZoom } from './zoom.js';
import { MAX_CLOSED_TABS } from './closed-tabs.js';

const STORAGE_WORLD_ID = 1001;
const MAX_PINCH_ZOOM = 3;

type Listen = WebContents['on'];

interface TabManagerOptions {
  window: BaseWindow;
  pagePreload: string;
  pageTheme: string;
  closed: SavedTab[];
  onClosedChanged?: () => void;
  privateWindow: boolean;
  session: Session;
  privateSession: Session;
  onPrivateEnded: () => void;
  freezeBackground: () => boolean;
  // "Keep pinned tabs on their site": pinned tabs load at their pinned address and send other sites to new tabs.
  pinnedTabsStayHome?: () => boolean;
  pictureInPicture?: () => boolean;
  onChange: (persist: PersistChange) => void;
  spaceIds?: () => string[];
  spaceSeed?: (id: string) => SavedWindow | null;
  onPageSwipe: (direction: 'back' | 'forward') => void;
  onNewTabSearch: (query: string) => void;
  onRepoPrompt: (action: RepoPromptAction) => void;
  onAnnouncement: (action: AnnouncementAction) => void;
  onFeedback: (action: FeedbackAction) => void;
  onUpdateCard: (action: UpdateCardAction) => void;
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
  onPeek: (url: string, isPrivate: boolean) => void;
  requestRules: () => readonly RequestRule[];
  translation: () => { enabled: boolean; language: PageLanguage };
  agentScope: (tab: { url: string; isPrivate: boolean }) => boolean;
  agentTracing: () => boolean;
  confirmUnload: (tab: Tab) => boolean;
  threatGuard?: ThreatGuard;
  webAppScope?: string;
  onAppExternal?(url: string): void;
}

export type DetachedTab = Tab;

export function createPageView(preload: string, session: Session): WebContentsView {
  return new WebContentsView({
    webPreferences: { preload, session, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
}

interface GroupState {
  collapsed: Set<string>;
  parents: Map<string, string>;
}

export const MAX_SPLIT_PANES = 4;
export type SplitSide = 'left' | 'right';

export type PageReader<T> = (contents: WebContents, backendNodeId: number, view: Rectangle) => Promise<T>;

export type PagePick<T> =
  { status: 'picked'; url: string; value: T } | { status: 'cancelled' | 'failed' | 'unavailable' };

type PickOutcome =
  | { status: 'picked'; selection: ElementSelection }
  | { status: 'referenced'; tabId: TabId; reference: ReferenceCapture }
  | { status: 'cancelled' | 'failed' | 'agent-off' | 'not-local' };

export class TabManager {
  private readonly tabs: Tab[] = [];
  private activeId: TabId | null = null;
  private readonly openedPinned = new Map<TabId, TabId | null>();
  private readonly favoriteTabs = new Map<string, TabId>();
  private space = DEFAULT_SPACE_ID;
  private readonly seeded = new Set([DEFAULT_SPACE_ID]);
  private readonly spaceActive = new Map<string, TabId>();
  private readonly groupStates = new Map<string, GroupState>();
  private readonly placement = new PagePlacement((tab) => this.slotOf(tab));
  private readonly splits: TabId[][] = [];
  private shown: Tab[] = [];
  private fullScreenId: TabId | null = null;
  private splitPreview: SplitSide | null = null;
  private readonly autoReloader = new AutoReloader(() => this.tabs);
  private readonly freezer: TabFreezer;
  private readonly translation: TabTranslation;
  private picking: PickSession | null = null;
  private readonly closing = new Set<TabId>();
  private media: { tabId: TabId; info: PageMedia | null; updatedAt: number } | null = null;
  private readonly navigations = new WeakMap<Tab, number>();
  private selected = new Set<TabId>();
  private selectionAnchor: TabId | null = null;

  constructor(private readonly options: TabManagerOptions) {
    this.freezer = new TabFreezer({
      enabled: () => options.freezeBackground(),
      isActive: (tab) => this.isVisible(tab),
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

  get tabIds(): Set<TabId> {
    return new Set(this.tabs.map((tab) => tab.id));
  }

  private get here(): Tab[] {
    return this.tabs.filter((tab) => tab.space === this.space);
  }

  private get groups(): GroupState {
    let state = this.groupStates.get(this.space);
    if (!state) this.groupStates.set(this.space, (state = { collapsed: new Set(), parents: new Map() }));
    return state;
  }

  private get collapsedGroups(): Set<string> {
    return this.groups.collapsed;
  }

  private get groupParents(): Map<string, string> {
    return this.groups.parents;
  }

  private set groupParents(parents: Map<string, string>) {
    this.groups.parents = parents;
  }

  get activeSpaceId(): string {
    return this.space;
  }

  private spaceIds(): string[] {
    return [DEFAULT_SPACE_ID, ...(this.options.spaceIds?.() ?? [])];
  }

  switchSpace(id: string): void {
    if (id === this.space || !this.spaceIds().includes(id)) return;
    this.enterSpace(id);
    const remembered = this.spaceActive.get(id);
    const target = this.here.find((tab) => tab.id === remembered) ?? this.listOrder()[0];
    if (target) {
      this.activate(target.id);
    } else {
      this.activeId = null;
      this.open();
    }
  }

  switchSpaceByIndex(index: number): void {
    const id = this.spaceIds()[index];
    if (id !== undefined) this.switchSpace(id);
  }

  syncSpaces(): void {
    const ids = this.spaceIds();
    for (const tab of this.tabs) if (!ids.includes(tab.space)) tab.space = DEFAULT_SPACE_ID;
    if (!ids.includes(this.space)) this.space = DEFAULT_SPACE_ID;
    for (const state of [this.groupStates, this.spaceActive])
      for (const id of state.keys()) if (!ids.includes(id)) state.delete(id);
    for (const id of this.seeded) if (!ids.includes(id)) this.seeded.delete(id);
    this.changed(true);
  }

  private enterSpace(id: string): void {
    if (id === this.space) return;
    if (this.activeId) this.spaceActive.set(this.space, this.activeId);
    this.space = id;
    this.selected.clear();
    this.selectionAnchor = null;
    if (this.seeded.has(id)) return;
    this.seeded.add(id);
    const seed = this.options.spaceSeed?.(id);
    if (!seed?.tabs.length) return;
    this.loadGroups(id, seed);
    const added = seed.tabs.map((saved) => this.createRecord({ ...saved, space: id }));
    this.tabs.push(...added);
    const first = added.find((tab) => tab.id === seed.activeTabId) ?? added[0];
    this.spaceActive.set(id, first.id);
  }

  private loadGroups(space: string, saved: SavedGroups): void {
    const collapsed = new Set<string>();
    if (Array.isArray(saved.collapsedGroups))
      for (const name of saved.collapsedGroups.slice(0, 50)) {
        const valid = tabGroupName(name);
        if (valid) collapsed.add(valid);
      }
    this.groupStates.set(space, { collapsed, parents: parseGroupParents(saved.groupParents) });
  }

  state(): Pick<
    BrowserState,
    | 'tabs'
    | 'listOrder'
    | 'activeTabId'
    | 'selectedTabIds'
    | 'splitTabIds'
    | 'tabGroups'
    | 'device'
    | 'zoom'
    | 'devToolsDivider'
  > & { activeSpaceId: string } {
    const contents = liveContents(this.active());
    return {
      activeSpaceId: this.space,
      tabs: this.here.map((tab) => this.snapshot(tab)),
      listOrder: this.listOrder().map((tab) => tab.id),
      activeTabId: this.activeId,
      selectedTabIds: this.selectedTabIds,
      splitTabIds: this.splits.flat(),
      tabGroups: this.groupView(),
      device: this.placement.deviceFrame(this.active()),
      devToolsDivider: this.devToolsDivider,
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
    for (const tab of this.shown) {
      // The new tab applies the offset on its own resize, so it has to arrive before the bounds do.
      placement.syncNewTabCenter(tab);
      if (boundsChanged && tab.view) placement.place(tab, tab.view, true);
    }
    if (boundsChanged && this.shown.some((tab) => tab.emulation)) this.changed();
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

  open(url = NEW_TAB_URL, { activate = true, isPrivate = this.options.privateWindow, space = this.space } = {}): TabId {
    if (this.routeAppNavigation(null, url)) return this.activeId ?? '';
    const upgraded = this.options.upgradeHttp(url);
    const tab = this.createRecord({ url: upgraded ?? url }, isPrivate);
    tab.space = this.spaceIds().includes(space) ? space : this.space;
    tab.group = tab.space === this.space ? (this.active()?.group ?? null) : null;
    if (upgraded) tab.upgrade = { https: upgraded, http: url };
    this.tabs.push(tab);
    if (activate) {
      this.activate(tab.id);
    } else {
      this.ensureLive(tab);
      this.changed(true);
    }
    return tab.id;
  }

  activate(id: TabId, animate = false): void {
    const next = this.find(id);
    if (!next) return;
    if (!this.spaceIds().includes(next.space)) next.space = DEFAULT_SPACE_ID;
    this.enterSpace(next.space);
    if (next.group) this.expandGroup(next.group);
    this.selected.clear();
    this.selectionAnchor = id;

    const previous = this.active();
    if (previous === next && next.view) {
      if (next.url !== 'about:blank') next.view.webContents.focus();
      this.changed();
      return;
    }
    if (previous && next.view && this.shown.includes(next) && this.splitOf(previous.id)?.includes(id)) {
      this.activeId = id;
      if (next.url !== 'about:blank') next.view.webContents.focus();
      this.changed();
      return;
    }

    this.activeId = id;
    this.switchPip(previous, next);
    if (next.pinnedUrl && !this.openedPinned.has(id)) {
      this.openedPinned.set(id, this.here.findLast((tab) => !tab.pinnedUrl)?.id ?? null);
    }
    const wasLive = next.view !== null;
    this.showVisible();
    const view = next.view!;
    if (next.url !== 'about:blank') view.webContents.focus();
    // Never wait for a load, screenshot or animation before the page can receive input.
    if (wasLive) view.webContents.send(PageChannel.tabTransition, animate ? Date.now() : null);
    this.changed(true);
  }

  get splitTabIds(): TabId[] {
    return this.splits.flat();
  }

  isShown(id: TabId): boolean {
    return this.shown.some((tab) => tab.id === id);
  }

  canSplitWithActive(id: TabId): boolean {
    const active = this.activeId;
    if (!active || active === id || !this.find(id)) return false;
    const split = this.splitOf(active) ?? [active];
    return !split.includes(id) && split.length < MAX_SPLIT_PANES;
  }

  splitWithActive(id: TabId, side: unknown = 'right'): void {
    if (!this.activeId || !this.canSplitWithActive(id)) return;
    const current = this.splitOf(this.activeId) ?? [this.activeId];
    this.splitPreview = null;
    this.split(side === 'left' ? [id, ...current] : [...current, id], true);
  }

  // Makes room beside the visible panes while a tab is dragged over the page.
  previewSplit(id: TabId | null, side: unknown): void {
    const next = id && this.canSplitWithActive(id) ? (side === 'left' ? 'left' : 'right') : null;
    if (next === this.splitPreview) return;
    this.splitPreview = next;
    for (const tab of this.shown) if (tab.view) void this.placement.place(tab, tab.view, true);
  }

  splitSelected(): void {
    this.split(this.selectedTabIds);
  }

  split(ids: readonly TabId[], keepOrder = false): void {
    const members = new Set(ids.filter((id) => this.find(id)));
    if (members.size < 2 || members.size > MAX_SPLIT_PANES) return;
    for (const id of members) this.leaveSplit(id);
    const ordered = keepOrder
      ? [...members]
      : this.listOrder()
          .map((tab) => tab.id)
          .filter((id) => members.has(id));
    this.splits.push(ordered);
    if (this.activeId && members.has(this.activeId)) {
      this.selected.clear();
      this.showVisible();
      this.changed(true);
    } else {
      this.activate(ordered[0]);
    }
  }

  unsplit(id: TabId): void {
    const split = this.splitOf(id);
    if (!split) return;
    this.splits.splice(this.splits.indexOf(split), 1);
    this.showVisible();
    this.changed(true);
  }

  private splitOf(id: TabId | null): TabId[] | undefined {
    return id ? this.splits.find((split) => split.includes(id)) : undefined;
  }

  // Returns a remaining member so a closing pane can hand focus to its neighbor.
  private leaveSplit(id: TabId): TabId | null {
    const split = this.splitOf(id);
    if (!split) return null;
    split.splice(split.indexOf(id), 1);
    if (split.length < 2) this.splits.splice(this.splits.indexOf(split), 1);
    return split[0] ?? null;
  }

  private visibleIds(): TabId[] {
    const active = this.activeId;
    if (!active) return [];
    const split = this.splitOf(active);
    return split && this.fullScreenId !== active ? split : [active];
  }

  private isVisible(tab: Tab): boolean {
    return this.visibleIds().includes(tab.id);
  }

  private slotOf(tab: Tab): PaneSlot | null {
    const visible = this.visibleIds();
    const index = visible.indexOf(tab.id);
    const preview = this.splitPreview;
    const count = visible.length + (preview ? 1 : 0);
    return count > 1 && index >= 0 ? { index: index + (preview === 'left' ? 1 : 0), count } : null;
  }

  private showVisible(): void {
    const next = this.visibleIds().flatMap((id) => this.find(id) ?? []);
    for (const tab of this.shown) {
      if (next.includes(tab) || !tab.view) continue;
      tab.view.webContents.send(PageChannel.tabTransition, null);
      this.options.window.contentView.removeChildView(tab.view);
      if (tab.devTools) this.options.window.contentView.removeChildView(tab.devTools);
      tab.inactiveSince = Date.now();
      this.freezer.maybeFreeze(tab);
    }
    for (const tab of next) {
      const view = this.ensureLive(tab);
      this.freezer.unfreeze(tab);
      this.placement.syncNewTabCenter(tab);
      this.placement.place(tab, view);
      if (!this.shown.includes(tab)) {
        this.options.window.contentView.addChildView(view);
        if (tab.devToolsShown && tab.devTools) this.options.window.contentView.addChildView(tab.devTools);
      }
    }
    this.shown = next;
  }

  focusActive(): boolean {
    const tab = this.active();
    if (!tab?.view || tab.url === 'about:blank') return false;
    tab.view.webContents.focus();
    return true;
  }

  close(id: TabId): void {
    const tab = this.find(id);
    if (!tab || this.closing.has(id)) return;
    if (!liveContents(tab)) {
      this.closeApproved(id);
      return;
    }
    this.closing.add(id);
    void this.confirmClose(tab).then((allowed) => {
      this.closing.delete(id);
      if (allowed && this.find(id) === tab) this.closeApproved(id);
    });
  }

  get selectedTabIds(): TabId[] {
    return this.selectionOrder()
      .filter((tab) => this.selected.has(tab.id))
      .map((tab) => tab.id);
  }

  private selectionOrder(): Tab[] {
    const ordered = this.listOrder();
    const seen = new Set(ordered.map((tab) => tab.id));
    return [...this.here.filter((tab) => tab.pinnedUrl && !seen.has(tab.id)), ...ordered];
  }

  selectTab(id: TabId, mode: TabSelectionMode): void {
    if (!this.find(id) || !['toggle', 'range'].includes(mode)) return;
    const next = selectTabIds(
      this.selectionOrder().map((tab) => tab.id),
      this.selectedTabIds,
      this.selectionAnchor,
      this.activeId,
      id,
      mode,
    );
    this.selected = new Set(next.ids);
    this.selectionAnchor = next.anchor;
    this.changed();
  }

  clearSelection(): void {
    this.selected.clear();
    this.selectionAnchor = this.activeId;
    this.changed();
  }

  toggleSelectedMute(): void {
    const selected = this.tabs.filter((tab) => this.selected.has(tab.id));
    const muted = !selected.every((tab) => tab.muted);
    for (const tab of selected) {
      tab.muted = muted;
      liveContents(tab)?.setAudioMuted(muted);
    }
    this.changed();
  }

  private listOrder(): Tab[] {
    return tabListOrder(this.here, this.openedPinned, this.liveParents());
  }

  private liveParents(): Map<string, string> {
    this.groupParents = pruneGroupParents(this.groupParents, this.usedGroups());
    return this.groupParents;
  }

  private usedGroups(tabs: readonly Tab[] = this.here): string[] {
    return tabs.flatMap((tab) => (tab.group ? [tab.group] : []));
  }

  private hasGroup(name: string): boolean {
    return groupOrder(this.usedGroups(), this.liveParents()).includes(name);
  }

  private expandGroup(name: string): void {
    for (const group of [name, ...groupAncestors(this.groupParents, name)]) this.collapsedGroups.delete(group);
  }

  groupView(): TabGroup[] {
    const counts = new Map<string, number>();
    for (const name of this.usedGroups()) counts.set(name, (counts.get(name) ?? 0) + 1);
    const parents = this.liveParents();
    return groupOrder(counts.keys(), parents).map((name) => ({
      name,
      count: counts.get(name) ?? 0,
      collapsed: this.collapsedGroups.has(name),
      parent: parents.get(name) ?? null,
    }));
  }

  setSelectedGroup(value: unknown): boolean {
    return this.setGroup(this.selected.size ? this.selected : new Set(this.activeId ? [this.activeId] : []), value);
  }

  setTabGroup(id: TabId, value: unknown): boolean {
    return this.setGroup(this.selected.has(id) ? this.selected : new Set([id]), value);
  }

  private setGroup(ids: ReadonlySet<TabId>, value: unknown): boolean {
    const name = value === null ? null : tabGroupName(value);
    if (value !== null && !name) return false;
    if (name && !this.hasGroup(name) && this.groupView().length >= 50) return false;
    let changed = false;
    for (const tab of this.tabs)
      if (ids.has(tab.id)) {
        tab.group = name;
        changed = true;
      }
    if (!changed) return false;
    if (name) this.expandGroup(name);
    this.changed(true);
    return true;
  }

  newGroupName(base: string): string {
    const taken = new Set(this.groupView().map((group) => group.name));
    for (let n = 1; ; n++) {
      const name = n === 1 ? base : `${base} ${n}`;
      if (!taken.has(name)) return name;
    }
  }

  groupTargets(name: string): string[] {
    const parents = this.liveParents();
    return this.groupView().flatMap((group) =>
      group.name !== name && group.name !== parents.get(name) && canNestGroup(parents, name, group.name)
        ? [group.name]
        : [],
    );
  }

  moveGroup(value: unknown, parentValue: unknown): boolean {
    const name = tabGroupName(value),
      parent = parentValue === null ? null : tabGroupName(parentValue);
    if (!name || !this.hasGroup(name) || (parentValue !== null && !(parent && this.hasGroup(parent)))) return false;
    if (!canNestGroup(this.groupParents, name, parent)) return false;
    if (parent === null) this.groupParents.delete(name);
    else {
      this.groupParents.set(name, parent);
      this.expandGroup(parent);
    }
    this.changed(true);
    return true;
  }

  renameGroup(value: unknown, nextValue: unknown): boolean {
    const name = tabGroupName(value),
      next = tabGroupName(nextValue);
    if (!name || !next || !this.hasGroup(name) || (name !== next && this.hasGroup(next))) return false;
    for (const tab of this.here) if (tab.group === name) tab.group = next;
    const rename = (group: string) => (group === name ? next : group);
    this.groupParents = new Map([...this.groupParents].map(([child, parent]) => [rename(child), rename(parent)]));
    if (this.collapsedGroups.delete(name)) this.collapsedGroups.add(next);
    this.changed(true);
    return true;
  }

  toggleGroup(value: unknown): void {
    const name = tabGroupName(value);
    if (!name || !this.hasGroup(name)) return;
    if (!this.collapsedGroups.delete(name)) this.collapsedGroups.add(name);
    this.changed(true);
  }

  removeGroup(value: unknown): void {
    const name = tabGroupName(value);
    if (!name) return;
    const parent = this.liveParents().get(name) ?? null;
    for (const tab of this.here) if (tab.group === name) tab.group = parent;
    this.groupParents.delete(name);
    for (const [child, owner] of this.groupParents)
      if (owner === name) {
        if (parent) this.groupParents.set(child, parent);
        else this.groupParents.delete(child);
      }
    this.collapsedGroups.delete(name);
    this.changed(true);
  }

  toggleSelectedPin(): void {
    const selected = this.tabs.filter((tab) => this.selected.has(tab.id));
    const pin = !selected.every((tab) => tab.pinnedUrl);
    for (const tab of selected) {
      if (!!tab.pinnedUrl !== pin && (tab.pinnedUrl || (!tab.isPrivate && /^https?:/.test(tab.url))))
        this.togglePin(tab.id);
    }
  }

  async closeSelected(): Promise<boolean> {
    const targets = this.selectionOrder().filter((tab) => this.selected.has(tab.id));
    return this.closeGroup(targets, undefined, () => {
      const current = this.selectionOrder().filter((tab) => this.selected.has(tab.id));
      return current.length === targets.length && current.every((tab, index) => tab === targets[index]);
    });
  }

  // Unpinned tabs in this space that memory saving has unloaded, the ones the sidebar dims.
  private idleTabs(): Tab[] {
    return this.listOrder().filter(
      (tab) => !tab.pinnedUrl && !tab.isPrivate && tab.view === null && tab.id !== this.activeId,
    );
  }

  async closeIdle(): Promise<boolean> {
    const targets = this.idleTabs();
    return this.closeGroup(targets, undefined, () => {
      const current = this.idleTabs();
      return current.length === targets.length && current.every((tab, index) => tab === targets[index]);
    });
  }

  duplicate(id: TabId): TabId | null {
    const source = this.find(id);
    if (!source) return null;
    const copy = this.createRecord(
      {
        url: source.url,
        title: source.title,
        faviconUrl: source.faviconUrl,
        group: source.group,
        history: structuredClone(captureHistory(source)),
      },
      source.isPrivate,
    );
    copy.muted = source.muted;
    copy.space = source.space;
    this.tabs.splice(this.indexOf(id) + 1, 0, copy);
    this.activate(copy.id);
    return copy.id;
  }

  private bulkTargets(id: TabId, mode: BulkCloseMode): Tab[] {
    const ordered = this.listOrder();
    const source = this.find(id);
    // A pinned launcher not opened in the list sits above all ordinary tabs.
    if (source?.pinnedUrl && !ordered.includes(source)) ordered.unshift(source);
    return bulkCloseTargets(ordered, id, mode);
  }

  canCloseRelated(id: TabId, mode: BulkCloseMode): boolean {
    return this.bulkTargets(id, mode).length > 0;
  }

  async closeRelated(id: TabId, mode: BulkCloseMode): Promise<boolean> {
    const source = this.find(id);
    const targets = this.bulkTargets(id, mode);
    if (!source) return false;
    return this.closeGroup(targets, id, () => {
      const current = this.bulkTargets(id, mode);
      return (
        this.find(id) === source &&
        current.length === targets.length &&
        current.every((tab, index) => tab === targets[index])
      );
    });
  }

  private async closeGroup(targets: Tab[], keepId: TabId | undefined, unchanged: () => boolean): Promise<boolean> {
    if ((keepId && this.closing.has(keepId)) || !targets.length || targets.some((tab) => this.closing.has(tab.id)))
      return false;
    const pages = targets.map((tab) => ({
      tab,
      contents: liveContents(tab),
      url: liveContents(tab)?.getURL() ?? tab.url,
      navigation: this.navigations.get(tab) ?? 0,
    }));
    if (keepId) this.closing.add(keepId);
    for (const tab of targets) this.closing.add(tab.id);
    try {
      // Consent for the entire group comes before removing any page.
      for (const tab of targets) if (!(await this.confirmClose(tab))) return false;
      if (
        !unchanged() ||
        pages.some(
          ({ tab, contents, url, navigation }) =>
            liveContents(tab) !== contents ||
            (contents?.getURL() ?? tab.url) !== url ||
            (this.navigations.get(tab) ?? 0) !== navigation,
        )
      )
        return false;
      if (targets.some((tab) => tab.id === this.activeId)) {
        const retained = keepId ? this.find(keepId) : this.listOrder().find((tab) => !targets.includes(tab));
        if (retained) this.activate(retained.id);
        else this.activeId = null;
      }
      // The active source stays visible and closed tabs reopen in their original list order.
      for (const tab of targets.toReversed()) this.closeApproved(tab.id);
      if (this.activeId === null) this.open();
      return true;
    } finally {
      if (keepId) this.closing.delete(keepId);
      for (const tab of targets) this.closing.delete(tab.id);
    }
  }

  async confirmCloseAll(): Promise<boolean> {
    const tabs = [...this.tabs];
    for (const tab of tabs) {
      if (!(await this.confirmClose(tab))) return false;
    }
    return tabs.length === this.tabs.length && tabs.every((tab, index) => this.tabs[index] === tab);
  }

  private async confirmClose(tab: Tab): Promise<boolean> {
    const contents = liveContents(tab);
    if (!contents) return true;
    this.freezer.unfreeze(tab);
    const allowed = await checkBeforeUnload(contents);
    this.freezer.maybeFreeze(tab);
    return allowed && (!tab.view || tab.view.webContents === contents);
  }

  private closeApproved(id: TabId): void {
    const index = this.indexOf(id);
    if (index < 0) return;
    this.selected.delete(id);
    if (this.selectionAnchor === id) this.selectionAnchor = null;
    const { pinnedUrl } = this.tabs[index];
    const partner = this.leaveSplit(id);
    const neighbor = this.listNeighbor(id);
    if (pinnedUrl) {
      this.openedPinned.delete(id);
      this.unloadPinned(this.tabs[index], pinnedUrl, partner ?? neighbor);
      return;
    }
    this.reanchorOpenedPinned(id);
    const [tab] = this.tabs.splice(index, 1);

    if (!tab.isPrivate) {
      this.options.closed.push({ ...savedTab(tab), closedAt: Date.now() });
      if (this.options.closed.length > MAX_CLOSED_TABS) this.options.closed.shift();
      this.options.onClosedChanged?.();
    }
    this.destroyView(tab);
    this.autoReloader.sync();
    if (tab.isPrivate && !this.tabs.some((item) => item.isPrivate)) this.options.onPrivateEnded();

    const opener = tab.openerId ? this.find(tab.openerId) : undefined;
    if (this.activeId === id) {
      this.activeId = null;
      const next = partner ?? opener?.id ?? neighbor;
      if (next) this.activate(next);
      else this.open();
      return;
    }
    if (opener) this.freezer.maybeFreeze(opener);
    if (partner) this.showVisible();
    this.changed(true);
  }

  private listNeighbor(id: TabId): TabId | null {
    const order = this.listOrder();
    const position = order.findIndex((tab) => tab.id === id);
    if (position < 0) return null;
    return (order[position + 1] ?? order[position - 1])?.id ?? null;
  }

  reopenClosed(): void {
    if (this.options.privateWindow || this.activeIsPrivate) return;
    const saved = this.options.closed.pop();
    if (!saved) return;
    this.options.onClosedChanged?.();
    const tab = this.createRecord({ ...saved, id: undefined, space: this.space });
    this.insertAfterActive(tab);
    this.activate(tab.id);
  }

  toggleMedia(id: TabId): void {
    this.runMedia(id, MEDIA_TOGGLE_SCRIPT);
  }

  seekMedia(id: TabId, seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    this.runMedia(id, mediaSeekScript(Math.max(-3600, Math.min(3600, Math.round(seconds)))));
  }

  skipMedia(id: TabId, direction: MediaSkip): void {
    if (direction === 'previous' || direction === 'next') this.runMedia(id, mediaSkipScript(direction));
  }

  // The sidebar player follows the tab that played sound last, until it closes or loses its media.
  mediaState(): MediaInfo | null {
    const tab = this.media ? this.find(this.media.tabId) : undefined;
    const contents = liveContents(tab);
    if (!this.media || !tab || !contents) return null;
    const info = this.media.info;
    const audible = contents.isCurrentlyAudible();
    const host = URL.canParse(tab.url) ? new URL(tab.url).hostname.replace(/^www\./, '') : '';
    return {
      tabId: tab.id,
      title: info?.title || tab.title || host,
      duration: info?.duration ?? null,
      position: info?.position ?? null,
      // Chromium keeps a tab audible for a moment after it pauses, so a found element's own state wins.
      playing: info && info.position !== null ? !info.paused : audible,
      canPrevious: info?.canPrevious ?? false,
      canNext: info?.canNext ?? false,
      updatedAt: this.media.updatedAt,
    };
  }

  private switchPip(previous: Tab | undefined, next: Tab): void {
    const { enter, exit } = pipSwitch(this.options.pictureInPicture?.() ?? false, previous, next);
    if (exit) {
      next.pip = false;
      void liveContents(next)
        ?.executeJavaScriptInIsolatedWorld(MEDIA_WORLD_ID, [{ code: PIP_EXIT_SCRIPT }], false)
        .catch(() => {});
    }
    const contents = enter ? liveContents(previous) : undefined;
    if (!previous || !contents) return;
    previous.pip = true;
    void contents
      .executeJavaScriptInIsolatedWorld(MEDIA_WORLD_ID, [{ code: PIP_ENTER_SCRIPT }], true)
      .then((entered) => {
        if (entered !== true) previous.pip = false;
      })
      .catch(() => {
        previous.pip = false;
      });
  }

  // A paused background tab gets frozen once it falls silent, and a frozen page runs no script,
  // so the player wakes it before pressing play or seeking.
  private runMedia(id: TabId, code: string): void {
    const tab = this.find(id);
    const contents = liveContents(tab);
    if (!tab || !contents) return;
    void this.freezer
      .unfreeze(tab)
      .then(() => contents.executeJavaScriptInIsolatedWorld(MEDIA_WORLD_ID, [{ code }], true))
      .then(() => setTimeout(() => void this.refreshMedia(id), 150))
      .catch(() => {});
  }

  private refreshMedia(id: TabId): Promise<void> {
    const contents = liveContents(this.find(id));
    if (!contents || this.media?.tabId !== id) return Promise.resolve();
    return contents
      .executeJavaScriptInIsolatedWorld(MEDIA_WORLD_ID, [{ code: MEDIA_READ_SCRIPT }], false)
      .then((raw) => {
        if (this.media?.tabId !== id) return;
        const info = parsePageMedia(raw);
        // A page whose media went away (navigated, removed) drops the player unless it still plays sound.
        if (info && info.position === null && info.paused && !contents.isCurrentlyAudible()) this.media = null;
        else this.media = { tabId: id, info, updatedAt: Date.now() };
        this.changed();
      })
      .catch(() => {});
  }

  move(id: TabId, toIndex: number): void {
    const here = this.here;
    const from = here.findIndex((tab) => tab.id === id);
    if (from < 0) return;
    const selected = this.selectedTabIds;
    if (
      selected.includes(id) &&
      here.some((tab) => this.selected.has(tab.id) && !!tab.pinnedUrl !== !!here[from].pinnedUrl)
    )
      return;
    const ordered = moveTabSelection(here, selected, id, toIndex);
    const slots = this.tabs.flatMap((tab, index) => (tab.space === this.space ? [index] : []));
    slots.forEach((slot, index) => (this.tabs[slot] = ordered[index]));
    this.changed(true);
  }

  discard(id: TabId): boolean {
    const tab = this.find(id);
    if (!tab?.view || this.isVisible(tab)) return false;
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
        active: this.isVisible(tab),
        pinned: tab.pinnedUrl !== null,
        loading: tab.loading,
        audible: contents.isCurrentlyAudible() || keepsPlaying(tab),
        devToolsOpen: tab.devToolsShown,
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

  archiveInactive(now: number, hours: number): number {
    let count = 0;
    for (const tab of [...this.tabs]) {
      const contents = liveContents(tab);
      const candidate = {
        active: this.isVisible(tab),
        pinned: tab.pinnedUrl !== null,
        private: tab.isPrivate,
        loading: tab.loading,
        playing: !!contents?.isCurrentlyAudible() || keepsPlaying(tab) || tab.playingMedia > 0,
        devToolsOpen: tab.devToolsShown,
        edited: tab.edited,
        autoReload: tab.autoReload !== null,
        hasLiveChild: this.tabs.some((item) => item.openerId === tab.id && !!item.view),
        inactiveSince: tab.inactiveSince,
      };
      if (!shouldArchive(candidate, now, hours)) continue;
      this.closeApproved(tab.id);
      count++;
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
      // Pinning an existing row keeps it open even in the background. Otherwise
      // expanded-only/hidden launchers make that row inaccessible in a collapsed panel.
      this.openedPinned.set(id, this.previousUnpinnedId(id));
      tab.pinnedUrl = tab.url;
      this.freezer.unfreeze(tab);
    }
    this.changed(true);
  }

  private previousUnpinnedId(id: TabId): TabId | null {
    const space = this.find(id)?.space;
    const mates = this.tabs.filter((tab) => tab.space === space);
    return (
      mates
        .slice(
          0,
          mates.findIndex((tab) => tab.id === id),
        )
        .findLast((tab) => !tab.pinnedUrl)?.id ?? null
    );
  }

  private reanchorOpenedPinned(id: TabId): void {
    const anchor = this.previousUnpinnedId(id);
    for (const [pinnedId, current] of this.openedPinned) {
      if (current === id) this.openedPinned.set(pinnedId, anchor);
    }
  }

  private keepsPinnedHome(tab: Tab, url: string): boolean {
    return (
      tab.pinnedUrl !== null && this.options.pinnedTabsStayHome?.() === true && leavesPinnedSite(tab.pinnedUrl, url)
    );
  }

  // The other site opens next to the pinned tab and in front of it; closing it comes back to the pinned tab.
  private openFromPinned(pinned: Tab, url: string): void {
    const opened = this.find(this.open(url, { activate: true, isPrivate: false }));
    if (opened && opened !== pinned) opened.openerId = pinned.id;
  }

  private unloadPinned(tab: Tab, pinnedUrl: string, neighbor: TabId | null): void {
    this.destroyView(tab);
    tab.url = pinnedUrl;
    tab.history = null;
    tab.failed = false;
    tab.upgrade = null;
    tab.blockedPopups = [];
    if (this.activeId !== tab.id) {
      this.showVisible();
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
    liveContents(tab)?.setAudioMuted(tab.muted);
    this.changed();
  }

  navigate(url: string): void {
    const tab = this.active();
    if (!tab) return;
    if (this.keepsPinnedHome(tab, url)) {
      this.openFromPinned(tab, url);
      return;
    }
    if (this.routeAppNavigation(tab, url)) return;
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
  openReadingList(): void {
    this.openSingle(READING_LIST_URL);
  }

  openWorkspaces(): void {
    this.openSingle(WORKSPACES_URL);
  }

  openBoosts(): void {
    const site = boostOrigin(this.active()?.url);
    const url = site ? `${BOOSTS_URL}?site=${encodeURIComponent(site)}` : BOOSTS_URL;
    const existing = this.tabs.find((tab) => tab.url.startsWith(BOOSTS_URL));
    if (!existing) this.open(url);
    else {
      this.activate(existing.id);
      if (site) this.navigate(url);
    }
  }

  openEasels(): void {
    this.openSingle(EASELS_URL);
  }

  openSettings(pane?: string): void {
    this.openSingle(pane ? `${SETTINGS_URL}${pane}` : SETTINGS_URL);
  }

  certificateChain(): CertificateDetails[] | null {
    const contents = liveContents(this.active());
    return contents ? certificateChainFor(contents.session, contents.getURL()) : null;
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

  openOrActivate(url: string): void {
    const remembered = this.favoriteTabs.get(url);
    const existing =
      (remembered && this.find(remembered)) || this.here.find((tab) => tab.url === url && !tab.isPrivate);
    if (existing) {
      existing.space = this.space;
      this.activate(existing.id);
    } else this.favoriteTabs.set(url, this.open(url));
  }

  private openSingle(url: string): void {
    const existing = this.here.find((tab) => tab.url.startsWith(url));
    if (existing) this.activate(existing.id);
    else this.open(url);
  }

  goBack(): boolean {
    const history = liveContents(this.active())?.navigationHistory;
    if (!history?.canGoBack()) return false;
    history.goBack();
    return true;
  }

  goForward(): boolean {
    const history = liveContents(this.active())?.navigationHistory;
    if (!history?.canGoForward()) return false;
    history.goForward();
    return true;
  }

  reload(): void {
    liveContents(this.active())?.reload();
  }

  async approveExtensionReload(
    contents: WebContents,
  ): Promise<{ current(): boolean; reload(): Promise<boolean> } | null> {
    const tab = this.tabs.find((item) => liveContents(item) === contents);
    if (!tab) return null;
    const navigation = this.navigations.get(tab) ?? 0;
    const input = tab.activatedAt;
    const url = contents.getURL();
    const valid = (reloading = false) =>
      !contents.isDestroyed() &&
      liveContents(tab) === contents &&
      this.tabs.includes(tab) &&
      contents.getURL() === url &&
      tab.activatedAt === input &&
      ((this.navigations.get(tab) ?? 0) === navigation ||
        (reloading && (this.navigations.get(tab) ?? 0) === navigation + 1));
    if (!(await this.confirmClose(tab)) || !valid()) return null;
    let used = false;
    return {
      current: () => !used && valid(),
      reload: () => {
        if (used || !valid()) return Promise.resolve(false);
        used = true;
        this.freezer.unfreeze(tab);
        return new Promise((resolve) => {
          let done = false;
          const finish = (success: boolean) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            if (!contents.isDestroyed()) {
              contents.off('will-prevent-unload', authorize);
              contents.off('did-finish-load', loaded);
              contents.off('did-fail-load', failed);
              contents.off('destroyed', destroyed);
              this.freezer.maybeFreeze(tab);
            }
            resolve(success);
          };
          // Consent was already collected for this exact document and input state.
          // A new document or fresh page input never inherits that consent.
          const authorize = (event: Electron.Event) => {
            if (valid(true)) event.preventDefault();
          };
          const loaded = () => finish(valid(true));
          const failed = (_event: unknown, code: number, _description: string, _url: string, main: boolean) => {
            if (main && code !== -3) finish(false);
          };
          const destroyed = () => finish(false);
          const timer = setTimeout(() => finish(false), 15_000);
          contents.prependListener('will-prevent-unload', authorize);
          contents.on('did-finish-load', loaded);
          contents.on('did-fail-load', failed);
          contents.on('destroyed', destroyed);
          try {
            contents.reload();
          } catch {
            finish(false);
          }
        });
      },
    };
  }

  reloadIgnoringCache(): void {
    liveContents(this.active())?.reloadIgnoringCache();
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

  // The tab a hover preview reads from: the hovered tab, or for a favourite an open tab on the same site.
  // Private tabs are never read.
  previewTab(id: TabId | null, url: string): PreviewTab | null {
    const kind = previewKind(url);
    if (!kind) return null;
    const host = new URL(url).host;
    const tab = id
      ? this.find(id)
      : this.tabs.find((candidate) => previewKind(candidate.url) === kind && new URL(candidate.url).host === host);
    if (tab?.isPrivate || (id && !tab)) return null;
    return tab ? { id: tab.id, url: tab.url, contents: liveContents(tab) } : { id: null, url, contents: null };
  }

  // Previews read from background tabs, which may be frozen; the tab is woken for the read like pageText.
  async readForPreview(contents: WebContents, code: string): Promise<unknown> {
    const tab = this.tabs.find((candidate) => liveContents(candidate) === contents);
    if (!tab || contents.isDestroyed()) return null;
    const wasFrozen = tab.frozen;
    this.freezer.unfreeze(tab);
    try {
      return await contents.executeJavaScriptInIsolatedWorld(PREVIEW_WORLD_ID, [{ code }]);
    } finally {
      if (wasFrozen) this.freezer.maybeFreeze(tab);
    }
  }

  // A frozen background tab never runs the script, so it is woken for the read.
  async pageText(id: TabId, timeoutMs = 2000): Promise<PageText | null> {
    const tab = this.find(id);
    const contents = tab?.view?.webContents;
    if (!tab || !contents || contents.isDestroyed()) return null;
    const wasFrozen = tab.frozen;
    this.freezer.unfreeze(tab);
    const read = contents
      .executeJavaScriptInIsolatedWorld(PAGE_TEXT_WORLD_ID, [{ code: PAGE_TEXT_SCRIPT }])
      .then(parsePageText, () => null);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
    const text = await Promise.race([read, timeout]);
    if (wasFrozen) this.freezer.maybeFreeze(tab);
    return text;
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
    liveContents(this.active())?.stop();
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

  // Lets the user click an element of the current web page; `read` turns the pick into a value.
  async pickPage<T>(read: PageReader<T>): Promise<PagePick<T>> {
    const tab = this.active();
    const contents = liveContents(tab);
    if (!tab?.view || !contents) return { status: 'cancelled' };
    if (tab.isPrivate || !/^https?:/.test(tab.url)) return { status: 'unavailable' };
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
      return { status: 'picked', url: tab.url, value: await read(contents, backendNodeId, tab.view.getBounds()) };
    } catch (error) {
      console.warn(`[picker] could not read the page: ${(error as Error).message}`);
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
    const tab = this.active();
    if (tab?.devToolsShown) this.closeDevTools(tab);
    else this.openDevTools(tab);
  }

  // Electron's docked DevTools is a square panel inside the page's view, so the page's rounded corners stop
  // where it starts. DevTools gets its own view instead, placed and rounded by the page placement. Electron
  // then reports DevTools as closed, so the tab keeps track of it.
  openDevTools(tab = this.active()): void {
    const contents = liveContents(tab);
    if (!tab || !contents) return;
    if (!tab.devTools) {
      const tools = new WebContentsView();
      tab.devTools = tools;
      contents.setDevToolsWebContents(tools.webContents);
      // The DevTools page can close or crash on its own; the tab then lets it go and makes a new one next time.
      const gone = () => {
        if (tab.devTools === tools) this.devToolsEnded(tab);
      };
      tools.webContents.once('destroyed', gone);
      tools.webContents.on('render-process-gone', gone);
    }
    if (tab.devToolsShown) return;
    tab.devToolsShown = true;
    contents.openDevTools({ mode: 'detach', activate: false });
    this.showDevTools(tab);
    this.changed();
  }

  closeDevTools(tab: Tab | undefined = this.active()): void {
    if (!tab?.devToolsShown) return;
    tab.devToolsShown = false;
    liveContents(tab)?.closeDevTools();
    if (tab.devTools) this.options.window.contentView.removeChildView(tab.devTools);
    if (tab.view) void this.placement.place(tab, tab.view, true);
    this.freezer.maybeFreeze(tab);
    this.changed();
  }

  // The page menu's Inspect: DevTools opens beside the page if it is not open yet, then selects the element.
  inspect(contents: WebContents, x: number, y: number): void {
    const tab = this.tabs.find((item) => item.view?.webContents === contents);
    if (tab) this.openDevTools(tab);
    contents.inspectElement(x, y);
  }

  // Dragging the gap between the page and DevTools; x is where the pointer is in the window.
  resizeDevTools(x: number): void {
    const tab = this.active();
    if (!tab?.devToolsShown || !Number.isFinite(x)) return;
    const area = this.placement.area(tab);
    this.placement.devToolsWidth = Math.round(area.x + area.width - x - SPLIT_GAP / 2);
    for (const shown of this.shown) if (shown.view) void this.placement.place(shown, shown.view, true);
    this.changed();
  }

  get devToolsDivider(): (Rectangle & { value: number }) | null {
    const tab = this.active();
    return tab && this.isVisible(tab) ? this.placement.devToolsDivider(tab) : null;
  }

  // DevTools can end without closeDevTools: its own page closes or crashes, which Electron reports to the page as
  // devtools-closed. (A crashed page drops its whole view, DevTools included.) The tab forgets it, so no empty
  // DevTools view is left beside the page. Electron sends no event when closeDevTools() is called on a page with a
  // DevTools view of its own, so closing goes through closeDevTools above.
  private devToolsEnded(tab: Tab): void {
    const tools = tab.devTools;
    if (!tools) return;
    const wasShown = tab.devToolsShown;
    tab.devTools = null;
    tab.devToolsShown = false;
    this.options.window.contentView.removeChildView(tools);
    const contents = tools.webContents as WebContents | undefined;
    if (contents && !contents.isDestroyed()) contents.close();
    if (!wasShown) return;
    if (tab.view) void this.placement.place(tab, tab.view, true);
    this.freezer.maybeFreeze(tab);
    this.changed();
  }

  private showDevTools(tab: Tab): void {
    if (!tab.devTools || !tab.view || !this.shown.includes(tab)) return;
    void this.placement.place(tab, tab.view, true);
    this.options.window.contentView.addChildView(tab.devTools);
  }

  selectByIndex(index: number): void {
    const tab = tabForShortcut(this.listOrder(), index);
    if (tab) this.activate(tab.id);
  }

  selectRelative(offset: number): void {
    const here = this.here;
    if (here.length < 2 || !this.activeId) return;
    const count = here.length;
    const index = (((here.findIndex((tab) => tab.id === this.activeId) + offset) % count) + count) % count;
    this.activate(here[index].id);
  }

  restore(session: SavedWindow, url?: string, space?: string): void {
    const ids = this.spaceIds();
    this.loadGroups(DEFAULT_SPACE_ID, session);
    for (const [id, saved] of Object.entries(session.spaceGroups ?? {}).slice(0, 50))
      if (ids.includes(id)) this.loadGroups(id, saved);
    for (const id of session.seededSpaces ?? []) if (ids.includes(id)) this.seeded.add(id);
    for (const saved of session.tabs) {
      const tab = this.createRecord(saved);
      if (!ids.includes(tab.space)) tab.space = DEFAULT_SPACE_ID;
      this.tabs.push(tab);
    }
    const active = session.activeTabId ? this.find(session.activeTabId) : undefined;
    if (active) {
      this.activate(active.id);
    } else {
      this.open(url, { space });
    }
  }

  toSavedWindow(only?: string): SavedWindow {
    const kept = this.tabs.filter((tab) => !tab.isPrivate && (only === undefined || tab.space === only));
    const groupsOf = (space: string): SavedGroups => {
      const used = this.usedGroups(kept.filter((tab) => tab.space === space));
      const state = this.groupStates.get(space);
      const parents = pruneGroupParents(state?.parents ?? new Map(), used);
      const names = new Set(groupOrder(used, parents));
      return {
        ...(state?.collapsed.size && {
          collapsedGroups: Array.from(state.collapsed).filter((name) => names.has(name)),
        }),
        ...(parents.size && { groupParents: Object.fromEntries(parents) }),
      };
    };
    const active = only === undefined || only === this.space ? this.activeId : this.spaceActive.get(only);
    const spaceGroups = Object.fromEntries(
      [...new Set(kept.map((tab) => tab.space))]
        .filter((space) => space !== DEFAULT_SPACE_ID)
        .map((space) => [space, groupsOf(space)]),
    );
    const seeded = [...this.seeded].filter((id) => id !== DEFAULT_SPACE_ID);
    return {
      activeTabId: kept.some((tab) => tab.id === active) ? active! : (kept[0]?.id ?? null),
      tabs: kept.map((tab) => ({
        ...savedTab(tab),
        inactiveSince: this.isVisible(tab) ? Date.now() : tab.inactiveSince,
      })),
      ...groupsOf(only ?? DEFAULT_SPACE_ID),
      ...(only === undefined && Object.keys(spaceGroups).length && { spaceGroups }),
      ...(only === undefined && seeded.length && { seededSpaces: seeded }),
    };
  }

  hasContents(contents: WebContents): boolean {
    return this.tabs.some((tab) => tab.view?.webContents === contents);
  }

  openContents(url: string | null, activate: boolean): WebContents | null {
    const previous = this.activeId;
    const id = this.open(url ?? undefined, { activate, isPrivate: false });
    // A web-app window hands the URL elsewhere and returns its current tab, which is not a new tab.
    if (id === previous) return null;
    const tab = this.find(id);
    // Sign-in tabs close themselves once done; return to the tab the user was on, not the next one in the list.
    if (tab && activate && previous) tab.openerId = previous;
    return liveContents(tab) ?? null;
  }

  closeContents(contents: WebContents): boolean {
    const tab = this.tabs.find((candidate) => candidate.view?.webContents === contents);
    if (tab) this.close(tab.id);
    return tab !== undefined;
  }

  isActiveContents(contents: WebContents): boolean {
    return this.activeContents() === contents;
  }

  suggestionTabs(): { id: TabId; title: string; url: string }[] {
    return this.tabs.filter((tab) => tab.id !== this.activeId).map(({ id, title, url }) => ({ id, title, url }));
  }

  get pinnedPages(): RecentPage[] {
    return this.here.flatMap((tab) =>
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
    const position = this.here.indexOf(tab);
    const partner = this.leaveSplit(id);
    this.shown = this.shown.filter((item) => item !== tab);
    if (this.fullScreenId === id) this.fullScreenId = null;
    this.selected.delete(id);
    if (this.selectionAnchor === id) this.selectionAnchor = null;
    this.reanchorOpenedPinned(id);
    this.openedPinned.delete(id);
    this.tabs.splice(index, 1);
    this.freezer.unfreeze(tab);
    tab.detachListeners?.();
    tab.detachListeners = null;
    if (tab.view) this.options.window.contentView.removeChildView(tab.view);
    if (tab.devTools) this.options.window.contentView.removeChildView(tab.devTools);
    this.options.onHtmlFullScreenChange(tab.id, false);
    this.autoReloader.sync();
    if (this.activeId === id) {
      this.activeId = null;
      const mates = this.here;
      const next = partner ?? mates[Math.min(position, mates.length - 1)]?.id;
      if (next) this.activate(next);
      else this.open();
    } else {
      if (partner) this.showVisible();
      this.changed(true);
    }
    return tab;
  }

  adopt(tab: DetachedTab): void {
    tab.space = this.space;
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
    // A pinned tab coming back after a restart or after memory saving starts again at its pinned address.
    if (tab.pinnedUrl && this.options.pinnedTabsStayHome?.() && tab.url !== tab.pinnedUrl) {
      tab.url = tab.pinnedUrl;
      tab.history = null;
      tab.failed = false;
      tab.upgrade = null;
    }

    const view = this.createPageView(tab.isPrivate);
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

  createPageView(isPrivate: boolean): WebContentsView {
    return createPageView(this.options.pagePreload, isPrivate ? this.options.privateSession : this.options.session);
  }

  adoptView(
    view: WebContentsView,
    page: { url: string; title: string; isPrivate: boolean; interacted: boolean; edited: boolean },
  ): void {
    const opener = this.active();
    const tab = this.createRecord({ url: page.url, title: page.title }, page.isPrivate);
    tab.openerId = opener?.id ?? null;
    tab.group = opener?.group ?? null;
    tab.loading = view.webContents.isLoading();
    tab.interacted = page.interacted;
    tab.edited = page.edited;
    tab.visitId = page.isPrivate ? null : this.options.onVisit(page.url, page.title);
    this.insertAfterActive(tab);
    this.mount(tab, view);
    this.activate(tab.id);
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

    // Clicking a split pane makes it the focused tab without the layout change activate() would do.
    listen('focus', () => {
      if (tab.id === this.activeId || !this.shown.includes(tab)) return;
      this.activeId = tab.id;
      this.selectionAnchor = tab.id;
      this.changed();
    });

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
      tab.interacted = false;
      view.setBackgroundColor(url === NEW_TAB_URL ? '#00000000' : '#ffffff');
      const factor = this.options.zoomFor(url, tab.isPrivate);
      if (Math.abs(contents.getZoomFactor() - factor) > 0.001) contents.setZoomFactor(factor);
    });

    listen('context-menu', (_event, params) => this.options.onContextMenu(contents, params));

    listen('found-in-page', (_event, result) => {
      if (tab.id !== this.activeId || result.matches === undefined) return;
      this.options.onFindResult({ active: result.activeMatchOrdinal ?? 0, matches: result.matches });
    });

    listen('enter-html-full-screen', () => {
      this.fullScreenId = tab.id;
      this.showVisible();
      this.options.onHtmlFullScreenChange(tab.id, true);
    });
    listen('leave-html-full-screen', () => {
      if (this.fullScreenId === tab.id) {
        this.fullScreenId = null;
        this.showVisible();
      }
      this.options.onHtmlFullScreenChange(tab.id, false);
    });
  }

  private listenForWindowRequests(tab: Tab, contents: WebContents, listen: Listen): void {
    listen('will-prevent-unload', (event) => {
      if (event.defaultPrevented) return;
      // Like Chromium, a page the user never touched cannot hold the window or the app open.
      if (!tab.interacted || this.options.confirmUnload(tab)) event.preventDefault();
    });
    listen('will-navigate', (event) => {
      if (this.routeAppNavigation(tab, event.url)) {
        event.preventDefault();
        return;
      }
      if (this.keepsPinnedHome(tab, event.url)) {
        event.preventDefault();
        this.openFromPinned(tab, event.url);
        return;
      }
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
      if (isActivation(input.type)) {
        tab.activatedAt = Date.now();
        tab.interacted = true;
      }
      if (input.type === 'char') tab.edited = true;
    });
    contents.setWindowOpenHandler(({ url, disposition, features }) => {
      if (mayOpenWindow(tab.activatedAt, Date.now(), this.options.popupsAllowed(contents.getURL(), tab.isPrivate))) {
        tab.activatedAt = 0;
        if (opensPeek(disposition, features, url)) {
          this.options.onPeek(url, tab.isPrivate);
          return { action: 'deny' };
        }
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
      // Players retitle the page per track, which is the cue to re-read the metadata.
      if (this.media?.tabId === tab.id) void this.refreshMedia(tab.id);
      const unread = unreadCount(contents.getURL(), title, tab.unread);
      if (tab.title === title && tab.unread === unread) return;
      tab.title = title;
      tab.unread = unread;
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
      // The previous page's sound stops after the next one commits, which must not count as the new page's sound.
      if (audible || tab.soundAt) tab.soundAt = Date.now();
      if (audible) this.media = { tabId: tab.id, info: null, updatedAt: Date.now() };
      const read = this.media?.tabId === tab.id ? this.refreshMedia(tab.id) : Promise.resolve();
      // The player reads the paused state before the tab freezes, or it would keep showing it as playing.
      if (!audible) void read.then(() => this.freezer.freezeAfterGap(tab));
      this.changed();
    });
    listen('media-started-playing', () => {
      tab.playingMedia++;
    });
    listen('media-paused', () => {
      tab.playingMedia = Math.max(0, tab.playingMedia - 1);
      if (tab.soundAt) tab.soundAt = Date.now();
      this.freezer.freezeAfterGap(tab);
    });
    listen('did-navigate', () => {
      tab.playingMedia = 0;
      tab.soundAt = 0;
      tab.pip = false;
    });
    listen('devtools-closed', () => {
      this.devToolsEnded(tab);
      this.freezer.maybeFreeze(tab);
    });
    listen('did-start-navigation', ({ url, isMainFrame, isSameDocument }) => {
      if (isMainFrame) this.options.threatGuard?.navigating(contents, url);
      if (!isMainFrame || isSameDocument) return;
      this.navigations.set(tab, (this.navigations.get(tab) ?? 0) + 1);
      const userAgent = signInUserAgent(url, process.platform) ?? contents.session.getUserAgent();
      if (contents.getUserAgent() !== userAgent) contents.setUserAgent(userAgent);
      this.syncAgentFor(tab, url);
      const hadTranslationState = tab.translation !== 'idle' || tab.pageLanguage !== null;
      this.translation.reset(tab);
      if (tab.blockedPopups.length === 0 && !hadTranslationState) return;
      tab.blockedPopups = [];
      this.changed();
    });
  }

  private listenForLoads(tab: Tab, view: WebContentsView, listen: Listen, disposers: (() => void)[]): void {
    const contents = view.webContents;
    listen('will-redirect', (event) => {
      if (!event.isMainFrame) return;
      // A redirect keeps the user agent the navigation started with, so Gmail's hop to Google sign-in
      // would show the page a Chrome user agent under Firefox headers; restart it with the right one.
      // Changing it mid-navigation aborts the load, so the restart waits for the cancelled one to unwind.
      const userAgent = signInUserAgent(event.url, process.platform) ?? contents.session.getUserAgent();
      if (contents.getUserAgent() !== userAgent && !authRedirectExtension(event.url)) {
        event.preventDefault();
        const url = event.url;
        setTimeout(() => {
          if (tab.view !== view || contents.isDestroyed()) return;
          contents.setUserAgent(userAgent);
          void contents.loadURL(url).catch(() => {});
        }, 0);
        return;
      }
      if (this.routeAppNavigation(tab, event.url)) {
        event.preventDefault();
        return;
      }
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
      const threat = code === -20 ? this.options.threatGuard?.warning(contents, url) : null;
      if (threat) {
        failure = errorPageScript(
          this.options.pageTheme,
          code,
          'CERT Polska',
          url,
          `${PROCEED_THREAT_URL}${threat.token}`,
          false,
          { title: t('threats.pageTitle'), message: t('threats.pageMessage', { host: new URL(url).hostname }) },
        );
      } else if (upgrade && withoutHash(url) === withoutHash(upgrade.https)) {
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
      case 'proceed-threat': {
        const url = this.options.threatGuard?.proceed(contents, navigation.token, contents.getURL());
        if (url) void contents.loadURL(url);
        return;
      }
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
      case 'new-tab-update':
        this.options.onUpdateCard(navigation.action);
        if (navigation.action === 'close') contents.reload();
        return;
      case 'new-tab-feedback':
        this.options.onFeedback(navigation.action);
        if (navigation.action === 'open') void contents.loadURL(FEEDBACK_URL);
        else contents.reload();
        return;
    }
  }

  private destroyView(tab: Tab): void {
    this.freezer.cancel(tab);
    const view = tab.view;
    if (!view) return;
    this.shown = this.shown.filter((item) => item !== tab);
    if (this.fullScreenId === tab.id) this.fullScreenId = null;
    if (this.media?.tabId === tab.id) this.media = null;
    tab.detachListeners?.();
    tab.detachListeners = null;
    this.options.onHtmlFullScreenChange(tab.id, false);
    tab.view = null;
    tab.loading = false;
    tab.frozen = false;
    tab.playingMedia = 0;
    tab.soundAt = 0;
    tab.pip = false;
    tab.overrides = NO_OVERRIDES;
    tab.agent = null;
    this.translation.reset(tab);
    this.options.window.contentView.removeChildView(view);
    const tools = tab.devTools;
    tab.devTools = null;
    tab.devToolsShown = false;
    if (tools) {
      this.options.window.contentView.removeChildView(tools);
      const toolsContents = tools.webContents as WebContents | undefined;
      if (toolsContents && !toolsContents.isDestroyed()) toolsContents.close();
    }
    // A view drops its contents once a page closes itself, despite the typings.
    const contents = view.webContents as WebContents | undefined;
    if (contents && !contents.isDestroyed()) contents.close();
  }

  private snapshot(tab: Tab): TabSnapshot {
    const history = liveContents(tab)?.navigationHistory;
    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      faviconUrl: tab.faviconUrl,
      live: tab.view !== null,
      frozen: tab.frozen,
      loading: tab.loading,
      pinned: tab.pinnedUrl !== null,
      group: tab.group,
      isPrivate: tab.isPrivate,
      bookmarked: this.options.isBookmarked(tab.url),
      security: tab.failed ? 'local' : securityState(tab.url, this.options.hasCertificateException(tab.url)),
      blockedPopups: tab.blockedPopups.length,
      overrides: tab.overrides,
      translation: { status: tab.translation, available: this.translation.available(tab) },
      autoReloadSeconds: tab.autoReload?.seconds ?? null,
      audible: liveContents(tab)?.isCurrentlyAudible() ?? false,
      muted: tab.muted,
      // A discarded tab no longer runs the page, so whatever it last showed may be out of date.
      unread: tab.view !== null && (tab.unread ?? 0) > 0,
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

  private routeAppNavigation(tab: Tab | null, url: string): boolean {
    if (!this.options.webAppScope || tab?.openerId || webAppContains(this.options.webAppScope, url)) return false;
    this.options.onAppExternal?.(url);
    return true;
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
