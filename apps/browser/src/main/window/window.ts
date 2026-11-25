import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BaseWindow,
  ClipboardItem,
  Menu,
  WebContentsView,
  app,
  clipboard,
  dialog,
  nativeTheme,
  screen,
  type Rectangle,
  type Session,
  type TitleBarOverlay,
  type WebContents,
} from 'electron';
import { watchInterfaceBridge } from './interface-bridge.js';
import { getLocale, t } from '../../shared/i18n.js';
import { loadRenderer } from '../app/dev-renderer.js';
import { preloadPath, rendererPath } from '../app/paths.js';
import {
  NEW_TAB_URL,
  IpcChannel,
  TOOLBAR_BUTTON_IDS,
  placeSidebarFooterItem,
  sanitizeSidebarFooterItems,
  type AnchorRect,
  type BrowserState,
  type ChromeLayout,
  type DevCommandId,
  type DeviceId,
  type ProfileKind,
  type TabId,
  type SidebarMenu,
  type SidebarMenuCommand,
  type SidebarMenuKind,
  type UiAction,
  type WindowMaterial,
} from '../../shared/types.js';
import { type AgentElementRef, type AgentProviderId } from '../../shared/agent.js';
import { isTabMode, modeFlags } from '../../shared/tab-modes.js';
import { canBookmark, type BookmarkStore } from '../library/bookmarks.js';
import { siteIcons } from '../library/site-icons.js';
import { storageDomain } from '../privacy/site-storage.js';
import type { BookmarksPanelView } from '../../shared/bookmarks-panel.js';
import type { FavoriteStore } from '../library/favorites.js';
import type { LiveFolderRefresher, LiveFolderStore } from '../library/live-folders.js';
import { isLiveFolderKind, LIVE_FOLDER_KINDS, liveFolderSource } from '../../shared/live-folders.js';
import { colorSwatch } from './menu-swatch.js';
import { shortcutAccelerator, type ShortcutId } from '../../shared/shortcuts.js';
import { parseSpaceFile, spaceFileText, type WorkspaceStore } from '../library/workspaces.js';
import { DEFAULT_SPACE_ID, SPACE_ICONS, type SpaceView } from '../../shared/workspaces.js';
import type { BookmarkImportResult, HistoryImportResult } from '../library/browser-import.js';
import type { CertificateExceptions } from '../privacy/certificates.js';
import type { CommandBar, CommandBarHost } from '../address-bar/command-bar.js';
import type { ConfirmDialog } from './confirm-dialog.js';
import { contextMenuTemplate } from './context-menu.js';
import {
  autoReloadSeconds,
  isDevCommandId,
  isDevCommandInput,
  matchDevCommands,
  overridePatch,
} from '../devtools/dev-commands.js';
import { devMenuTemplate } from '../devtools/dev-menu.js';
import { downloadCommands, downloadStatus, type DownloadActions, type DownloadStore } from '../library/downloads.js';
import { sanitizeAnchor, type ExtensionPopup } from '../extensions/extension-popup.js';
import { STORE_HOME } from '../extensions/chrome-web-store.js';
import { extensionsMenuTemplate, runAction, type ExtensionManager } from '../extensions/extensions.js';
import { withBadgeDot } from '../extensions/action-api.js';
import { ExtensionSidePanel } from '../extensions/extension-side-panel.js';
import type { FindBar, FindBarHost } from './find-bar.js';
import { applyGlass, glassAvailable } from './glass.js';
import type { HistoryStore } from '../library/history.js';
import type { HttpsOnly } from '../privacy/https-only.js';
import { canViewSource, formatAddress, type AddressFormat } from '../devtools/page-export.js';
import { NavigationHint, type HistoryDirection } from './navigation-hint.js';
import { TooltipOverlay } from './tooltip-overlay.js';
import { HoverPreview, type PreviewChoice } from './hover-preview.js';
import { hostOf } from '../../shared/hosts.js';
import {
  previewView,
  validPreviewRequest,
  type PreviewContent,
  type TabAction,
  type TabCard,
} from '../../shared/previews.js';
import { readPreview, CALENDAR_OPEN_SCRIPT, type PreviewTab } from '../tabs/previews.js';
import { LinkPeek, type PeekOwner } from './link-peek.js';
import { createOverlayView } from './overlay-view.js';
import { validTooltip } from '../../shared/tooltip.js';
import { PageNotice } from './page-notice.js';
import { AgentControl } from '../agent-bridge/agent-control.js';
import type { ActionWindow } from '../agent-bridge/action-runner.js';
import type { Verification } from '../agent-bridge/verification.js';
import { formatLocation } from '../agent-bridge/component-source.js';
import { pageFrame } from './page-layout.js';
import { permissionOrigin, type PermissionStore } from '../privacy/permissions.js';
import type { PersistChange, SavedTab, SavedWindow } from '../tabs/persistence.js';
import { blockedPopupsTemplate } from '../tabs/popups.js';
import { Preconnector } from '../address-bar/preconnect.js';
import type { RepoPrompt } from '../app/repo-prompt.js';
import type { ChatPreferenceStore } from '../agent-bridge/chat-preferences.js';
import {
  exportBookmarksWithDialog,
  exportSpaceWithDialog,
  exportSpacesWithDialog,
  importBookmarksWithDialog,
  importHistoryWithDialog,
  importSpaceWithDialog,
} from './import-dialogs.js';
import { printPage, savePdfFile, saveScreenshotFile } from './page-capture.js';
import { CAPTURE_AREA_SCRIPT, CAPTURE_AREA_WORLD_ID, captureRect } from './capture-area.js';
import { showCertificateDetails } from '../privacy/certificate-details.js';
import { saveOfflinePage, openLocalFiles } from './page-files.js';
import {
  folderMenuTemplate,
  libraryMenuTemplate,
  profileMenuTemplate,
  siteInfoMenu,
  tabMenuTemplate,
} from './window-menus.js';
import { SEARCH_ENGINES, buildSearchUrl, resolveSearchEngine, type SearchEngine } from '../address-bar/search.js';
import type { SettingsStore } from '../app/settings.js';
import type { SiteProtections } from '../privacy/site-protections.js';
import { clearSiteData } from '../privacy/site-data.js';
import { EMPTY_HISTORY_INDEX, suggest } from '../address-bar/suggestions.js';
import { MAX_SPLIT_PANES, TabManager, type CloseApproval, type DetachedTab, type PageReader } from '../tabs/tabs.js';
import { resolveInput, withoutHash } from '../address-bar/url.js';
import type { RequestRuleStore } from '../devtools/request-rules.js';
import type { ZoomStore } from '../tabs/zoom.js';
import type { AgentSession, AgentConnection } from '../agent-bridge/agent-session.js';
import type { AgentChat } from '../agent-bridge/agent-chat.js';
import { ProjectFiles } from '../agent-bridge/project-files.js';
import { availableProviders, isAgentProvider } from '../agent-bridge/agent-providers.js';
import { AGENT_LABELS, resolveAgentContexts } from '../../shared/agent-panel.js';
import type { PageText } from '../agent-bridge/page-text.js';
import type { ProjectRunner } from '../agent-bridge/project-runner.js';
import { projectIncludes } from '../agent-bridge/tab-scope.js';
import { signIn, signOut } from '../agent-bridge/agent-login.js';
import { chatDigest } from '../agent-bridge/chat-digest.js';
import { AgentProject } from '../agent-bridge/agent-project.js';
import { AgentProjectTabs } from '../agent-bridge/agent-project-tabs.js';
import { selectionRef, type ElementSelection } from '../agent-bridge/selection.js';
import { MAX_REFERENCES, referenceRef, type ReferenceCapture } from '../agent-bridge/reference.js';
import {
  VisualComparisonManager,
  VisualComparisonError,
  type VisualComparisonTab,
} from '../agent-bridge/visual-comparison.js';
import { captureVisualPage } from '../agent-bridge/visual-capture.js';
import {
  ResponsiveScanManager,
  ResponsiveScanError,
  createResponsiveScanSession,
} from '../agent-bridge/responsive-scan.js';
import { acquirePageWork, pageWorkBusy } from '../tabs/page-work.js';
import { readingUrl } from '../../shared/reading-list.js';
import { startupPages } from '../../shared/startup-pages.js';
import type { WebAppInfo } from '../../shared/web-apps.js';
import { ACCENT_COLORS, accentHex, type AccentColorId } from '../../shared/accent.js';
import { IS_MAC, openAsText } from '../platform.js';
import { FloatingChat } from '../agent-bridge/floating-chat.js';
import { hideFullScreenTitlebar, menuBarEdge } from './fullscreen-titlebar.js';
import { RESTING_SLIDE, slideMenuBar } from './menu-bar-slide.js';

// The card toolbar is 41px tall inside a card inset 6px from the top; center the lights on it.
const WINDOW_CONTROLS_INSET = { x: 18, y: 20 };
const SIDEBAR_MENU_LINKS = 8;
const LIVE_FOLDER_LABELS = {
  feed: 'liveFolders.kindFeed',
  releases: 'liveFolders.kindReleases',
  commits: 'liveFolders.kindCommits',
  tags: 'liveFolders.kindTags',
} as const;
// Polled at frame rate so the content follows the menu bar while it slides.
const MENU_BAR_POLL_MS = 16;
const TITLEBAR_SYMBOL_COLORS = { light: '#1a1b1e', dark: '#f4f4f7' };
const TITLEBAR_OVERLAY_HEIGHT = 44;
const CASCADE_OFFSET = 24;
const REVEAL_FALLBACK_MS = 1000;
const FIRST_PAINT_WAIT_MS = 200;
const FIRST_PAINT_SCRIPT = `new Promise((resolve) => {
  if (performance.getEntriesByType('paint').length > 0) return resolve();
  new PerformanceObserver((_list, observer) => {
    observer.disconnect();
    resolve();
  }).observe({ type: 'paint', buffered: true });
  setTimeout(resolve, ${FIRST_PAINT_WAIT_MS});
})`;
const MAX_PICKED_ELEMENTS = 5;
const MAX_AGENT_PROJECTS = 6;

function titleBarOverlayOptions(): TitleBarOverlay {
  return {
    color: 'rgba(0, 0, 0, 0)',
    symbolColor: nativeTheme.shouldUseDarkColors ? TITLEBAR_SYMBOL_COLORS.dark : TITLEBAR_SYMBOL_COLORS.light,
    height: TITLEBAR_OVERLAY_HEIGHT,
  };
}

export interface AppContext {
  icon: string;
  openSettings(pane?: string): void;
  daily: Session;
  privateBrowsing: Session;
  developer: Session;
  requestRules: RequestRuleStore;
  settings: SettingsStore;
  siteProtections: SiteProtections;
  commandBar: CommandBar;
  findBar: FindBar;
  confirmDialog: ConfirmDialog;
  history: HistoryStore;
  repoPrompt: RepoPrompt;
  dismissUpdate: () => void;
  installUpdate: () => void;
  updateReady: () => boolean;
  chatPreferences: ChatPreferenceStore;
  downloads: DownloadStore;
  bookmarks: BookmarkStore;
  favorites: FavoriteStore;
  favoritesChanged(): void;
  liveFolders: LiveFolderStore;
  liveFolderRefresher: LiveFolderRefresher;
  liveFoldersChanged(): void;
  workspaces: WorkspaceStore;
  spacesChanged(): void;
  spaceSession(id: string): Session | null;
  extensions: ExtensionManager;
  extensionPopup: ExtensionPopup;
  extensionBridge: import('../extensions/extension-bridge.js').ExtensionBridge;
  extensionAccess: import('../extensions/extension-access-controller.js').ExtensionAccessController;
  certificates: CertificateExceptions;
  httpsOnly: HttpsOnly;
  persistentProfiles: import('../app/profile-controller.js').ProfileController;
  threatGuard: import('../privacy/threat-guard.js').ThreatGuard;
  closedTabs: SavedTab[];
  onClosedTabsChange(): void;
  clearClosedTabs(): void;
  pageTheme: string;
  permissionsFor(browsing: Session, isPrivate: boolean): PermissionStore | null;
  openAppLink(contents: WebContents, url: string, isPrivate: boolean): void;
  zoomFor(isPrivate: boolean): ZoomStore;
  searchEngine(): SearchEngine;
  downloadActions(window: YalqenWindow): DownloadActions;
  downloadsChanged(): void;
  toggleBookmark(url: string, title: string): void;
  bookmarkTabs(tabs: { url: string; title: string }[]): void;
  runBookmarksCommand(command: string, params: URLSearchParams): void;
  importBookmarks(file: string): Promise<BookmarkImportResult>;
  importHistory(file: string): Promise<HistoryImportResult>;
  runDownloadsCommand(command: string, params: URLSearchParams, contents: WebContents): void;
  updateSettings(patch: unknown): void;
  deviceId(): DeviceId;
  openWindow(options: WindowOptions): YalqenWindow;
  switchProfile(profile: ProfileKind, from: YalqenWindow): void;
  onWindowChange(persist: PersistChange): void;
  onPrivateTabsClosed(): void;
  onDeveloperTabsClosed(): void;
  onWindowFocus(window: YalqenWindow): void;
  onWindowClosing(window: YalqenWindow): void;
  onWindowClosed(window: YalqenWindow): void;
  agentScope(url: string, privateBrowsing: boolean): boolean;
  agentConnection(window: YalqenWindow, project: AgentProject): Promise<AgentConnection>;
  releaseAgentConnection(project: AgentProject): void;
}

export interface WindowOptions {
  webApp?: WebAppInfo;
  isPrivate?: boolean;
  developer?: boolean;
  saved?: SavedWindow;
  url?: string;
  space?: string;
  tab?: DetachedTab;
  from?: YalqenWindow;
}

export class YalqenWindow {
  readonly webApp: WebAppInfo | null;
  private closeApproval: CloseApproval | null = null;
  private menuBarHeight = 0;
  private sidebarMenuAnchor: AnchorRect = { x: 0, y: 0, width: 0, height: 0 };
  private menuBarSlide = RESTING_SLIDE;
  private menuBarInset = 0;
  private menuBarTimer: NodeJS.Timeout | null = null;
  private closePending = false;
  readonly window: BaseWindow;
  readonly tabs: TabManager;
  readonly isPrivate: boolean;
  readonly isDeveloper: boolean;
  private agentProjects: AgentProject[] = [];
  private activeProjectId = '';
  private readonly projectTabs = new AgentProjectTabs();
  private readonly projectElements = new Map<string, AgentElementRef[]>();
  private agentProviders: AgentProviderId[] = ['claude'];
  private readonly projectFiles = new ProjectFiles();
  private agentPanelOpen = false;
  private bookmarksPanelOpen = false;
  private bookmarksPanelCache: { revision: number; view: BookmarksPanelView } | null = null;
  private signingIn = false;
  private pickedElements: AgentElementRef[] = [];
  private readonly references = new Map<string, ReferenceCapture>();
  private readonly visualComparisons = new Map<string, VisualComparisonManager>();
  private readonly responsiveScans = new Map<string, ResponsiveScanManager>();
  private selectingAgentDirectory = false;
  private readonly ui: WebContentsView;
  readonly uiContents: Electron.WebContents;
  readonly floatingChat: FloatingChat;
  private readonly commandHost: CommandBarHost;
  private readonly findHost: FindBarHost;
  private pageArea: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  private sidePanel: ExtensionSidePanel | null = null;
  private readonly preconnector: Preconnector;
  private layout: ChromeLayout = {
    panelWidth: 170,
    panelSlide: 0,
    chromeHeight: 44,
    pageInset: 8,
    pageRadius: 16,
  };
  private glassApplied: boolean;
  private revealed = false;
  private revealPending = false;
  private htmlFullScreenTabId: string | null = null;
  private pushQueued = false;
  private lastPushedState = '';
  private findTarget: { tabId: string; url: string } | null = null;
  private readonly navigationHint: NavigationHint;
  private readonly tooltip: TooltipOverlay;
  private readonly preview: HoverPreview;
  private previewShown: { tab: PreviewTab; content: PreviewContent | null } | null = null;
  private readonly notice: PageNotice;
  private capturingArea = false;
  private readonly agentControl: AgentControl;
  private readonly peek: LinkPeek;
  private lastNavigationGesture: { source: 'native' | 'page'; direction: 'back' | 'forward'; at: number } | null = null;

  constructor(
    private readonly app: AppContext,
    options: WindowOptions,
  ) {
    this.glassApplied = glassAvailable;
    this.isDeveloper = options.developer ?? false;
    this.isPrivate = this.isDeveloper || (options.isPrivate ?? false);
    this.webApp = this.isPrivate ? null : (options.webApp ?? null);
    this.ui = new WebContentsView({
      webPreferences: {
        preload: preloadPath('preload'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.uiContents = this.ui.webContents;
    if (this.glassApplied) this.ui.setBackgroundColor('#00000000');
    this.uiContents.on('will-navigate', (event) => event.preventDefault());
    this.uiContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    watchInterfaceBridge(this.uiContents);
    this.uiContents.on('before-input-event', (event, input) => {
      if (!this.isPrivate && app.extensionBridge.shortcut(input, this.tabs.activeContents())) event.preventDefault();
    });
    void loadRenderer(this.uiContents, rendererPath('index.html'), { lang: getLocale() });

    const from = options.from?.window.getBounds();
    this.window = new BaseWindow({
      width: from?.width ?? 1280,
      height: from?.height ?? 820,
      ...(from ? { x: from.x + CASCADE_OFFSET, y: from.y + CASCADE_OFFSET } : {}),
      minWidth: 640,
      minHeight: 400,
      title: `${this.isDeveloper ? t('window.titleDeveloper') : this.isPrivate ? t('window.titlePrivate') : 'Yalqen'} · ${app.persistentProfiles.currentName()}`,
      icon: app.icon,
      titleBarStyle: IS_MAC ? 'hiddenInset' : 'hidden',
      ...(!IS_MAC ? { titleBarOverlay: titleBarOverlayOptions() } : {}),
      ...(this.glassApplied ? { vibrancy: 'hud' as const } : {}),
      visualEffectState: 'active',
      show: false,
    });
    this.activeProjectId = this.addProject().id;
    this.window.contentView.addChildView(this.ui);
    this.floatingChat = new FloatingChat(this.window);

    this.preconnector = new Preconnector((origin) => this.tabs.activeSession().preconnect({ url: origin }));

    this.commandHost = {
      window: this.window,
      onSubmit: (input, mode, engine) => {
        this.preconnector.cancel();
        if (engine) {
          const url = buildSearchUrl(resolveSearchEngine(engine, null), input.trim());
          if (mode === 'new-tab') this.tabs.open(url);
          else this.tabs.navigate(url);
          return;
        }
        if (isDevCommandInput(input)) {
          const command = matchDevCommands(input)[0]?.commandId;
          if (command) this.runDevCommand(command);
          return;
        }
        const url = resolveInput(input, app.searchEngine());
        if (mode === 'new-tab') this.tabs.open(url);
        else this.tabs.navigate(url);
      },
      onDismiss: () => {
        this.preconnector.cancel();
        if (!this.tabs.focusActive()) this.uiContents.focus();
      },
      onInput: (input) => {
        if (isDevCommandInput(input)) {
          this.preconnector.cancel();
          this.commandBar.showSuggestions(this.window, input, matchDevCommands(input));
          return;
        }
        this.preconnector.typed(input, app.searchEngine());
        this.commandBar.showSuggestions(
          this.window,
          input,
          suggest(input, {
            tabs: this.tabs.suggestionTabs(),
            bookmarks: app.bookmarks.suggestions(),
            history: this.tabs.activeIsPrivate ? EMPTY_HISTORY_INDEX : app.history.index(),
          }),
        );
      },
      onSwitchTab: (id) => this.tabs.activate(id),
      onRunCommand: (id) => this.runDevCommand(id),
      onDragDownload: (id, contents) => app.runDownloadsCommand('drag', new URLSearchParams({ id }), contents),
      onSidebarMenu: (action) => {
        if (action.type === 'switch-tab') this.tabs.activate(action.id);
        else if (action.type === 'switch-space' || action.type === 'open-space-menu') this.handleAction(action);
        else if (action.type === 'open-link') this.tabs.open(action.url);
        else if (action.type === 'download-action') this.runDownloadAction(action.id);
        else if (action.type === 'place-footer-item')
          this.app.updateSettings({
            sidebarFooterItems: placeSidebarFooterItem(
              this.app.settings.get().sidebarFooterItems,
              action.item,
              action.index,
            ),
          });
        else if (action.type === 'open-chat')
          void this.agentChat.open(action.id, false).finally(() => this.openAgentPanel());
        else if (action.type === 'sidebar-command') this.runSidebarCommand(action.command);
      },
    };

    this.findHost = {
      window: this.window,
      area: () => this.pageArea,
      tint: () => this.menuTint(),
      onFind: (text, forward, next) => this.tabs.findInPage(text, forward, next),
      onClose: () => {
        if (this.findTarget) this.tabs.stopFind(this.findTarget.tabId);
        this.findTarget = null;
        if (!this.tabs.focusActive()) this.uiContents.focus();
      },
    };

    this.tabs = new TabManager({
      window: this.window,
      pagePreload: preloadPath('page-preload'),
      pageTheme: app.pageTheme,
      newTabMarkColor: (space) => this.accent(space),
      closed: app.closedTabs,
      onClosedChanged: () => app.onClosedTabsChange(),
      openSettings: (pane) => app.openSettings(pane),
      privateWindow: this.isPrivate,
      webAppScope: this.webApp?.scope,
      onAppExternal: (url) => {
        const safe = readingUrl(url);
        if (safe) app.openWindow({ url: safe, from: this });
      },
      session: app.daily,
      privateSession: this.isDeveloper ? app.developer : app.privateBrowsing,
      developerSession: app.developer,
      developerWindow: this.isDeveloper,
      tabModes: () => app.settings.get().tabModes,
      autoDeveloperMode: () => app.settings.get().autoDeveloperMode,
      onPrivateEnded: () => app.onPrivateTabsClosed(),
      onAppLink: (contents, url, isPrivate) => app.openAppLink(contents, url, isPrivate),
      onPagePress: () => {
        if (this.bookmarksPanelVisible && !this.uiContents.isDestroyed()) this.uiContents.send(IpcChannel.pagePress);
      },
      onDeveloperEnded: () => app.onDeveloperTabsClosed(),
      confirmUnload: (tab) => {
        this.tabs.activate(tab.id);
        return (
          dialog.showMessageBoxSync(this.window, {
            type: 'question',
            message: t('window.unsavedChanges'),
            detail: t('window.unsavedChangesDetail'),
            buttons: [t('window.stay'), t('window.leave')],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          }) === 1
        );
      },
      freezeBackground: () => app.settings.get().discardAfterMinutes > 0,
      pinnedTabsStayHome: () => app.settings.get().pinnedTabsStayHome,
      pictureInPicture: () => app.settings.get().pictureInPicture,
      spaceIds: () => this.spaces().map((space) => space.id),
      spaceSeed: (id) => app.workspaces.open(id),
      spaceSession: (id) => app.spaceSession(id),
      onChange: (persist) => {
        this.syncAgentProjectWithTab();
        this.syncExtensionSidePanel();
        if (this.htmlFullScreenTabId && this.htmlFullScreenTabId !== this.tabs.activeTabId) {
          this.htmlFullScreenTabId = null;
          this.syncPageFullScreen();
        }
        const target = this.findTarget;
        if (target && (target.tabId !== this.tabs.activeTabId || target.url !== withoutHash(this.tabs.activeUrl))) {
          this.endFind();
        }
        this.peek.closeUnless(this.peekOwner());
        this.floatingChat.keepOnTop();
        this.peek.keepOnTop();
        this.findBar.keepOnTop(this.window);
        this.commandBar.keepOnTop(this.window);
        app.confirmDialog.keepOnTop(this.window);
        this.pushState();
        app.onWindowChange(persist);
      },
      onPageSwipe: (direction) => this.navigateByGesture(direction, 'page'),
      onNewTabSearch: (query) => {
        if (query.trim() === '') this.openAddress();
        else this.tabs.navigate(resolveInput(query, app.searchEngine()));
      },
      onRepoPrompt: (action) => app.repoPrompt.respond(action),
      onUpdateCard: (action) => {
        if (action === 'install') app.installUpdate();
        else app.dismissUpdate();
      },
      onHtmlFullScreenChange: (tabId, fullScreen) => {
        if (fullScreen) {
          if (tabId !== this.tabs.activeTabId || this.htmlFullScreenTabId === tabId) return;
          this.htmlFullScreenTabId = tabId;
        } else {
          if (this.htmlFullScreenTabId !== tabId) return;
          this.htmlFullScreenTabId = null;
        }
        this.syncPageFullScreen();
      },
      onVisit: (url, title) => app.history.visit(url, title),
      onVisitTitle: (id, title) => app.history.setTitle(id, title),
      onVisitFavicon: (id, faviconUrl) => app.history.setFavicon(id, faviconUrl),
      onHistoryDelete: (id) => app.history.remove(id),
      onHistoryClear: () => {
        app.history.clear();
        app.clearClosedTabs();
      },
      isBookmarked: (url) => app.bookmarks.has(url),
      onPageCommand: (page, command, params, contents) => {
        if (page === 'bookmarks') {
          if (command === 'import') void importBookmarksWithDialog(this.window, app.importBookmarks);
          else if (command === 'export') void exportBookmarksWithDialog(this.window, app.bookmarks);
          else app.runBookmarksCommand(command, params);
        } else app.runDownloadsCommand(command, params, contents);
      },
      onFindResult: (result) => this.findBar.showResult(this.window, result),
      zoomFor: (url, isPrivate) => app.zoomFor(isPrivate).get(url),
      defaultZoom: () => app.settings.get().defaultZoom,
      hasOwnZoom: (url, isPrivate) => app.zoomFor(isPrivate).has(url),
      onZoom: (url, factor, isPrivate) => app.zoomFor(isPrivate).set(url, factor),
      hasCertificateException: (url) => app.certificates.hasException(url),
      certificateToken: (url) => app.certificates.tokenFor(url),
      onCertificateProceed: (token, url) => app.certificates.proceed(token, url),
      popupsAllowed: (url, isPrivate, browsing) => {
        const origin = permissionOrigin(url);
        return origin !== null && app.permissionsFor(browsing, isPrivate)?.get(origin, 'popups') === 'allow';
      },
      upgradeHttp: (url) => app.httpsOnly.upgrade(url),
      httpsOnlyWarning: (https, http) => app.httpsOnly.warn(https, http),
      onProceedHttp: (token, currentUrl) => app.httpsOnly.proceed(token, currentUrl),
      threatGuard: app.threatGuard,
      confirmHttpRedirect: async (url) => {
        const { response } = await dialog.showMessageBox(this.window, {
          type: 'warning',
          message: t('window.httpRedirectMessage'),
          detail: t('window.httpRedirectDetail', { host: new URL(url).host }),
          buttons: [t('window.goBack'), t('window.continueWithHttp')],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (response === 1) app.httpsOnly.allowHost(url);
        return response === 1;
      },
      onContextMenu: (contents, params) => this.showContextMenu(contents, params),
      onPeek: (url, isPrivate, developer) => this.peek.open(url, isPrivate, this.peekOwner(), developer),
      requestRules: () => app.requestRules.list(),
      translation: () => ({
        enabled: app.settings.get().pageTranslation,
        language: getLocale(),
      }),
      agentScope: (tab) => app.agentScope(tab.url, tab.isPrivate && !this.isDeveloper),
      agentTracing: () => app.settings.get().agentBridge && app.settings.get().agentTracing,
    });

    this.sidePanel = new ExtensionSidePanel({
      window: this.window,
      session: app.daily,
      onOpenUrl: (url) => this.tabs.open(url, { isPrivate: false }),
      onResize: () => {
        if (this.window.isDestroyed()) return;
        const { width, height } = this.window.getContentBounds();
        this.placePage(width, height);
      },
    });

    this.peek = new LinkPeek({
      window: this.window,
      page: rendererPath('peek.html'),
      area: () => this.pageArea,
      createOverlay: () => createOverlayView(preloadPath('peek-preload')),
      createPageView: (isPrivate, developer) => this.tabs.createPageView(isPrivate, developer),
      upgradeHttp: (url) => app.httpsOnly.upgrade(url),
      onPromote: (page) => this.tabs.adoptView(page.view, page),
      onClosed: () => {
        if (this.window.isDestroyed()) return;
        if (!this.tabs.focusActive()) this.uiContents.focus();
      },
    });
    this.navigationHint = new NavigationHint({ window: this.window, area: () => this.pageArea });
    this.tooltip = new TooltipOverlay(this.window);
    this.preview = new HoverPreview(this.window, (choice) => this.openFromPreview(choice));
    this.notice = new PageNotice({ window: this.window, area: () => this.pageArea });
    this.agentControl = new AgentControl({
      window: this.window,
      area: () => this.pageArea,
      labels: () => ({ inControl: t('agentActions.inControl'), stop: t('agentActions.stop') }),
    });
    this.window.on('focus', () => app.onWindowFocus(this));
    if (process.platform === 'darwin') {
      this.window.on('swipe', (_event, direction) => {
        if (direction === 'right') this.navigateByGesture('back', 'native');
        else if (direction === 'left') this.navigateByGesture('forward', 'native');
      });
    }
    let fullScreen = this.window.isFullScreen();
    hideFullScreenTitlebar();
    this.rememberMenuBarHeight();
    const syncFullScreen = () => {
      this.rememberMenuBarHeight();
      this.watchMenuBar();
      this.applyLayout();
      if (this.window.isFullScreen() === fullScreen) return;
      fullScreen = !fullScreen;
      this.pushState();
    };
    this.window.on('resize', syncFullScreen);
    this.uiContents.on('input-event', (_event, input) => {
      if (input.type === 'mouseDown') this.peek.close();
    });
    this.window.on('blur', () => {
      this.tooltip.hide();
      this.preview.hide();
    });
    this.window.on('resize', () => {
      this.tooltip.hide();
      this.preview.hide();
    });
    this.window.on('enter-full-screen', syncFullScreen);
    this.window.on('leave-full-screen', syncFullScreen);
    this.window.on('minimize', () => this.watchMenuBar());
    this.window.on('restore', () => this.watchMenuBar());
    this.window.on('closed', () => this.stopMenuBarWatch());
    this.applyLayout();
    setTimeout(this.reveal, REVEAL_FALLBACK_MS);

    const syncTheme = () => {
      this.applyTitleBarTheme();
      this.pushState();
    };
    nativeTheme.on('updated', syncTheme);
    this.uiContents.once('did-finish-load', () => {
      this.glassApplied = this.glassApplied && applyGlass(this.window);
      this.pushState();
    });

    this.window.on('close', (event) => {
      const approve = this.closeApproval;
      this.closeApproval = null;
      if (!approve) {
        event.preventDefault();
        if (!this.closePending) {
          this.closePending = true;
          void this.tabs.confirmCloseAll().then((approval) => {
            this.closePending = false;
            if (approval && !this.window.isDestroyed()) {
              this.closeApproval ??= approval;
              this.window.close();
            }
          });
        }
        return;
      }
      if (!approve()) {
        event.preventDefault();
        return;
      }
      app.onWindowClosing(this);
      nativeTheme.off('updated', syncTheme);
      this.preconnector.cancel();
      for (const project of this.agentProjects) {
        project.dispose();
        app.releaseAgentConnection(project);
      }
      for (const comparison of this.visualComparisons.values()) comparison.clear();
      this.visualComparisons.clear();
      for (const scan of this.responsiveScans.values()) void scan.clear();
      this.responsiveScans.clear();
      const hadPrivate = this.tabs.hasPrivateTabs;
      const hadDeveloper = this.tabs.hasDeveloperTabs;
      this.sidePanel?.close();
      this.peek.close();
      this.tabs.destroyAll();
      this.commandBar.release(this.window);
      this.floatingChat.destroy();
      this.findBar.release(this.window);
      this.navigationHint.destroy();
      this.tooltip.destroy();
      this.preview.destroy();
      this.notice.destroy();
      this.agentControl.destroy();
      app.extensionPopup.close(this.window);
      if (!this.uiContents.isDestroyed()) this.uiContents.close();
      app.onWindowClosed(this);
      if (hadPrivate) app.onPrivateTabsClosed();
      if (hadDeveloper) app.onDeveloperTabsClosed();
    });

    this.updateProfileName();
    if (options.tab) this.tabs.adopt(options.tab);
    else if (options.saved && options.saved.tabs.length > 0)
      this.tabs.restore(options.saved, options.url, options.space);
    else this.tabs.open(options.url, { space: options.space });

    app.onWindowFocus(this);
  }

  private get commandBar(): CommandBar {
    return this.app.commandBar;
  }

  private get findBar(): FindBar {
    return this.app.findBar;
  }

  private navigateByGesture(direction: 'back' | 'forward', source: 'native' | 'page'): void {
    if (!this.app.settings.get().pageSwipe) return;
    const now = Date.now();
    const last = this.lastNavigationGesture;
    if (last && last.source !== source && last.direction === direction && now - last.at < 650) return;
    this.lastNavigationGesture = { source, direction, at: now };
    this.goInHistory(direction);
  }

  private goInHistory(direction: HistoryDirection): void {
    const moved = direction === 'back' ? this.tabs.goBack() : this.tabs.goForward();
    if (moved) this.navigationHint.show(direction);
  }

  isFocused(): boolean {
    return !this.window.isDestroyed() && this.window.isFocused();
  }

  get profile(): ProfileKind {
    return this.isDeveloper ? 'developer' : this.isPrivate ? 'private' : 'personal';
  }

  focus(): void {
    if (this.revealed && !this.window.isDestroyed()) this.window.focus();
  }

  readonly pushState = (): void => {
    if (this.pushQueued) return;
    this.pushQueued = true;
    setImmediate(() => {
      this.pushQueued = false;
      if (this.window.isDestroyed() || this.uiContents.isDestroyed()) return;
      this.placeFloatingChat();
      const serialized = JSON.stringify(this.state());
      if (serialized === this.lastPushedState) return;
      this.lastPushedState = serialized;
      this.uiContents.send(IpcChannel.state, serialized);
      this.floatingChat.contents?.send(IpcChannel.state, serialized);
    });
  };

  updateProfileName(): void {
    this.window.setTitle(
      `${this.webApp ? `${this.webApp.name} · ${new URL(this.webApp.startUrl).host}` : this.isDeveloper ? t('window.titleDeveloper') : this.isPrivate ? t('window.titlePrivate') : 'Yalqen'} · ${this.app.persistentProfiles.currentName()}`,
    );
  }

  state(): BrowserState {
    const tabState = this.tabs.state();
    for (const project of this.agentProjects) project.retainTabs(this.tabs.tabIds);
    return {
      ...tabState,
      spaces: this.isPrivate || this.webApp ? [] : [this.defaultSpace(), ...this.spaces()],
      developer: this.isDeveloper,
      pageFullScreen: this.isPageFullScreen(),
      windowFullScreen: this.window.isFullScreen(),
      windowMenu: !IS_MAC,
      panelCollapsed: this.app.settings.get().panelCollapsed,
      tabModes: this.app.settings.get().tabModes,
      bookmarksPanel: this.bookmarksPanelVisible ? this.bookmarksPanelView() : null,
      modeSwitch: this.tabs.canSwitchMode,
      tabCleanup: !this.webApp && this.app.settings.get().manualTabCleanup,
      favorites: this.webApp ? [] : this.app.favorites.list(),
      liveFolders: this.webApp || this.isPrivate ? [] : this.app.liveFolders.view(),
      sidebarVisible: !this.webApp,
      media: !this.webApp && this.app.settings.get().sidebarWidgets.includes('media') ? this.tabs.mediaState() : null,
      toolbarButtons: this.webApp ? ['settings', 'downloads'] : [...TOOLBAR_BUTTON_IDS],
      sidebarFooterItems: this.app.settings.get().sidebarFooterItems,
      material: this.material(),
      frameTheme: this.app.settings.get().frameTheme,
      accent: this.accent(),
      defaultZoom: this.app.settings.get().defaultZoom,
      downloads: this.app.downloads.summary(),
      extensions: !this.isPrivate,
      profile: this.profile,
      agentPanelOpen: this.agentPanelOpen,
      agentFloating: this.app.settings.get().agentFloating,
      agentSession: this.agentSession.state(),
      agentChat: this.agentChat.state(),
      agentProviders: this.agentProviders,
      projectRun: this.projectRunner.state(),
      agentElements: this.pickedElements,
      agentTerminal: this.app.settings.get().agentTerminal,
      agentProjects: this.agentProjects.map((project) => project.summary()),
      agentProjectId: this.activeProjectId,
      agentConversationId: this.agentProject.conversationId,
      agentBackgroundChats: this.agentProject.backgroundChats(),
      updateReady: this.app.updateReady(),
    };
  }

  openAgentPanel(): void {
    if (!this.agentPanelOpen) this.toggleAgentPanel();
  }

  private get bookmarksPanelVisible(): boolean {
    return this.bookmarksPanelOpen && this.app.settings.get().bookmarksPanel && !this.webApp;
  }

  toggleBookmarksPanel(): void {
    if (this.webApp) return;
    this.bookmarksPanelOpen = !this.bookmarksPanelVisible;
    if (this.bookmarksPanelOpen && this.agentPanelOpen) this.agentPanelOpen = false;
    this.pushState();
  }

  private bookmarksPanelView(): BookmarksPanelView {
    const bookmarks = this.app.bookmarks;
    if (this.bookmarksPanelCache?.revision === bookmarks.revision) return this.bookmarksPanelCache.view;
    const list = bookmarks.bookmarks();
    const domainOf = (url: string) => {
      try {
        return storageDomain(new URL(url).hostname);
      } catch {
        return '';
      }
    };
    const icons = siteIcons(this.app.history.list(), [...new Set(list.map((bookmark) => domainOf(bookmark.url)))]);
    const view: BookmarksPanelView = {
      folders: bookmarks.folders().map(({ id, title, parentId }) => ({ id, title, parentId })),
      bookmarks: list.map(({ id, title, url, folderId }) => ({
        id,
        title,
        url,
        folderId,
        icon: icons[domainOf(url)] ?? null,
      })),
    };
    this.bookmarksPanelCache = { revision: bookmarks.revision, view };
    return view;
  }

  toggleFullScreen(): void {
    this.window.setFullScreen(!this.window.isFullScreen());
  }

  // Full screen hides the menu bar and drops it from the work area, so measure it beforehand.
  private rememberMenuBarHeight(): void {
    if (!IS_MAC || this.window.isDestroyed() || this.window.isFullScreen()) return;
    const display = screen.getDisplayMatching(this.window.getBounds());
    const height = display.workArea.y - display.bounds.y;
    if (height > 0) this.menuBarHeight = height;
  }

  // How far the window slides when the menu bar is down; a notched display already keeps it above the window.
  private menuBarGoal(edge: number | null): number {
    const bounds = this.window.getBounds();
    const covered = bounds.y - screen.getDisplayMatching(bounds).bounds.y;
    return Math.max(0, this.menuBarHeight - covered, edge ?? 0);
  }

  private watchMenuBar(): void {
    // Not gated on focus: the screenshot tool takes focus while the menu bar is still down.
    if (!IS_MAC || this.window.isDestroyed() || !this.window.isFullScreen() || this.window.isMinimized()) {
      this.stopMenuBarWatch();
      return;
    }
    this.menuBarTimer ??= setInterval(() => {
      if (this.window.isDestroyed()) return this.stopMenuBarWatch();
      const edge = menuBarEdge(this.window);
      this.menuBarSlide = slideMenuBar(this.menuBarSlide, edge, this.menuBarGoal(edge));
      const inset = Math.round(this.menuBarSlide.inset);
      if (inset === this.menuBarInset) return;
      this.menuBarInset = inset;
      this.applyLayout();
    }, MENU_BAR_POLL_MS);
  }

  private stopMenuBarWatch(): void {
    if (this.menuBarTimer) clearInterval(this.menuBarTimer);
    this.menuBarTimer = null;
    this.menuBarSlide = RESTING_SLIDE;
    if (this.menuBarInset === 0) return;
    this.menuBarInset = 0;
    if (!this.window.isDestroyed()) this.applyLayout();
  }

  // The agent panel lives in the window UI, or in its own view while it floats over the page.
  private agentPanelContents(): Electron.WebContents | null {
    if (this.floatingChat.contents) return this.floatingChat.contents;
    return this.uiContents.isDestroyed() ? null : this.uiContents;
  }

  ownsAgentPanel(contents: Electron.WebContents): boolean {
    return contents === this.uiContents || this.floatingChat.owns(contents);
  }

  private placeFloatingChat(): void {
    if (this.window.isDestroyed()) return;
    const floating = this.agentPanelOpen && this.app.settings.get().agentFloating && !this.isPageFullScreen();
    if (floating) this.floatingChat.show(this.pageArea);
    else if (this.app.settings.get().agentFloating) this.floatingChat.hide();
    else this.floatingChat.destroy();
  }

  toggleAgentPanel(): void {
    if (!this.isDeveloper) return;
    this.agentPanelOpen = !this.agentPanelOpen;
    if (this.agentPanelOpen) {
      this.bookmarksPanelOpen = false;
      if (this.agentProject.directory)
        this.projectTabs.bind(this.tabs.snapshotFor(), this.activeProjectId, this.isDeveloper);
      this.placeFloatingChat();
      this.agentPanelContents()?.focus();
      void this.agentProject.chat.refreshModels();
      void availableProviders().then((providers) => {
        if (providers.length === this.agentProviders.length) return;
        this.agentProviders = providers;
        this.pushState();
      });
    } else this.tabs.focusActive();
    this.pushState();
  }

  async selectAgentDirectory(): Promise<ReturnType<AgentSession['state']>> {
    if ((this.isPrivate && !this.isDeveloper) || this.selectingAgentDirectory) return this.agentSession.state();
    this.selectingAgentDirectory = true;
    const project = this.agentProject;
    const tabId = this.tabs.activeTabId;
    try {
      const result = await dialog.showOpenDialog(this.window, {
        title: t('agentPanel.chooseProject'),
        defaultPath: this.agentSession.state().directory ?? app.getPath('documents'),
        properties: ['openDirectory'],
      });
      const directory = result.filePaths[0];
      if (this.window.isDestroyed() || result.canceled || !directory || this.agentProject !== project) {
        return this.agentSession.state();
      }
      const target = this.projectForDirectory(project, directory);
      if (!target) return this.agentSession.state();
      if (target.directory !== directory) {
        this.visualComparisons.get(target.id)?.clear();
        void this.responsiveScans.get(target.id)?.clear();
        target.selectDirectory(directory);
      }
      this.projectTabs.bind(this.tabs.snapshotFor(tabId), target.id, this.isDeveloper);
      if (target !== project) this.activateAgentProject(target.id);
    } finally {
      this.selectingAgentDirectory = false;
    }
    return this.agentSession.state();
  }

  private projectForDirectory(current: AgentProject, directory: string): AgentProject | null {
    if (current.directory === directory) return current;
    const existing = this.agentProjects.find((candidate) => candidate.directory === directory);
    if (existing) return existing;
    if (this.agentProjects.length >= MAX_AGENT_PROJECTS) return null;
    return this.addProject();
  }

  startAgentSession(size: unknown): Promise<ReturnType<AgentSession['state']>> {
    if (this.isPrivate && !this.isDeveloper) return Promise.resolve(this.agentSession.state());
    return this.agentSession.start(size);
  }

  private addPickedElement(selection: ElementSelection): void {
    if (this.isPrivate && !this.isDeveloper) return;
    this.setPickedElements([
      ...this.pickedElements.filter((element) => element.id !== selection.id),
      selectionRef(selection),
    ]);
    if (this.agentPanelOpen) this.pushState();
    else this.toggleAgentPanel();
  }

  private addPickedReference(tabId: string, reference: ReferenceCapture): void {
    if (this.isPrivate && !this.isDeveloper) return;
    const older = this.pickedElements.filter((element) => element.reference);
    const dropped = new Set(older.slice(0, Math.max(0, older.length - MAX_REFERENCES + 1)).map(({ id }) => id));
    this.references.set(reference.id, reference);
    this.setPickedElements([
      ...this.pickedElements.filter((element) => !dropped.has(element.id)),
      referenceRef(reference, tabId),
    ]);
    if (this.agentPanelOpen) this.pushState();
    else this.toggleAgentPanel();
  }

  private setPickedElements(elements: AgentElementRef[], projectId = this.activeProjectId): void {
    const picked = elements.slice(-MAX_PICKED_ELEMENTS);
    this.projectElements.set(projectId, picked);
    if (projectId === this.activeProjectId) this.pickedElements = picked;
    this.pruneAgentReferences();
  }

  private pruneAgentReferences(): void {
    const kept = new Set([...this.projectElements.values()].flat().map(({ id }) => id));
    for (const id of this.references.keys()) if (!kept.has(id)) this.references.delete(id);
  }

  removeAgentElement(id: unknown): void {
    this.setPickedElements(this.pickedElements.filter((element) => element.id !== id));
    this.pushState();
  }

  highlightAgentElement(id: unknown): Promise<boolean> {
    return typeof id === 'string' ? this.tabs.highlightSelection(id) : Promise.resolve(false);
  }

  startProjectRun(): boolean {
    if (this.isPrivate && !this.isDeveloper) return false;
    return this.projectRunner.start();
  }

  projectById(id: string): AgentProject | undefined {
    return this.agentProjects.find((project) => project.id === id);
  }

  get agentProject(): AgentProject {
    return this.projectById(this.activeProjectId) ?? this.agentProjects[0];
  }

  get agentSession(): AgentSession {
    return this.agentProject.session;
  }

  get projectRunner(): ProjectRunner {
    return this.agentProject.runner;
  }

  get agentChat(): AgentChat {
    return this.agentProject.chat;
  }

  projectIncludes(project: AgentProject, url: string): boolean {
    const others = this.agentProjects.filter((other) => other !== project).map((other) => other.origins);
    return projectIncludes(project.origins, others, url);
  }

  private addProject(): AgentProject {
    const isActive = (project: AgentProject) => project.id === this.activeProjectId;
    const project = new AgentProject({
      connect: (target) => this.app.agentConnection(this, target),
      preferences: this.app.chatPreferences,
      onState: this.pushState,
      onOutput: (target, output) => {
        if (isActive(target)) this.agentPanelContents()?.send(IpcChannel.agentOutput, output);
      },
      onChatUpdate: (target, serialized) => {
        if (isActive(target)) this.agentPanelContents()?.send(IpcChannel.agentChatUpdate, serialized);
      },
      onUrl: (target, url) => {
        const id = this.tabs.open(url, { activate: false });
        this.projectTabs.bind(this.tabs.snapshotFor(id), target.id, this.isDeveloper);
        target.shareConversation(id);
        this.tabs.activate(id);
      },
    });
    this.agentProjects.push(project);
    return project;
  }

  newAgentProject(): boolean {
    if ((this.isPrivate && !this.isDeveloper) || this.agentProjects.length >= MAX_AGENT_PROJECTS) return false;
    return this.selectAgentProject(this.addProject().id);
  }

  selectAgentProject(id: unknown): boolean {
    if (!this.agentProjects.some((project) => project.id === id)) return false;
    this.projectTabs.bind(this.tabs.snapshotFor(), id as string, this.isDeveloper);
    this.activateAgentProject(id as string);
    return true;
  }

  private syncAgentProjectWithTab(): void {
    this.closeAbandonedProjects();
    const tab = this.tabs.snapshotFor();
    const id = this.projectTabs.projectFor(tab, this.agentProjects, this.isDeveloper) ?? this.folderlessProject().id;
    if (id !== this.activeProjectId) this.activateAgentProject(id);
    else if (this.agentProject.focusTab(tab?.id ?? '')) this.showAgentChat();
  }

  newAgentChat(): void {
    if (this.isPrivate && !this.isDeveloper) return;
    const chat = this.agentChat;
    if (this.agentProject.setAsideChat()) this.showAgentChat();
    else if (!['starting', 'thinking', 'approval'].includes(chat.state().status)) chat.reset(chat.state().id);
  }

  async continueAgentChatInProject(id: unknown): Promise<boolean> {
    if (typeof id !== 'string' || (this.isPrivate && !this.isDeveloper) || this.selectingAgentDirectory) return false;
    const source = this.agentProject;
    const chat = source.backgroundChat(id);
    if (!chat) return false;
    this.selectingAgentDirectory = true;
    try {
      const result = await dialog.showOpenDialog(this.window, {
        title: t('backgroundChats.continueIn'),
        defaultPath: source.directory ?? app.getPath('documents'),
        properties: ['openDirectory'],
      });
      const directory = result.filePaths[0];
      if (this.window.isDestroyed() || result.canceled || !directory) return false;
      const target = this.projectForDirectory(source, directory);
      if (!target) return false;
      if (target.directory !== directory) target.selectDirectory(directory);
      const digest = chatDigest(chat.snapshot().messages, {
        user: t('backgroundChats.digestUser'),
        assistant: t('backgroundChats.digestAssistant'),
        omitted: t('backgroundChats.digestOmitted'),
      });
      const text = t('backgroundChats.continuePrompt', {
        from: source.directory ?? t('backgroundChats.noProject'),
        digest,
      });
      const tabId = this.tabs.open(NEW_TAB_URL, { activate: false });
      this.projectTabs.bind(this.tabs.snapshotFor(tabId), target.id, this.isDeveloper);
      const sent = await target.startChat(tabId, text);
      this.tabs.activate(tabId);
      return sent;
    } finally {
      this.selectingAgentDirectory = false;
    }
  }

  showBackgroundAgentChat(id: unknown): boolean {
    if (typeof id !== 'string' || !this.agentProject.showBackgroundChat(id)) return false;
    this.showAgentChat();
    return true;
  }

  openBackgroundAgentChatInTab(id: unknown): boolean {
    if (typeof id !== 'string' || (this.isPrivate && !this.isDeveloper)) return false;
    const project = this.agentProject;
    const tabId = this.tabs.open(NEW_TAB_URL, { activate: false });
    if (!project.moveBackgroundChat(id, tabId)) {
      this.tabs.close(tabId);
      return false;
    }
    if (project.directory) this.projectTabs.bind(this.tabs.snapshotFor(tabId), project.id, this.isDeveloper);
    this.tabs.activate(tabId);
    return true;
  }

  dismissBackgroundAgentChat(id: unknown): boolean {
    if (typeof id !== 'string' || !this.agentProject.dismissBackgroundChat(id)) return false;
    this.pushState();
    return true;
  }

  private folderlessProject(): AgentProject {
    return this.agentProjects.find((project) => !project.directory) ?? this.addProject();
  }

  private closeAbandonedProjects(): void {
    for (const id of this.projectTabs.release((tabId) => this.tabs.snapshotFor(tabId) !== null)) {
      const project = this.agentProjects.find((candidate) => candidate.id === id);
      if (project?.directory) this.disposeProject(project);
    }
  }

  private showAgentChat(): void {
    this.agentPanelContents()?.send(IpcChannel.agentChatUpdate, JSON.stringify(this.agentChat.snapshot()));
    this.pushState();
  }

  private activateAgentProject(id: string): void {
    if (id !== this.activeProjectId) void this.responsiveScans.get(this.activeProjectId)?.cancel();
    this.activeProjectId = id;
    this.agentProject.focusTab(this.tabs.activeTabId ?? '');
    this.pickedElements = this.projectElements.get(id) ?? [];
    this.showAgentChat();
  }

  closeAgentProject(id: unknown): boolean {
    const project = this.agentProjects.find((candidate) => candidate.id === id);
    if (!project || project.busy || this.agentProjects.length === 1) return false;
    const index = this.agentProjects.indexOf(project);
    this.disposeProject(project);
    if (this.activeProjectId === project.id)
      return this.selectAgentProject(this.agentProjects[Math.min(index, this.agentProjects.length - 1)].id);
    this.pushState();
    return true;
  }

  private disposeProject(project: AgentProject): void {
    this.agentProjects.splice(this.agentProjects.indexOf(project), 1);
    this.projectTabs.removeProject(project.id);
    this.projectElements.delete(project.id);
    this.pruneAgentReferences();
    this.visualComparisons.get(project.id)?.clear();
    this.visualComparisons.delete(project.id);
    void this.responsiveScans.get(project.id)?.clear();
    this.responsiveScans.delete(project.id);
    project.dispose();
    this.app.releaseAgentConnection(project);
  }

  selectAgentProvider(provider: unknown): boolean {
    if (
      (this.isPrivate && !this.isDeveloper) ||
      !isAgentProvider(provider) ||
      !this.agentProviders.includes(provider) ||
      !this.agentProject.selectProvider(provider)
    )
      return false;
    this.agentPanelContents()?.send(IpcChannel.agentChatUpdate, JSON.stringify(this.agentChat.snapshot()));
    this.pushState();
    return true;
  }

  searchAgentFiles(query: unknown): Promise<string[]> {
    const directory = this.agentChat.state().directory;
    if ((this.isPrivate && !this.isDeveloper) || typeof query !== 'string' || query.length > 200 || !directory)
      return Promise.resolve([]);
    return this.projectFiles.search(directory, query);
  }

  async openAgentFile(file: unknown): Promise<boolean> {
    const directory = this.agentChat.state().directory;
    if ((this.isPrivate && !this.isDeveloper) || typeof file !== 'string' || !directory || !path.isAbsolute(file))
      return false;
    try {
      const [real, root] = await Promise.all([fs.realpath(file), fs.realpath(directory)]);
      if (!real.startsWith(root + path.sep) || !(await fs.stat(real)).isFile()) return false;
      await openAsText(real);
      return true;
    } catch {
      return false;
    }
  }

  async signInAgent(): Promise<boolean> {
    if ((this.isPrivate && !this.isDeveloper) || this.signingIn) return false;
    const chat = this.agentChat;
    this.signingIn = true;
    try {
      const signedIn = await signIn(chat.state().provider, (url) => this.tabs.open(url));
      if (signedIn) chat.signedIn();
      return signedIn;
    } finally {
      this.signingIn = false;
    }
  }

  async signOutAgent(): Promise<boolean> {
    if ((this.isPrivate && !this.isDeveloper) || this.signingIn) return false;
    const chat = this.agentChat;
    const { provider, status } = chat.state();
    if (['starting', 'thinking', 'approval'].includes(status)) return false;
    const agent = AGENT_LABELS[provider];
    const { response } = await dialog.showMessageBox(this.window, {
      type: 'question',
      message: t('agentChat.signOutConfirm', { agent }),
      detail: t('agentChat.signOutDetail', { agent }),
      buttons: [t('agentChat.signOut'), t('agentChat.cancel')],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (response !== 0) return false;
    this.signingIn = true;
    try {
      const signedOut = await signOut(provider);
      if (signedOut) chat.signedOut();
      return signedOut;
    } finally {
      this.signingIn = false;
    }
  }

  async fixAgentEpisode(tabId: unknown): Promise<boolean> {
    if (this.isPrivate && !this.isDeveloper) return false;
    const tab =
      typeof tabId === 'string' ? this.state().tabs.find((entry) => entry.id === tabId && entry.agentObserved) : null;
    if (!tab?.agentEpisode) return false;
    if (!this.agentPanelOpen) this.toggleAgentPanel();
    this.agentProject.claim(tab.url);
    return this.agentChat.send(
      this.agentChat.state().id,
      t('agentChat.fixPrompt', { id: tab.agentEpisode.id }),
      { id: tab.id, title: tab.title, url: tab.url, local: true },
      [],
      { episode: tab.agentEpisode },
    );
  }

  private visualComparisonTab(tabId: string): VisualComparisonTab | null {
    if (this.isPrivate && !this.isDeveloper) return null;
    const tab = this.tabs.snapshotFor(tabId);
    if (!tab) return null;
    return {
      tabId,
      url: tab.url,
      title: tab.title,
      isPrivate: tab.isPrivate && !tab.developer && !this.isDeveloper,
      observed: tab.agentObserved,
    };
  }

  private visualComparison(): VisualComparisonManager {
    const project = this.agentProject;
    const projectId = project.id;
    let comparison = this.visualComparisons.get(projectId);
    if (!comparison) {
      comparison = new VisualComparisonManager(
        async (tabId) => {
          const directory = project.directory;
          const tab = this.visualComparisonTab(tabId);
          const contents = this.tabs.activeContents();
          if (!tab || this.tabs.activeTabId !== tabId || !contents || contents.isDestroyed())
            throw new VisualComparisonError('unavailable');
          if (contents.isLoadingMainFrame()) throw new VisualComparisonError('busy');
          if (pageWorkBusy(contents)) throw new VisualComparisonError('busy');
          const capture = await captureVisualPage(contents);
          if (this.tabs.activeTabId !== tabId || this.agentProject !== project || project.directory !== directory)
            throw new VisualComparisonError('stale');
          if (contents.isDestroyed() || contents.isLoadingMainFrame()) throw new VisualComparisonError('navigation');
          return { ...tab, ...capture };
        },
        (tabId) => this.visualComparisonTab(tabId),
      );
      this.visualComparisons.set(projectId, comparison);
    }
    return comparison;
  }

  getVisualComparison(): ReturnType<VisualComparisonManager['preview']> {
    if (this.isPrivate && !this.isDeveloper) return null;
    return this.visualComparisons.get(this.agentProject.id)?.preview() ?? null;
  }

  captureVisualComparison(stage: unknown, tabId: unknown): ReturnType<VisualComparisonManager['capture']> {
    if ((stage !== 'before' && stage !== 'after') || typeof tabId !== 'string')
      return Promise.reject(new VisualComparisonError('unavailable'));
    return this.visualComparison().capture(stage, tabId);
  }

  clearVisualComparison(): void {
    this.visualComparisons.get(this.agentProject.id)?.clear();
  }

  getVisualComparisonReview(): ReturnType<VisualComparisonManager['review']> {
    if (this.isPrivate && !this.isDeveloper) return null;
    return this.visualComparisons.get(this.agentProject.id)?.review() ?? null;
  }

  private responsiveScan(): ResponsiveScanManager {
    const project = this.agentProject;
    let scan = this.responsiveScans.get(project.id);
    if (!scan) {
      scan = new ResponsiveScanManager({
        readTab: (tabId) => this.visualComparisonTab(tabId),
        createSession: async (tabId, checkTab) => {
          const found = this.tabs.observedTab(tabId);
          if (!found || this.tabs.activeTabId !== tabId) throw new ResponsiveScanError('unavailable');
          const { contents, tab } = found;
          const release = acquirePageWork(contents);
          if (!release) throw new ResponsiveScanError('busy');
          const directory = project.directory;
          const emulation = tab.emulation;
          const zoom = contents.getZoomFactor();
          const url = contents.getURL();
          const area = { ...this.pageArea };
          let navigated = false;
          const onNavigation = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>): void => {
            if (event.isMainFrame) navigated = true;
          };
          contents.on('did-start-navigation', onNavigation);
          const guard = (): void => {
            checkTab();
            if (contents.isDestroyed() || navigated || contents.isLoadingMainFrame())
              throw new ResponsiveScanError('navigation');
            if (
              this.tabs.activeTabId !== tabId ||
              this.tabs.activeContents() !== contents ||
              this.agentProject !== project ||
              project.directory !== directory
            )
              throw new ResponsiveScanError('stale');
            if (
              tab.emulation !== emulation ||
              contents.getZoomFactor() !== zoom ||
              this.pageArea.width !== area.width ||
              this.pageArea.height !== area.height
            )
              throw new ResponsiveScanError('viewport');
            if (['starting', 'thinking', 'approval'].includes(project.chat.state().status))
              throw new ResponsiveScanError('busy');
          };
          const cleanup = (): void => {
            contents.off('did-start-navigation', onNavigation);
            release();
          };
          try {
            const session = await createResponsiveScanSession(contents, {
              guard,
              restoreMetrics: () => this.tabs.restoreViewport(tabId, contents),
              canRestoreScroll: () =>
                !contents.isDestroyed() &&
                !navigated &&
                !contents.isLoadingMainFrame() &&
                this.tabs.observedTab(tabId)?.contents === contents &&
                contents.getURL() === url,
            });
            return {
              scan: (viewport, signal) => session.scan(viewport, signal),
              restore: async () => {
                try {
                  await session.restore();
                } finally {
                  cleanup();
                }
              },
            };
          } catch (error) {
            cleanup();
            throw error;
          }
        },
      });
      this.responsiveScans.set(project.id, scan);
    }
    return scan;
  }

  getResponsiveScan(): ReturnType<ResponsiveScanManager['preview']> {
    if (this.isPrivate && !this.isDeveloper) return null;
    return this.responsiveScans.get(this.agentProject.id)?.preview() ?? null;
  }

  runResponsiveScan(tabId: unknown): ReturnType<ResponsiveScanManager['run']> {
    if (typeof tabId !== 'string' || (this.isPrivate && !this.isDeveloper))
      return Promise.reject(new ResponsiveScanError('unavailable'));
    if ([...this.responsiveScans.values()].some((scan) => scan.running))
      return Promise.reject(new ResponsiveScanError('busy'));
    return this.responsiveScan().run(tabId);
  }

  async cancelResponsiveScan(): Promise<void> {
    await Promise.all([...this.responsiveScans.values()].filter((scan) => scan.running).map((scan) => scan.cancel()));
  }

  async clearResponsiveScan(): Promise<void> {
    await this.responsiveScans.get(this.agentProject.id)?.clear();
  }

  getResponsiveScanReview(): ReturnType<ResponsiveScanManager['review']> {
    if (this.isPrivate && !this.isDeveloper) return null;
    return this.responsiveScans.get(this.agentProject.id)?.review() ?? null;
  }

  async sendAgentChat(id: unknown, text: unknown, tabIds: unknown, images?: unknown): Promise<boolean> {
    if (this.isPrivate && !this.isDeveloper) return false;
    const project = this.agentProject;
    const chat = project.chat;
    const directory = project.directory;
    const sessionId = chat.state().id;
    const elements = this.pickedElements;
    const references = elements
      .map((element) => this.references.get(element.id))
      .filter((reference) => reference !== undefined);
    const contexts = resolveAgentContexts(tabIds, this.state().tabs, this.isDeveloper);
    if (!contexts) return false;
    const pages: Record<string, PageText> = Object.create(null);
    const external = contexts.filter((context) => !context.local);
    const capturedPages = await Promise.all(external.map((context) => this.tabs.pageText(context.id)));
    if (capturedPages.some((page) => !page)) return false;
    external.forEach((context, index) => {
      pages[context.id] = capturedPages[index]!;
    });
    const current = resolveAgentContexts(
      contexts.map((context) => context.id),
      this.state().tabs,
      this.isDeveloper,
    );
    if (
      this.agentProject !== project ||
      this.agentChat !== chat ||
      project.directory !== directory ||
      chat.state().id !== sessionId
    )
      return false;
    if (
      !current ||
      contexts.some((context, index) => context.url !== current[index].url || context.local !== current[index].local)
    )
      return false;
    for (const context of contexts) if (context.local) project.claim(context.url);
    const sent = await chat.send(id, text, contexts, elements, { images, pages, references });
    if (sent) {
      this.setPickedElements(
        (this.projectElements.get(project.id) ?? []).filter((element) => !elements.includes(element)),
        project.id,
      );
      this.pushState();
    }
    return sent;
  }

  setLayout(layout: ChromeLayout): void {
    const changed = (Object.keys(layout) as (keyof ChromeLayout)[]).filter((key) => layout[key] !== this.layout[key]);
    if (changed.length > 0) {
      this.layout = layout;
      if (changed.length === 1 && changed[0] === 'panelSlide') {
        const { width, height } = this.window.getContentBounds();
        this.placePage(width, height);
      } else {
        this.applyLayout();
      }
    }
    this.revealWhenPainted();
  }

  private revealWhenPainted(): void {
    if (this.revealPending || this.revealed) return;
    this.revealPending = true;
    this.uiContents.setBackgroundThrottling(false);
    void this.uiContents.executeJavaScript(FIRST_PAINT_SCRIPT).then(this.reveal, this.reveal);
  }

  private reveal = (): void => {
    if (this.revealed || this.window.isDestroyed()) return;
    this.revealed = true;
    this.window.show();
    if (!this.uiContents.isDestroyed()) this.uiContents.setBackgroundThrottling(true);
  };

  openAddress(): void {
    const url = this.tabs.activeUrl;
    if (url === NEW_TAB_URL && this.focusNewTabSearch()) return;
    this.preconnector.opened(this.app.searchEngine());
    this.commandBar.open(this.commandHost, {
      placeholder: this.app.searchEngine().placeholder,
      mode: 'navigate',
      value: url === NEW_TAB_URL || url === 'about:blank' ? '' : url,
      engines: SEARCH_ENGINES.map(({ id, label }) => ({ id, label })),
      material: this.material(),
      accent: this.accent(),
      tint: this.menuTint(),
      area: this.pageArea,
    });
    if (!this.tabs.activeIsPrivate) setImmediate(() => this.app.history.index());
  }

  menuTint(): string | null {
    const state = this.state();
    const theme = state.spaces.find((space) => space.id === state.activeSpaceId)?.theme ?? state.frameTheme;
    return theme?.colors[0] ?? null;
  }

  async openSidebarMenu(kind: SidebarMenuKind, anchor: AnchorRect, footer: AnchorRect | null = null): Promise<void> {
    const state = this.state();
    const persistent = this.profile !== 'private';
    this.sidebarMenuAnchor = anchor;
    const chats = kind === 'chats' ? await this.agentChat.history().catch(() => []) : [];
    this.commandBar.open(this.commandHost, {
      placeholder: t('sidebarMenu.search'),
      mode: 'sidebar-menu',
      engines: [],
      material: this.material(),
      accent: this.accent(),
      menu: {
        kind,
        anchor,
        tint: this.menuTint(),
        // Pinned tabs already sit in the tiles above the list.
        tabs: state.tabs
          .filter((tab) => !tab.pinned)
          .map(({ id, title, url, faviconUrl }) => ({ id, title, url, faviconUrl })),
        spaces: state.spaces.map(({ id, name, icon }) => ({ id, name, icon, active: id === state.activeSpaceId })),
        chats,
        commands: [
          'history',
          'bookmarks',
          'downloads',
          'extensions',
          ...(state.activeTabId ? (['screenshot'] as const) : []),
          'settings',
          'profile',
          ...(state.spaces.length > 0 ? (['create-space', 'edit-space'] as const) : []),
          ...(persistent ? (['import-space', 'export-spaces', 'add-live-folder'] as const) : []),
          ...(kind === 'downloads' ? (['downloads-all', 'downloads-folder'] as const) : []),
        ],
        downloadsActive: state.downloads.active,
        ...(kind === 'tabs' ? this.sidebarMenuLinks() : { history: [], bookmarks: [] }),
        footer: footer ? { rect: footer, items: this.app.settings.get().sidebarFooterItems } : null,
        downloads:
          kind === 'downloads'
            ? this.app.downloads
                .list()
                .slice(0, SIDEBAR_MENU_LINKS)
                .map((entry) => ({ id: entry.id, filename: entry.filename, status: downloadStatus(entry) }))
            : [],
      },
    });
  }

  private sidebarMenuLinks(): Pick<SidebarMenu, 'history' | 'bookmarks'> {
    const visits = this.profile === 'private' ? [] : this.app.history.list();
    const favicons = new Map(visits.map((visit) => [visit.url, visit.faviconUrl ?? null]));
    const seen = new Set<string>();
    const history = visits
      .filter(({ url }) => !seen.has(url) && seen.add(url))
      .slice(0, SIDEBAR_MENU_LINKS)
      .map(({ url, title, faviconUrl }) => ({ url, title, faviconUrl: faviconUrl ?? null }));
    const bookmarks = this.app.bookmarks
      .bookmarks()
      .slice(0, SIDEBAR_MENU_LINKS)
      .map(({ url, title }) => ({ url, title, faviconUrl: favicons.get(url) ?? null }));
    return { history, bookmarks };
  }

  private runSidebarCommand(command: SidebarMenuCommand): void {
    if (command === 'downloads' || command === 'downloads-all' || command === 'downloads-folder') {
      const actions = this.app.downloadActions(this);
      if (command === 'downloads-all') actions.showAll();
      else if (command === 'downloads-folder') actions.openFolder();
      else void this.openSidebarMenu('downloads', this.sidebarMenuAnchor);
      return;
    }
    if (command === 'add-live-folder') {
      if (!this.uiContents.isDestroyed()) this.uiContents.send(IpcChannel.addLiveFolder);
      return;
    }
    const actions: Record<
      Exclude<SidebarMenuCommand, 'add-live-folder' | 'downloads' | 'downloads-all' | 'downloads-folder'>,
      UiAction
    > = {
      history: { type: 'open-history' },
      bookmarks: { type: 'toggle-bookmarks-panel' },
      extensions: { type: 'open-extensions-menu', anchor: this.sidebarMenuAnchor },
      screenshot: { type: 'dev-command', id: 'full-page-screenshot' },
      settings: { type: 'open-settings' },
      profile: { type: 'open-profile-menu' },
      'create-space': { type: 'create-space' },
      'edit-space': { type: 'open-space-menu', id: this.tabs.activeSpaceId },
      'import-space': { type: 'import-space' },
      'export-spaces': { type: 'export-spaces' },
    };
    this.handleAction(actions[command]);
  }

  private runDownloadAction(id: string): void {
    const entry = this.app.downloads.list().find((candidate) => candidate.id === id);
    const command = entry && downloadCommands(entry)[0];
    if (command) (this.app.downloadActions(this)[command[0]] as (id: string) => void)(id);
  }

  runDevCommand(id: DevCommandId): void {
    const tabs = this.tabs;
    const browsing = tabs.activeSession();
    const seconds = autoReloadSeconds(id);
    if (seconds) {
      tabs.setAutoReload(seconds);
      return;
    }
    const patch = overridePatch(id, tabs.activeOverrides());
    if (patch) {
      tabs.updateOverrides(patch);
      return;
    }
    switch (id) {
      case 'hard-reload':
        tabs.reloadIgnoringCache();
        break;
      case 'auto-reload-off':
        tabs.setAutoReload(null);
        break;
      case 'responsive':
        tabs.toggleResponsive();
        break;
      case 'screenshot':
        void this.saveScreenshot(false);
        break;
      case 'full-page-screenshot':
        void this.saveScreenshot(true);
        break;
      case 'capture-area':
        void this.captureArea();
        break;
      case 'copy-address':
        this.copyAddress('url');
        break;
      case 'copy-markdown':
        this.copyAddress('markdown');
        break;
      case 'copy-curl':
        this.copyAddress('curl');
        break;
      case 'pick-element':
        void this.pickElement();
        break;
      case 'devtools':
        tabs.toggleDevTools();
        break;
      case 'view-source':
        tabs.viewSource();
        break;
      case 'device':
        tabs.toggleEmulation(this.app.deviceId());
        break;
      case 'rotate-device':
        tabs.rotateDevice();
        break;
      case 'clear-cache':
        void browsing.clearCache().then(() => tabs.reloadIgnoringCache());
        break;
      case 'edit-request-rules':
        tabs.openSettings('developer');
        break;
      case 'developer-window':
        this.app.openWindow({ developer: true, from: this });
        break;
      case 'clear-site-data': {
        const origin = permissionOrigin(tabs.activeUrl);
        if (origin) void clearSiteData(browsing, origin).then(() => tabs.reloadIgnoringCache());
        break;
      }
    }
  }

  private focusNewTabSearch(): boolean {
    const contents = this.tabs.activeContents();
    if (!contents || contents.isDestroyed()) return false;
    contents.focus();
    contents
      .executeJavaScript("{ const field = document.getElementById('q'); field?.focus(); field?.select(); }")
      .catch(() => undefined);
    return true;
  }

  openFind(forward?: boolean): void {
    if (this.isPageFullScreen() || !this.tabs.activeTabId) return;
    this.commandBar.close(this.window);
    this.findTarget = { tabId: this.tabs.activeTabId, url: withoutHash(this.tabs.activeUrl) };
    if (forward === undefined) this.findBar.open(this.findHost);
    else this.findBar.findNext(this.findHost, forward);
  }

  goHome(): void {
    const { startupBehavior, startupUrls } = this.app.settings.get();
    this.tabs.navigate(startupPages(startupBehavior, startupUrls, false)[0] ?? NEW_TAB_URL);
  }

  print(contents = this.tabs.activeContents()): void {
    printPage(contents);
  }

  savePageAsPdf(): Promise<void> {
    return savePdfFile(this.window, this.tabs.activeContents());
  }

  savePageOffline(): Promise<void> {
    return saveOfflinePage(this.window, this.tabs.activeContents());
  }

  openLocalFiles(): Promise<void> {
    return openLocalFiles(this.window, (url) => this.tabs.open(url));
  }

  saveScreenshot(fullPage: boolean): Promise<void> {
    return saveScreenshotFile(this.window, this.tabs, fullPage);
  }

  agentActionWindow(): ActionWindow {
    return {
      tabs: this.tabs,
      confirm: async (action, detail) => {
        if (this.window.isDestroyed()) return false;
        this.focus();
        const { response } = await dialog.showMessageBox(this.window, {
          type: 'question',
          buttons: [t('agentActions.allow'), t('agentActions.deny')],
          defaultId: 1,
          cancelId: 1,
          message: t('agentActions.confirm', { action }),
          detail: [detail, t('agentActions.confirmDetail')].filter(Boolean).join('\n\n'),
        });
        return response === 0;
      },
      showControl: (onStop) => this.agentControl.show(onStop),
      hideControl: () => this.agentControl.hide(),
      showVerification: (verification) => this.notice.show(verificationLines(verification)),
    };
  }

  private async captureArea(): Promise<void> {
    const contents = this.tabs.activeContents();
    if (!contents || this.capturingArea) return;
    this.capturingArea = true;
    try {
      contents.focus();
      this.notice.show([t('capture.start'), t('picker.cancelHint')]);
      const selection: unknown = await contents.executeJavaScriptInIsolatedWorld(
        CAPTURE_AREA_WORLD_ID,
        [{ code: CAPTURE_AREA_SCRIPT }],
        true,
      );
      const rect = captureRect(selection, contents.getZoomFactor());
      if (!rect || contents.isDestroyed()) return;
      const image = await contents.capturePage(rect);
      if (image.isEmpty()) return;
      await clipboard.write([
        new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image.toPNG())], { type: 'image/png' }) }),
      ]);
      this.notice.show([t('capture.copied')]);
    } catch (error) {
      console.warn('[capture] could not capture the area:', error);
    } finally {
      this.capturingArea = false;
    }
  }

  private async pickElement(): Promise<void> {
    if (this.tabs.isPicking) {
      this.tabs.cancelPicking();
      return;
    }
    const picking = this.tabs.pickElement(this.app.settings.get().agentBridge);
    if (this.tabs.isPicking) this.notice.show([t('picker.start'), t('picker.cancelHint')]);
    const outcome = await picking;
    switch (outcome.status) {
      case 'picked': {
        const { id, label, component: react } = outcome.selection;
        clipboard.writeText(id);
        this.addPickedElement(outcome.selection);
        const detail = react.source ? formatLocation(react.source) : react.component ? label : null;
        this.notice.show(
          [t('picker.selected', { label: react.component ?? label }), detail, t('picker.copied', { id })].filter(
            (line) => line !== null,
          ),
        );
        break;
      }
      case 'referenced':
        this.addPickedReference(outcome.tabId, outcome.reference);
        this.notice.show([t('picker.referenced', { label: outcome.reference.label }), t('picker.referenceHint')]);
        break;
      case 'agent-off':
        this.notice.show([t('picker.off')]);
        break;
      case 'not-local':
        this.notice.show([t('picker.notLocal')]);
        break;
      case 'failed':
        this.notice.show([t('picker.failed')]);
        break;
    }
  }

  showNotice(lines: string[]): void {
    this.notice.show(lines);
  }

  async pickOnPage<T>(read: PageReader<T>): Promise<{ url: string; value: T } | null> {
    if (this.tabs.isPicking) {
      this.tabs.cancelPicking();
      return null;
    }
    const picking = this.tabs.pickPage(read);
    if (this.tabs.isPicking) this.notice.show([t('pagePicker.start'), t('picker.cancelHint')]);
    const outcome = await picking;
    if (outcome.status === 'picked') return outcome;
    if (outcome.status === 'failed') this.notice.show([t('picker.failed')]);
    if (outcome.status === 'unavailable') this.notice.show([t('pagePicker.unavailable')]);
    return null;
  }

  private copyAddress(format: AddressFormat, page = this.tabs.activePage()): void {
    if (page && canViewSource(page.url)) {
      clipboard.writeText(formatAddress(format, page.url, page.title, this.app.settings.get().stripTrackingOnCopy));
    }
  }

  moveActiveTabToNewWindow(): void {
    const id = this.tabs.activeTabId;
    const tab = id ? this.tabs.detach(id) : null;
    if (tab) this.app.openWindow({ tab, isPrivate: this.isPrivate, developer: this.isDeveloper, from: this });
  }

  close(): void {
    if (!this.window.isDestroyed()) this.window.close();
  }

  setCloseApproval(approval: CloseApproval | null): void {
    this.closeApproval = approval;
  }

  handleAction(action: UiAction): void {
    if (this.webApp && ['new-tab', 'open-settings', 'open-history'].includes(action.type)) {
      this.app.openWindow({ from: this }).handleAction(action);
      return;
    }
    const tabs = this.tabs;
    const app = this.app;
    switch (action.type) {
      case 'new-tab':
        tabs.openInActiveMode(action.url);
        break;
      case 'set-tab-mode':
        if (isTabMode(action.mode) && tabs.activeTabId) void tabs.setMode(tabs.activeTabId, action.mode);
        break;
      case 'activate-tab':
        tabs.activate(action.id, action.animate === true);
        break;
      case 'switch-space':
        tabs.switchSpace(action.id);
        break;
      case 'create-space':
        this.createSpace();
        break;
      case 'import-space':
        if (this.isPrivate || this.webApp) break;
        void importSpaceWithDialog(this.window, (text) => {
          const file = parseSpaceFile(text);
          if (file?.isDefault) {
            this.tabs.importIntoSpace(file.window, DEFAULT_SPACE_ID);
            return DEFAULT_SPACE_ID;
          }
          const id = app.workspaces.importText(text);
          if (id) app.spacesChanged();
          return id;
        }).then((id) => id !== null && !this.window.isDestroyed() && this.tabs.switchSpace(id));
        break;
      case 'export-spaces':
        if (this.isPrivate || this.webApp) break;
        void exportSpacesWithDialog(this.window, this.spaceFiles());
        break;
      case 'open-space-menu':
        this.openSpaceMenu(action.id);
        break;
      case 'open-sidebar-context-menu':
        this.openSidebarContextMenu();
        break;
      case 'select-tab':
        tabs.selectTab(action.id, action.mode);
        break;
      case 'clear-tab-selection':
        tabs.clearSelection();
        break;
      case 'close-selected-tabs':
        void tabs.closeSelected();
        break;
      case 'clean-tabs':
        void tabs.closeIdle();
        break;
      case 'rename-tab-group':
        if (!tabs.renameGroup(action.name, action.next)) this.notice.show([t('tabGroups.failed')]);
        break;
      case 'toggle-tab-group':
        tabs.toggleGroup(action.name);
        break;
      case 'move-tab-to-group':
        tabs.setTabGroup(action.id, action.name);
        break;
      case 'move-tab-group':
        tabs.moveGroup(action.name, action.parent);
        break;
      case 'open-folder-menu':
        this.openFolderMenu(action.name);
        break;
      case 'add-live-folder':
        this.addLiveFolder(action.kind, action.input);
        break;
      case 'toggle-live-folder':
        if (!this.isPrivate && this.app.liveFolders.toggle(action.id)) this.app.liveFoldersChanged();
        break;
      case 'refresh-live-folder':
        if (!this.isPrivate) void this.app.liveFolderRefresher.refresh([action.id]);
        break;
      case 'open-live-folder-menu':
        this.openLiveFolderMenu(action.id);
        break;
      case 'open-live-item': {
        const url = this.isPrivate ? null : this.app.liveFolders.open(action.id, action.itemId);
        if (url) {
          tabs.openOrActivate(url);
          this.app.liveFoldersChanged();
        }
        break;
      }
      case 'close-tab':
        tabs.close(action.id);
        break;
      case 'toggle-mute':
        tabs.toggleMute(action.id);
        break;
      case 'toggle-media':
        tabs.toggleMedia(action.id);
        break;
      case 'show-tooltip': {
        const tooltip = validTooltip(action.tooltip);
        if (tooltip) this.tooltip.show(tooltip);
        break;
      }
      case 'show-preview':
        this.showPreview(action.preview);
        break;
      case 'leave-preview':
        this.preview.release();
        break;
      case 'hide-preview':
        this.preview.hide();
        break;
      case 'hide-tooltip':
        this.tooltip.hide();
        break;
      case 'seek-media':
        tabs.seekMedia(action.id, action.seconds);
        break;
      case 'skip-media':
        tabs.skipMedia(action.id, action.direction);
        break;
      case 'open-tab-menu':
        this.openTabMenu(action.id);
        break;
      case 'open-favorite':
        if (this.app.favorites.has(action.url)) tabs.openOrActivate(action.url);
        break;
      case 'open-favorite-menu':
        if (!this.isPrivate && this.app.favorites.has(action.url))
          this.popup([{ label: t('window.removeFavorite'), click: () => this.toggleFavorite(action.url) }]);
        break;
      case 'move-tab':
        tabs.move(action.id, action.toIndex);
        break;
      case 'move-row':
        tabs.moveRow(action.id, action.target, action.after === true);
        break;
      case 'preview-split':
        tabs.previewSplit(action.id, action.side);
        break;
      case 'split-tab':
        tabs.splitWithActive(action.id, action.side);
        break;
      case 'split-new-tab':
        tabs.splitWithNewTab();
        break;
      case 'split-into':
        tabs.splitInto(action.id, action.target);
        break;
      case 'navigate':
        tabs.navigate(resolveInput(action.input, app.searchEngine()));
        break;
      case 'go-home':
        this.goHome();
        break;
      case 'go-back':
        this.goInHistory('back');
        break;
      case 'go-forward':
        this.goInHistory('forward');
        break;
      case 'reload':
        tabs.reload();
        break;
      case 'resize-split':
        tabs.resizeSplit(action.index, action.x);
        break;
      case 'resize-devtools':
        tabs.resizeDevTools(action.x);
        break;
      case 'open-dev-menu': {
        const tab = tabs.snapshotFor();
        if (!tab) break;
        this.popup(
          devMenuTemplate(tab, {
            run: (id) => this.runDevCommand(id),
            copyEpisode: (id) => clipboard.writeText(t('devMenu.episodePrompt', { id })),
            fixEpisode: () => void this.fixAgentEpisode(tab.id),
            copyPlaywrightTest: (id) => {
              const source = tabs.agentPlaywrightTest(id);
              if (source) clipboard.writeText(source);
            },
          }),
        );
        break;
      }
      case 'dev-command':
        if (isDevCommandId(action.id)) this.runDevCommand(action.id);
        break;
      case 'resize-device':
        tabs.resizeDevice({ width: Number(action.width), height: Number(action.height) });
        break;
      case 'set-device-scale-factor':
        tabs.setDeviceScaleFactor(Number(action.value));
        break;
      case 'stop':
        tabs.stop();
        break;
      case 'reset-zoom':
        tabs.zoom(0);
        break;
      case 'open-blocked-popups': {
        const origin = permissionOrigin(tabs.activeUrl);
        const blocked = tabs.blockedPopups();
        if (!origin || blocked.length === 0) break;
        const template = blockedPopupsTemplate(new URL(origin).host, blocked, {
          open: (url) => tabs.openBlockedPopup(url),
          allowSite: () => {
            app.permissionsFor(tabs.activeSession(), tabs.activeIsPrivate)?.set(origin, ['popups'], 'allow');
            tabs.clearBlockedPopups();
          },
        });
        this.popup(template);
        break;
      }
      case 'open-site-info':
        void this.openSiteInfo();
        break;
      case 'toggle-panel':
        app.updateSettings({ panelCollapsed: !app.settings.get().panelCollapsed });
        break;
      case 'toggle-agent-panel':
        this.toggleAgentPanel();
        break;
      case 'set-agent-floating':
        if (typeof action.floating === 'boolean') app.updateSettings({ agentFloating: action.floating });
        break;
      case 'move-floating-chat':
        if (Number.isFinite(action.dx) && Number.isFinite(action.dy)) this.floatingChat.moveBy(action.dx, action.dy);
        break;
      case 'window-control':
        if (action.control === 'close') this.window.close();
        else if (action.control === 'exit-full-screen' && this.window.isFullScreen()) this.toggleFullScreen();
        break;
      case 'open-address':
        this.openAddress();
        break;
      case 'open-sidebar-menu':
        if (['tabs', 'chats', 'spaces', 'downloads'].includes(action.kind))
          void this.openSidebarMenu(
            action.kind,
            sanitizeAnchor(action.anchor),
            action.footer ? sanitizeAnchor(action.footer) : null,
          );
        break;
      case 'set-sidebar-footer-items':
        app.updateSettings({ sidebarFooterItems: sanitizeSidebarFooterItems(action.items, []) });
        break;
      case 'open-profile-menu':
        this.popup(
          profileMenuTemplate(
            {
              newWindow: () => app.openWindow({ from: this }),
              newPrivateWindow: () => app.openWindow({ isPrivate: true, from: this }),
              newPrivateTab: () => tabs.open(NEW_TAB_URL, { isPrivate: true }),
              newDeveloperWindow: () => app.openWindow({ developer: true, from: this }),
              openSettings: () => tabs.openSettings(),
            },
            {
              currentId: app.persistentProfiles.id,
              profiles: app.persistentProfiles.view().profiles,
              open: (id) => {
                void app.persistentProfiles.run('open', id, undefined).then(({ error }) => {
                  if (error)
                    void dialog.showMessageBox(this.window, { type: 'error', message: t(`profiles.${error}`) });
                });
              },
              manage: () => tabs.openSettings('advanced#profiles'),
            },
            {
              current: this.profile,
              switch: (profile) => {
                if (profile !== this.profile) app.switchProfile(profile, this);
              },
            },
          ),
        );
        break;
      case 'toggle-bookmark': {
        const page = tabs.activePage();
        if (page) app.toggleBookmark(page.url, page.title);
        break;
      }
      case 'toggle-bookmarks-panel':
        this.toggleBookmarksPanel();
        break;
      case 'open-bookmark':
        if (typeof action.url === 'string' && canBookmark(action.url)) tabs.openPage(action.url);
        break;
      case 'edit-bookmark':
        if ([action.id, action.title, action.url].every((value) => typeof value === 'string'))
          app.runBookmarksCommand(
            'rename',
            new URLSearchParams({ id: action.id, title: action.title, url: action.url.trim() }),
          );
        break;
      case 'rename-bookmark-folder':
        if (typeof action.id === 'string' && typeof action.title === 'string' && action.title.trim())
          app.runBookmarksCommand('rename-folder', new URLSearchParams({ id: action.id, title: action.title }));
        break;
      case 'open-bookmarks-page':
        tabs.openBookmarks();
        break;
      case 'open-bookmarks-menu':
        if (app.settings.get().bookmarksPanel && !this.webApp) {
          this.toggleBookmarksPanel();
          break;
        }
        this.popup(
          libraryMenuTemplate(app.bookmarks, {
            open: (url) => tabs.navigate(url),
            showAll: () => tabs.openBookmarks(),
            importBookmarks: (file) => void importBookmarksWithDialog(this.window, app.importBookmarks, file),
            importHistory: (file) => void importHistoryWithDialog(this.window, app.importHistory, file),
            exportBookmarks: () => void exportBookmarksWithDialog(this.window, app.bookmarks),
          }),
        );
        break;
      case 'install-update':
        app.installUpdate();
        break;
      case 'open-extensions-menu':
        this.openExtensionsMenu(sanitizeAnchor(action.anchor));
        break;
      case 'open-history':
        tabs.openHistory();
        break;
      case 'toggle-translation':
        tabs.toggleTranslation();
        break;
      case 'open-app-menu': {
        if (IS_MAC) break;
        const menu = Menu.getApplicationMenu();
        if (menu && !this.window.isDestroyed()) menu.popup({ window: this.window });
        break;
      }
      case 'open-settings':
        tabs.openSettings();
        break;
    }
  }

  private async openSiteInfo(): Promise<void> {
    const template = await siteInfoMenu({
      tabs: this.tabs,
      permissions: (browsing, isPrivate) => this.app.permissionsFor(browsing, isPrivate),
      session: () => this.tabs.activeSession(),
      certificates: this.app.certificates,
      protections:
        this.isDeveloper || this.tabs.activeMode === 'developer'
          ? undefined
          : {
              preferences: this.app.siteProtections,
              settings: () => this.app.settings.get(),
            },
      showCertificateDetails: () => {
        const id = this.tabs.activeTabId;
        const url = this.tabs.activeUrl;
        const current = () => this.tabs.activeTabId === id && this.tabs.activeUrl === url;
        void showCertificateDetails(this.window, url, this.tabs.certificateChain(), current);
      },
      clearSiteData: () => this.runDevCommand('clear-site-data'),
    });
    if (template && !this.window.isDestroyed()) this.popup(template);
  }

  private showPreview(value: unknown): void {
    const request = validPreviewRequest(value);
    if (!request || this.isPrivate) return;
    const key = `${request.tabId ?? ''} ${request.url}`;
    if (this.preview.isShowing(key)) {
      this.preview.keep();
      return;
    }
    const tab = this.tabs.previewTab(request.tabId, request.url);
    if (!tab) return;
    const read =
      this.isDeveloper || (tab.id && this.tabs.splitOf(tab.id))
        ? null
        : readPreview(tab, {
            session: (tab.id && this.tabs.tabSession(tab.id)) || this.app.daily,
            readInTab: (contents, code) => this.tabs.readForPreview(contents, code),
          });
    const card = tab.id ? this.tabCard(tab.id) : null;
    if (!read && !card) return;
    const ticket = this.preview.begin();
    void (read ?? Promise.resolve(null)).then((content) => {
      if (!this.preview.isCurrent(ticket)) return;
      this.previewShown = { tab, content };
      const view = content
        ? previewView(content, Date.now(), getLocale(), t)
        : { heading: null, items: [], message: null, footer: null };
      this.preview.show(ticket, key, card ? { ...view, tab: card } : view, request.anchor, request.theme);
    });
  }

  private tabCard(id: TabId): TabCard | null {
    const tab = this.tabs.snapshotFor(id);
    if (!tab) return null;
    const bookmarked = this.app.bookmarks.has(tab.url);
    const split = this.tabs.splitOf(id);
    const actions: TabCard['actions'] = [
      { id: 'pin', label: t(tab.pinned ? 'window.unpinTab' : 'window.pinTab'), on: tab.pinned, enabled: true },
      {
        id: 'bookmark',
        label: t(bookmarked ? 'toolbar.removeBookmarkTitle' : 'toolbar.addBookmarkTitle'),
        on: bookmarked,
        enabled: true,
      },
      {
        id: 'split',
        label: t(split ? 'window.exitSplitView' : 'window.openInSplitView'),
        on: !!split,
        enabled: !!split || this.tabs.canSplitWithActive(id),
      },
      { id: 'copy', label: t('devCommands.copyAddress'), on: false, enabled: canViewSource(tab.url) },
    ];
    const card: TabCard = { title: tab.title || tab.url, host: hostOf(tab.url) ?? tab.url, actions };
    if (!split) return card;
    if (this.isDeveloper) actions.push({ id: 'chat', label: t('newTab.chat'), on: false, enabled: true });
    const members = split.flatMap((member) => {
      const snapshot = this.tabs.snapshotFor(member);
      return snapshot ? [{ title: snapshot.title || snapshot.url, host: hostOf(snapshot.url) ?? snapshot.url }] : [];
    });
    return { ...card, members };
  }

  private runTabAction(id: TabId, action: TabAction): void {
    const tab = this.tabs.snapshotFor(id);
    if (!tab) return;
    const split = this.tabs.splitOf(id);
    if (action === 'pin' && split) {
      for (const member of [...split])
        if (this.tabs.snapshotFor(member)?.pinned === tab.pinned) this.tabs.togglePin(member);
    } else if (action === 'pin') this.tabs.togglePin(id);
    else if (action === 'chat') this.openAgentPanel();
    else if (action === 'bookmark') this.app.toggleBookmark(tab.url, tab.title);
    else if (action === 'split') {
      if (this.tabs.splitTabIds.includes(id)) this.tabs.unsplit(id);
      else this.tabs.splitWithActive(id);
    } else this.copyAddress('url', tab);
  }

  private openFromPreview(choice: PreviewChoice): void {
    const shown = this.previewShown;
    this.previewShown = null;
    if (!shown) return;
    const { tab, content } = shown;
    if (typeof choice === 'string' && choice !== 'tab') {
      if (tab.id) this.runTabAction(tab.id, choice);
      return;
    }
    const open = (url: string) => {
      if (tab.id) {
        this.tabs.activate(tab.id);
        if (url !== tab.url) this.tabs.navigate(url);
      } else {
        this.tabs.open(url, { isPrivate: false });
      }
    };
    if (content?.kind === 'mail' && typeof choice === 'number') {
      open(content.messages[choice]?.link ?? tab.url);
    } else if (content?.kind === 'calendar' && typeof choice === 'number' && tab.id && tab.contents) {
      const event = content.events[choice];
      this.tabs.activate(tab.id);
      if (event) void this.tabs.readForPreview(tab.contents, CALENDAR_OPEN_SCRIPT(event.id)).catch(() => {});
    } else {
      open(tab.url);
    }
  }

  get sidePanelExtension(): string | null {
    return this.sidePanel?.extensionId ?? null;
  }

  ownsExtensionSidePanel(contents: WebContents): boolean {
    return this.sidePanel?.owns(contents) ?? false;
  }

  openExtensionSidePanel(extensionId: string, url: string): WebContents | null {
    return this.isPrivate || !this.sidePanel ? null : this.sidePanel.open(extensionId, url);
  }

  closeExtensionSidePanel(extensionId: string): void {
    if (this.sidePanel?.extensionId === extensionId) this.sidePanel.close();
  }

  syncExtensionSidePanel(): void {
    const panel = this.sidePanel;
    const extensionId = panel?.extensionId;
    if (!panel || !extensionId) return;
    const tab = this.tabs.activeContents();
    const url = this.app.extensionBridge.sidePanelUrl(extensionId, tab);
    if (url) panel.open(extensionId, url);
    else panel.hide();
    this.app.extensionBridge.sidePanelTabSwitched(extensionId, this.window.id, tab, url);
  }

  private toggleExtensionSidePanel(extensionId: string): void {
    this.app.extensionBridge.toggleSidePanel(extensionId, this.window.id, this.tabs.activeContents());
  }

  openExtensionAction(extensionId: string): void {
    const action = this.extensionActions().find((candidate) => candidate.id === extensionId);
    if (this.isPrivate || !action) return;
    runAction(action, this.extensionActionHandlers(this.extensionActionAnchor()));
  }

  openExtensionActionPopup(url: string): void {
    if (!this.isPrivate) this.openExtensionPopup(url, this.extensionActionAnchor());
  }

  private extensionActionAnchor(): AnchorRect {
    const { width } = this.window.getContentBounds();
    return this.sidebarMenuAnchor.width > 0 ? this.sidebarMenuAnchor : { x: width, y: 0, width: 0, height: 0 };
  }

  private extensionActions() {
    const tab = this.tabs.activeContents();
    const bridge = this.app.extensionBridge;
    return this.app.extensions.actions().map((action) => {
      const state = action.id ? bridge.actionState(action.id, tab) : null;
      return {
        ...action,
        ...(state && { ...state, icon: withBadgeDot(state.icon ?? action.icon, state.badge, state.badgeColor) }),
        sidePanel: action.id && bridge.sidePanelUrl(action.id, tab) ? action.id : null,
        sidePanelOnAction: action.id ? bridge.opensSidePanelOnAction(action.id) : false,
      };
    });
  }

  private extensionActionHandlers(anchor: AnchorRect) {
    return {
      openPopup: (url: string) => this.openExtensionPopup(url, anchor),
      openOptions: (url: string) => this.tabs.open(url, { isPrivate: false }),
      clickAction: (id: string) => this.app.extensionBridge.actionClicked(id, this.tabs.activeContents()),
      toggleSidePanel: (id: string) => this.toggleExtensionSidePanel(id),
    };
  }

  private openExtensionPopup(url: string, anchor: AnchorRect): void {
    this.app.extensionPopup.open({
      window: this.window,
      session: this.app.daily,
      url,
      anchor,
      onOpenUrl: (target) => this.tabs.open(target, { isPrivate: false }),
    });
  }

  private openExtensionsMenu(anchor: AnchorRect): void {
    const openTab = (url: string) => this.tabs.open(url, { isPrivate: false });
    const template = extensionsMenuTemplate(this.extensionActions(), {
      ...this.extensionActionHandlers(anchor),
      sidePanelOpen: this.sidePanel?.extensionId ?? null,
      canRequestAccess: !this.isPrivate && !this.isDeveloper && /^https?:/.test(this.tabs.activeUrl),
      requestAccess: (directory) => {
        const contents = this.tabs.activeContents();
        const url = this.tabs.activeUrl;
        if (!contents || contents.session !== this.app.daily || this.isPrivate || this.isDeveloper) return;
        void this.app.extensionAccess
          .requestSite(
            directory,
            url,
            this.window,
            () =>
              !this.window.isDestroyed() &&
              !contents.isDestroyed() &&
              this.tabs.activeContents() === contents &&
              this.tabs.activeUrl === url,
          )
          .then((error) => {
            if (error && !this.window.isDestroyed())
              void dialog.showMessageBox(this.window, { type: 'info', message: error });
          });
      },
      openStore: () => openTab(STORE_HOME),
      manage: () => this.tabs.openSettings('extensions'),
    });
    Menu.buildFromTemplate(template).popup({
      window: this.window,
      x: Math.round(anchor.x),
      y: Math.round(anchor.y + anchor.height + 4),
    });
  }

  private openTabMenu(id: TabId): void {
    const tabs = this.tabs;
    const tab = tabs.snapshotFor(id);
    if (!tab) return;
    this.popup(
      tabMenuTemplate(
        tab,
        tabs.isShown(id),
        {
          togglePin: () => tabs.togglePin(id),
          toggleFavorite: () => this.toggleFavorite(tab.url, tab.title, tab.faviconUrl),
          toggleMute: () => tabs.toggleMute(id),
          discard: () => tabs.discard(id),
          close: () => tabs.close(id),
          duplicate: () => {
            tabs.duplicate(id);
          },
          closeOthers: () => {
            void tabs.closeRelated(id, 'others');
          },
          closeRight: () => {
            void tabs.closeRelated(id, 'right');
          },
          closeSelected: () => {
            void tabs.closeSelected();
          },
          muteSelected: () => tabs.toggleSelectedMute(),
          pinSelected: () => tabs.toggleSelectedPin(),
          splitWithActive: () => tabs.splitWithActive(id),
          unsplit: () => tabs.unsplit(id),
          splitSelected: () => tabs.splitSelected(),
          moveToFolder: (name) => tabs.setTabGroup(id, name),
          moveToNewFolder: () => tabs.setTabGroup(id, tabs.newGroupName(t('window.newFolderName'))),
        },
        {
          favorite: !this.isPrivate && this.app.favorites.has(tab.url),
          others: tabs.canCloseRelated(id, 'others'),
          right: tabs.canCloseRelated(id, 'right'),
          selected: tabs.selectedTabIds.includes(id) ? tabs.selectedTabIds.length : 0,
          splitWithActive: tabs.canSplitWithActive(id),
          inSplit: tabs.splitTabIds.includes(id),
          splitSelected: tabs.selectedTabIds.includes(id) && tabs.selectedTabIds.length <= MAX_SPLIT_PANES,
          folders: tabs.groupView().flatMap((group) => (group.name === tab.group ? [] : [group.name])),
        },
      ),
    );
  }

  private spaces(): SpaceView[] {
    return this.isPrivate || this.webApp ? [] : this.app.workspaces.spaces();
  }

  private accent(spaceId = this.tabs.activeSpaceId): string {
    const space = this.spaces().find(({ id }) => id === spaceId);
    return space?.theme?.colors[0] ?? accentHex(this.app.settings.get().accentColor);
  }

  private spaceFileText(id: string): string | null {
    const live = this.tabs.toSavedWindow(id);
    return this.app.workspaces.exportText(id, live.tabs.length ? live : null);
  }

  private spaceFiles(): { name: string; text: string | null }[] {
    const main = this.defaultSpace();
    return [
      {
        name: main.name,
        text: spaceFileText({
          name: main.name,
          icon: null,
          isolated: false,
          isDefault: true,
          window: this.tabs.toSavedWindow(main.id),
        }),
      },
      ...this.spaces().map(({ id, name }) => ({ name, text: this.spaceFileText(id) })),
    ];
  }

  private defaultSpace(): SpaceView {
    return { id: DEFAULT_SPACE_ID, name: t('spaces.default'), icon: null };
  }

  spacesChanged(): void {
    this.tabs.syncSpaces();
    this.tabs.syncNewTabMarkColors();
  }

  private createSpace(): void {
    const names = new Set(this.spaces().map((space) => space.name));
    let number = 1;
    while (names.has(t('spaces.newName', { number }))) number++;
    const id = this.app.workspaces.create(t('spaces.newName', { number }));
    if (!id) {
      this.notice.show([t('spaces.failed')]);
      return;
    }
    this.app.spacesChanged();
    this.tabs.switchSpace(id);
  }

  private profileMenu(id: string): Electron.MenuItemConstructorOptions {
    const { workspaces } = this.app;
    const current = workspaces.profile(id);
    const names = new Map([this.defaultSpace(), ...this.spaces()].map((space) => [space.id, space.name]));
    const choose = (profile: string | null | 'new') => {
      if (workspaces.setProfile(id, profile)) this.app.spacesChanged();
    };
    return {
      label: t('spaces.profile'),
      submenu: [
        { label: t('spaces.defaultProfile'), type: 'radio', checked: current === null, click: () => choose(null) },
        ...workspaces.profiles().map((profile): Electron.MenuItemConstructorOptions => ({
          label: profile.spaceIds.map((spaceId) => names.get(spaceId) ?? '').join(', '),
          type: 'radio',
          checked: profile.id === current,
          click: () => choose(profile.id),
        })),
        { type: 'separator' },
        { label: t('spaces.newProfile'), click: () => choose('new') },
      ],
    };
  }

  private spaceIconMenu(space: SpaceView): Electron.MenuItemConstructorOptions {
    return {
      label: t('spaces.icon'),
      submenu: SPACE_ICONS.map((icon) => ({
        label: icon,
        type: 'radio',
        checked: icon === space.icon,
        click: () => {
          if (this.app.workspaces.setIcon(space.id, icon)) this.app.spacesChanged();
        },
      })),
    };
  }

  private setSpaceColor(space: SpaceView, color: AccentColorId): void {
    const { frameTheme } = this.app.settings.get();
    const theme = { ...(space.theme ?? frameTheme), colors: [accentHex(color)], texture: 'none' as const };
    if (space.id === DEFAULT_SPACE_ID) this.app.updateSettings({ accentColor: color, frameTheme: theme });
    else if (this.app.workspaces.setTheme(space.id, theme)) this.app.spacesChanged();
  }

  private spaceEditMenu(space: SpaceView): Electron.MenuItemConstructorOptions[] {
    const color = space.theme?.colors[0] ?? accentHex(this.app.settings.get().accentColor);
    const openProfile = () => this.tabs.openSettings(`profiles#profile=${encodeURIComponent(space.id)}`);
    const own = space.id !== DEFAULT_SPACE_ID;
    return [
      ...ACCENT_COLORS.map(({ id, hex }): Electron.MenuItemConstructorOptions => ({
        label: t(`accent.${id}`),
        type: 'radio',
        checked: hex === color,
        icon: colorSwatch(hex),
        click: () => this.setSpaceColor(space, id),
      })),
      { type: 'separator' },
      ...(own ? [this.spaceIconMenu(space)] : []),
      { label: t('sidebarContext.rename'), enabled: own, click: openProfile },
      { label: t('sidebarContext.profileSettings'), click: openProfile },
    ];
  }

  private openSidebarContextMenu(): void {
    const tabs = this.tabs;
    const { shortcuts, panelCollapsed } = this.app.settings.get();
    const shortcut = (id: ShortcutId) => ({
      accelerator: shortcutAccelerator(id, shortcuts),
      registerAccelerator: false,
    });
    const persistent = !this.isPrivate && !this.webApp;
    const space = persistent
      ? [this.defaultSpace(), ...this.spaces()].find(({ id }) => id === tabs.activeSpaceId)
      : undefined;
    const open = tabs.state().tabs.filter((tab) => !tab.pinned);
    const separator = { type: 'separator' } as const;
    this.popup([
      { label: t('menu.newTab'), ...shortcut('newTab'), click: () => this.handleAction({ type: 'new-tab' }) },
      {
        label: t('menu.reopenClosedTab'),
        ...shortcut('reopenClosedTab'),
        enabled: persistent && this.app.closedTabs.length > 0,
        click: () => tabs.reopenClosed(),
      },
      separator,
      {
        label: t('sidebarContext.newGroup'),
        enabled: tabs.activeTabId !== null,
        click: () => {
          if (tabs.activeTabId) tabs.setTabGroup(tabs.activeTabId, tabs.newGroupName(t('window.newFolderName')));
        },
      },
      ...(persistent
        ? [
            {
              label: t('sidebarContext.newLiveGroup'),
              submenu: LIVE_FOLDER_KINDS.map((kind) => ({
                label: t(LIVE_FOLDER_LABELS[kind]),
                click: () => {
                  if (!this.uiContents.isDestroyed()) this.uiContents.send(IpcChannel.addLiveFolder, kind);
                },
              })),
            },
          ]
        : []),
      separator,
      ...(space
        ? [
            { label: t('spaces.theme'), submenu: this.spaceEditMenu(space) },
            { label: t('sidebarContext.newProfile'), click: () => this.createSpace() },
            separator,
          ]
        : []),
      {
        label: t('sidebarContext.bookmarkAll'),
        enabled: persistent && open.length > 0,
        click: () => this.app.bookmarkTabs(open.map(({ url, title }) => ({ url, title }))),
      },
      separator,
      {
        label: t('sidebarContext.showTabs'),
        type: 'checkbox',
        checked: !panelCollapsed,
        ...shortcut('togglePanel'),
        click: () => this.handleAction({ type: 'toggle-panel' }),
      },
      separator,
      {
        label: t('sidebarContext.closeAll'),
        enabled: open.length > 0,
        click: () => {
          for (const tab of open) tabs.close(tab.id);
        },
      },
    ]);
  }

  private openSpaceMenu(id: string): void {
    if (id === DEFAULT_SPACE_ID) {
      if (this.spaces().length > 0) this.popup([this.profileMenu(id)]);
      return;
    }
    const space = this.spaces().find((item) => item.id === id);
    if (!space) return;
    this.popup([
      this.spaceIconMenu(space),
      {
        label: t('spaces.theme'),
        click: () => this.tabs.openSettings(`profiles#profile=${encodeURIComponent(id)}`),
      },
      this.profileMenu(id),
      {
        label: t('spaces.export'),
        click: () => {
          void exportSpaceWithDialog(this.window, space.name, this.spaceFileText(id));
        },
      },
      {
        label: t('spaces.delete'),
        click: () => {
          const confirmed =
            dialog.showMessageBoxSync(this.window, {
              type: 'question',
              message: t('spaces.deleteConfirm', { name: space.name }),
              detail: t('spaces.deleteDetail'),
              buttons: [t('spaces.cancel'), t('spaces.delete')],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            }) === 1;
          if (confirmed && this.app.workspaces.remove(id)) this.app.spacesChanged();
        },
      },
    ]);
  }

  private openFolderMenu(name: string): void {
    const tabs = this.tabs;
    const folder = tabs.groupView().find((group) => group.name === name);
    if (!folder) return;
    this.popup(
      folderMenuTemplate(folder, tabs.groupTargets(name), {
        moveTo: (parent) => tabs.moveGroup(name, parent),
        remove: () => tabs.removeGroup(name),
      }),
    );
  }

  private addLiveFolder(kind: unknown, input: unknown): void {
    const source = isLiveFolderKind(kind) ? liveFolderSource(kind, input) : null;
    const id = this.isPrivate || !source ? null : this.app.liveFolders.add(source);
    if (!id) {
      this.notice.show([t('liveFolders.failed')]);
      return;
    }
    this.app.liveFoldersChanged();
    void this.app.liveFolderRefresher.refresh([id]);
  }

  private openLiveFolderMenu(id: string): void {
    if (this.isPrivate) return;
    const store = this.app.liveFolders;
    this.popup([
      { label: t('liveFolders.refresh'), click: () => void this.app.liveFolderRefresher.refresh([id]) },
      {
        label: t('liveFolders.markRead'),
        click: () => store.readAll(id) && this.app.liveFoldersChanged(),
      },
      { type: 'separator' },
      { label: t('liveFolders.remove'), click: () => store.remove(id) && this.app.liveFoldersChanged() },
    ]);
  }

  private toggleFavorite(url: string, title = url, faviconUrl: string | null = null): void {
    if (this.isPrivate || this.webApp) return;
    if (this.app.favorites.toggle({ url, title, faviconUrl })) this.app.favoritesChanged();
  }

  private popup(template: Electron.MenuItemConstructorOptions[]): void {
    Menu.buildFromTemplate(template).popup({ window: this.window });
  }

  private showContextMenu(contents: Electron.WebContents, params: Electron.ContextMenuParams): void {
    const tabs = this.tabs;
    const history = contents.navigationHistory;
    const mode = modeFlags(tabs.modeOfContents(contents));
    const translation = tabs.snapshotFor()?.translation;
    const template = contextMenuTemplate(params, {
      translation:
        translation?.available && translation.status !== 'translating'
          ? {
              label: translation.status === 'translated' ? t('window.showOriginalPage') : t('window.translatePage'),
              run: () => tabs.toggleTranslation(),
            }
          : undefined,
      translateSelection: tabs.canTranslateSelection() ? () => tabs.translateSelection(contents) : undefined,
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      canViewSource: canViewSource(contents.getURL()),
      openInNewTab: (url) => tabs.open(url, { activate: false, ...mode }),
      openInNewWindow: (url) =>
        this.app.openWindow({
          url,
          isPrivate: mode.isPrivate,
          developer: this.isDeveloper || mode.developer,
          from: this,
        }),
      peekLink: (url) => this.peek.open(url, mode.isPrivate, this.peekOwner(), mode.developer),
      copyText: (text) => clipboard.writeText(text),
      copyImage: () => contents.copyImageAt(params.x, params.y),
      download: (url) => contents.downloadURL(url),
      search: (text) => tabs.open(buildSearchUrl(this.app.searchEngine(), text), mode),
      goBack: () => history.goBack(),
      goForward: () => history.goForward(),
      reload: () => contents.reload(),
      inspect: () => this.tabs.inspect(contents, params.x, params.y),
      print: () => this.print(contents),
      fullPageScreenshot: () => void this.saveScreenshot(true),
      viewSource: () => {
        if (canViewSource(contents.getURL())) tabs.open(`view-source:${contents.getURL()}`, mode);
      },
      copyAddress: (format) => this.copyAddress(format, { url: contents.getURL(), title: contents.getTitle() }),
      replaceMisspelling: (word) => contents.replaceMisspelling(word),
      addToDictionary: (word) => contents.session.addWordToSpellCheckerDictionary(word),
      extensionItems: this.app.extensionBridge.menuItems(contents, params),
    });
    this.popup(template);
  }

  private material(): WindowMaterial {
    return this.glassApplied && !this.window.isFullScreen() && !nativeTheme.prefersReducedTransparency
      ? 'glass'
      : 'opaque';
  }

  private isPageFullScreen(): boolean {
    return this.htmlFullScreenTabId !== null && this.htmlFullScreenTabId === this.tabs.activeTabId;
  }

  private peekOwner(): PeekOwner {
    return { tabId: this.tabs.activeTabId, url: withoutHash(this.tabs.activeUrl) };
  }

  private endFind(): void {
    if (this.findTarget) this.tabs.stopFind(this.findTarget.tabId);
    this.findTarget = null;
    this.findBar.close(this.window);
  }

  private syncPageFullScreen(): void {
    if (this.isPageFullScreen()) {
      this.commandBar.close(this.window);
      this.peek.close();
      this.endFind();
    }
    this.applyLayout();
    this.pushState();
  }

  private showWindowControls(): void {
    if (process.platform !== 'darwin') return;
    const fullScreen = this.window.isFullScreen();
    // In full screen the renderer draws the buttons beside the toolbar, so native ones would double up.
    this.window.setWindowButtonVisibility(!fullScreen);
    if (fullScreen) return;
    this.window.setWindowButtonPosition(WINDOW_CONTROLS_INSET);
  }

  private applyTitleBarTheme(): void {
    if (IS_MAC || this.window.isDestroyed()) return;
    this.window.setTitleBarOverlay(titleBarOverlayOptions());
  }

  private applyLayout(): void {
    const { width, height } = this.window.getContentBounds();
    // A revealed menu bar slides the whole chrome down without resizing it, so nothing reflows per frame.
    this.ui.setBounds({ x: 0, y: this.menuBarInset, width, height });
    this.commandBar.fitWindow(this.window);
    this.tabs.setPageRadius(this.placePage(width, height));
    if (process.platform === 'darwin') {
      this.showWindowControls();
    }
  }

  private placePage(width: number, height: number): number {
    const fullScreen = this.isPageFullScreen();
    const reserved = fullScreen ? 0 : (this.sidePanel?.reserved ?? 0);
    const layout = reserved
      ? { ...this.layout, agentPanelWidth: (this.layout.agentPanelWidth ?? 0) + reserved }
      : this.layout;
    const { radius, ...frame } = pageFrame(width, height, layout, fullScreen, this.tabs.showsOnlyNewTab);
    const bounds = { ...frame, y: frame.y + this.menuBarInset };
    this.tabs.setPageLayout(bounds);
    this.sidePanel?.place(reserved ? bounds : null);
    this.pageArea = bounds;
    this.commandBar.updateArea(this.window, bounds);
    this.placeFloatingChat();
    this.findBar.relayout(this.window);
    this.peek.relayout();
    this.agentControl.layout();
    return radius;
  }
}

function verificationLines({ result, requests, errors, lines }: Verification): string[] {
  if (requests.length === 0 && lines.length > 0)
    return [t(result === 'passed' ? 'agentActions.passed' : 'agentActions.failed'), ...lines].slice(0, 3);
  const failed = (status: number | null) => status !== null && (status === 0 || status >= 400);
  const status = (value: number | null) =>
    value === null ? t('agentActions.notSent') : value === 0 ? t('agentActions.requestFailed') : String(value);
  const changes = requests
    .filter(({ before, after }) => failed(before) || failed(after))
    .slice(0, 2)
    .map(({ request, after }) => `${request} → ${status(after)}`);
  return [
    t(result === 'passed' ? 'agentActions.passed' : 'agentActions.failed'),
    ...changes,
    errors.length === 0 ? t('agentActions.noErrors') : t('agentActions.errors', { count: errors.length }),
  ].slice(0, 3);
}
