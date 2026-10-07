import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BaseWindow,
  Menu,
  WebContentsView,
  app,
  clipboard,
  dialog,
  nativeTheme,
  type Rectangle,
  type Session,
} from 'electron';
import { getLocale, t } from '../../shared/i18n.js';
import { preloadPath, rendererPath } from '../app/paths.js';
import {
  NEW_TAB_URL,
  IpcChannel,
  type AnchorRect,
  type BrowserState,
  type AgentElementRef,
  type AgentProviderId,
  type ChromeLayout,
  type DevCommandId,
  type DeviceId,
  type ProfileKind,
  type TabId,
  type UiAction,
  type WindowMaterial,
} from '../../shared/types.js';
import type { BookmarkStore } from '../library/bookmarks.js';
import type { BookmarkImportResult, HistoryImportResult } from '../library/browser-import.js';
import type { CertificateExceptions } from '../privacy/certificates.js';
import type { CommandBar, CommandBarHost } from '../address-bar/command-bar.js';
import { contextMenuTemplate } from './context-menu.js';
import {
  autoReloadSeconds,
  isDevCommandId,
  isDevCommandInput,
  matchDevCommands,
  overridePatch,
} from '../devtools/dev-commands.js';
import { devMenuTemplate } from '../devtools/dev-menu.js';
import { downloadsMenuTemplate, type DownloadActions, type DownloadStore } from '../library/downloads.js';
import { sanitizeAnchor, type ExtensionPopup } from '../extensions/extension-popup.js';
import { STORE_HOME } from '../extensions/chrome-web-store.js';
import { extensionsMenuTemplate, type ExtensionManager } from '../extensions/extensions.js';
import type { FindBar, FindBarHost } from './find-bar.js';
import { applyGlass, glassAvailable } from './glass.js';
import type { HistoryStore } from '../library/history.js';
import type { HttpsOnly } from '../privacy/https-only.js';
import { canViewSource, formatAddress, type AddressFormat } from '../devtools/page-export.js';
import { NavigationHint, type HistoryDirection } from './navigation-hint.js';
import { PageNotice } from './page-notice.js';
import { AgentControl } from './agent-control.js';
import type { ActionWindow } from '../agent-bridge/action-runner.js';
import type { Verification } from '../agent-bridge/verification.js';
import { formatLocation } from '../agent-bridge/component-source.js';
import { pageFrame } from './page-layout.js';
import { fontPreferences } from '../app/page-preferences.js';
import { permissionOrigin, type PermissionStore } from '../privacy/permissions.js';
import type { PersistChange, SavedTab, SavedWindow } from '../tabs/persistence.js';
import { blockedPopupsTemplate } from '../tabs/popups.js';
import { Preconnector } from '../address-bar/preconnect.js';
import type { RepoPrompt } from '../app/repo-prompt.js';
import type { ChatPreferenceStore } from '../agent-bridge/chat-preferences.js';
import { importBookmarksWithDialog, importHistoryWithDialog } from './import-dialogs.js';
import { printPage, savePdfFile, saveScreenshotFile } from './page-capture.js';
import { loadWallpaper } from './wallpaper.js';
import { libraryMenuTemplate, profileMenuTemplate, siteInfoMenu, tabMenuTemplate } from './window-menus.js';
import { buildSearchUrl, type SearchEngine } from '../address-bar/search.js';
import type { SettingsStore } from '../app/settings.js';
import type { SiteProtections } from '../privacy/site-protections.js';
import { clearSiteData } from '../privacy/site-data.js';
import { EMPTY_HISTORY_INDEX, suggest } from '../address-bar/suggestions.js';
import { TabManager, type DetachedTab } from '../tabs/tabs.js';
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
import { AgentProject } from './agent-project.js';
import { AgentProjectTabs } from './agent-project-tabs.js';
import { selectionRef, type ElementSelection } from '../agent-bridge/selection.js';
import { MAX_REFERENCES, referenceRef, type ReferenceCapture } from '../agent-bridge/reference.js';
import { VisualComparisonManager, VisualComparisonError, type VisualComparisonTab } from './visual-comparison.js';
import { captureVisualPage } from './visual-capture.js';
import { ResponsiveScanManager, ResponsiveScanError, createResponsiveScanSession } from './responsive-scan.js';
import { acquirePageWork, pageWorkBusy } from '../tabs/page-work.js';

const WINDOW_CONTROLS_INSET = { x: 16, y: 15 };
const CASCADE_OFFSET = 24;
const REVEAL_FALLBACK_MS = 1000;
const MAX_PICKED_ELEMENTS = 5;
const MAX_AGENT_PROJECTS = 6;

export interface AppContext {
  icon: string;
  daily: Session;
  privateBrowsing: Session;
  developer: Session;
  requestRules: RequestRuleStore;
  settings: SettingsStore;
  siteProtections: SiteProtections;
  commandBar: CommandBar;
  findBar: FindBar;
  history: HistoryStore;
  repoPrompt: RepoPrompt;
  dismissAnnouncement: () => void;
  dismissFeedback: () => void;
  dismissUpdate: () => void;
  installUpdate: () => void;
  chatPreferences: ChatPreferenceStore;
  downloads: DownloadStore;
  bookmarks: BookmarkStore;
  extensions: ExtensionManager;
  extensionPopup: ExtensionPopup;
  certificates: CertificateExceptions;
  httpsOnly: HttpsOnly;
  closedTabs: SavedTab[];
  pageTheme: string;
  permissionsFor(isPrivate: boolean): PermissionStore;
  zoomFor(isPrivate: boolean): ZoomStore;
  searchEngine(): SearchEngine;
  downloadActions(window: YalqenWindow): DownloadActions;
  downloadsChanged(): void;
  toggleBookmark(url: string, title: string): void;
  runBookmarksCommand(command: string, params: URLSearchParams): void;
  importBookmarks(file: string): Promise<BookmarkImportResult>;
  importHistory(file: string): Promise<HistoryImportResult>;
  runDownloadsCommand(command: string, params: URLSearchParams): void;
  updateSettings(patch: unknown): void;
  deviceId(): DeviceId;
  openWindow(options: WindowOptions): YalqenWindow;
  switchProfile(profile: ProfileKind, from: YalqenWindow): void;
  onWindowChange(persist: PersistChange): void;
  onPrivateTabsClosed(): void;
  onWindowFocus(window: YalqenWindow): void;
  onWindowClosing(window: YalqenWindow): void;
  onWindowClosed(window: YalqenWindow): void;
  agentScope(url: string, privateBrowsing: boolean): boolean;
  agentConnection(window: YalqenWindow, project: AgentProject): Promise<AgentConnection>;
  releaseAgentConnection(project: AgentProject): void;
}

export interface WindowOptions {
  isPrivate?: boolean;
  developer?: boolean;
  saved?: SavedWindow;
  url?: string;
  tab?: DetachedTab;
  from?: YalqenWindow;
}

export class YalqenWindow {
  private closeApproved = false;
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
  private signingIn = false;
  private pickedElements: AgentElementRef[] = [];
  private readonly references = new Map<string, ReferenceCapture>();
  private readonly visualComparisons = new Map<string, VisualComparisonManager>();
  private readonly responsiveScans = new Map<string, ResponsiveScanManager>();
  private selectingAgentDirectory = false;
  private readonly ui: WebContentsView;
  // view.webContents reads undefined once the contents are destroyed; this reference keeps answering isDestroyed().
  readonly uiContents: Electron.WebContents;
  private readonly commandHost: CommandBarHost;
  private readonly findHost: FindBarHost;
  private pageArea: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  private readonly preconnector: Preconnector;
  private layout: ChromeLayout = {
    panelWidth: 180,
    panelSlide: 0,
    panelSide: 'left',
    chromeHeight: 44,
    pageInset: 8,
    pageRadius: 16,
    newTabCenterOffset: 0,
  };
  private glassApplied = glassAvailable;
  private revealed = false;
  private htmlFullScreenTabId: string | null = null;
  private pushQueued = false;
  private lastPushedState = '';
  private findTarget: { tabId: string; url: string } | null = null;
  private readonly navigationHint: NavigationHint;
  private readonly notice: PageNotice;
  private readonly agentControl: AgentControl;
  private lastNavigationGesture: { source: 'native' | 'page'; direction: 'back' | 'forward'; at: number } | null = null;

  constructor(
    private readonly app: AppContext,
    options: WindowOptions,
  ) {
    this.isDeveloper = options.developer ?? false;
    this.isPrivate = this.isDeveloper || (options.isPrivate ?? false);
    const from = options.from?.window.getBounds();
    this.window = new BaseWindow({
      width: from?.width ?? 1280,
      height: from?.height ?? 820,
      ...(from ? { x: from.x + CASCADE_OFFSET, y: from.y + CASCADE_OFFSET } : {}),
      minWidth: 640,
      minHeight: 400,
      title: this.isDeveloper ? t('window.titleDeveloper') : this.isPrivate ? t('window.titlePrivate') : 'Yalqen',
      icon: app.icon,
      titleBarStyle: 'hiddenInset',
      transparent: glassAvailable,
      show: false,
    });

    this.ui = new WebContentsView({
      webPreferences: {
        preload: preloadPath('preload'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.uiContents = this.ui.webContents;
    this.activeProjectId = this.addProject().id;
    if (glassAvailable) this.ui.setBackgroundColor('#00000000');
    this.uiContents.on('will-navigate', (event) => event.preventDefault());
    this.uiContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.contentView.addChildView(this.ui);

    this.preconnector = new Preconnector((origin) =>
      this.sessionFor(this.tabs.activeIsPrivate).preconnect({ url: origin }),
    );

    this.commandHost = {
      window: this.window,
      onSubmit: (input, mode) => {
        this.preconnector.cancel();
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
    };

    this.findHost = {
      window: this.window,
      area: () => this.pageArea,
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
      closed: app.closedTabs,
      privateWindow: this.isPrivate,
      session: app.daily,
      privateSession: this.isDeveloper ? app.developer : app.privateBrowsing,
      onPrivateEnded: () => app.onPrivateTabsClosed(),
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
      freezeBackground: () => app.settings.get().freezeBackgroundTabs,
      onChange: (persist) => {
        this.syncAgentProjectWithTab();
        if (this.htmlFullScreenTabId && this.htmlFullScreenTabId !== this.tabs.activeTabId) {
          this.htmlFullScreenTabId = null;
          this.syncPageFullScreen();
        }
        const target = this.findTarget;
        if (target && (target.tabId !== this.tabs.activeTabId || target.url !== withoutHash(this.tabs.activeUrl))) {
          this.endFind();
        }
        this.findBar.keepOnTop(this.window);
        this.commandBar.keepOnTop(this.window);
        this.pushState();
        app.onWindowChange(persist);
      },
      onPageSwipe: (direction) => this.navigateByGesture(direction, 'page'),
      onNewTabSearch: (query) => {
        if (query.trim() === '') this.openAddress();
        else this.tabs.navigate(resolveInput(query, app.searchEngine()));
      },
      onRepoPrompt: (action) => app.repoPrompt.respond(action),
      onFeedback: () => app.dismissFeedback(),
      onUpdateCard: (action) => {
        if (action === 'install') app.installUpdate();
        else app.dismissUpdate();
      },
      onAnnouncement: (action) => {
        app.dismissAnnouncement();
        if (action === 'try') this.openAgentPanel();
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
      onHistoryClear: () => app.history.clear(),
      isBookmarked: (url) => app.bookmarks.has(url),
      onPageCommand: (page, command, params) => {
        if (page === 'bookmarks') app.runBookmarksCommand(command, params);
        else app.runDownloadsCommand(command, params);
      },
      onFindResult: (result) => this.findBar.showResult(this.window, result),
      zoomFor: (url, isPrivate) => app.zoomFor(isPrivate).get(url),
      defaultZoom: () => app.settings.get().defaultZoom,
      hasOwnZoom: (url, isPrivate) => app.zoomFor(isPrivate).has(url),
      pagePreferences: () => fontPreferences(app.settings.get().fontSize),
      onZoom: (url, factor, isPrivate) => app.zoomFor(isPrivate).set(url, factor),
      hasCertificateException: (url) => app.certificates.hasException(url),
      certificateToken: (url) => app.certificates.tokenFor(url),
      onCertificateProceed: (token, url) => app.certificates.proceed(token, url),
      popupsAllowed: (url, isPrivate) => {
        const origin = permissionOrigin(url);
        return origin !== null && app.permissionsFor(isPrivate).get(origin, 'popups') === 'allow';
      },
      upgradeHttp: (url) => app.httpsOnly.upgrade(url),
      httpsOnlyWarning: (https, http) => app.httpsOnly.warn(https, http),
      onProceedHttp: (token, currentUrl) => app.httpsOnly.proceed(token, currentUrl),
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
      requestRules: () => app.requestRules.list(),
      translation: () => ({
        enabled: app.settings.get().pageTranslation,
        language: app.settings.get().pageLanguage,
      }),
      // Developer windows are private only to keep their session apart; they are meant for local work.
      agentScope: (tab) => app.agentScope(tab.url, tab.isPrivate && !this.isDeveloper),
      agentTracing: () => app.settings.get().agentBridge && app.settings.get().agentTracing,
    });

    this.navigationHint = new NavigationHint({ window: this.window, area: () => this.pageArea });
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
    // enter/leave-full-screen only fire once the macOS transition animation ends, while the
    // first resize already reports the new state; waiting would show the bare glass meanwhile.
    let fullScreen = this.window.isFullScreen();
    const syncFullScreen = () => {
      this.applyLayout();
      if (this.window.isFullScreen() === fullScreen) return;
      fullScreen = !fullScreen;
      if (fullScreen) void this.sendWallpaper();
      this.pushState();
    };
    this.window.on('resize', syncFullScreen);
    this.window.on('enter-full-screen', syncFullScreen);
    this.window.on('leave-full-screen', syncFullScreen);
    this.applyLayout();
    setTimeout(this.reveal, REVEAL_FALLBACK_MS);

    nativeTheme.on('updated', this.pushState);
    this.uiContents.once('did-finish-load', () => {
      this.glassApplied = applyGlass(this.window);
      this.pushState();
      void this.sendWallpaper();
    });

    this.window.on('close', (event) => {
      if (!this.closeApproved) {
        event.preventDefault();
        if (!this.closePending) {
          this.closePending = true;
          void this.tabs.confirmCloseAll().then((allowed) => {
            this.closePending = false;
            if (allowed && !this.window.isDestroyed()) {
              this.approveClose();
              this.window.close();
            }
          });
        }
        return;
      }
      app.onWindowClosing(this);
      nativeTheme.off('updated', this.pushState);
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
      this.tabs.destroyAll();
      this.commandBar.release(this.window);
      this.findBar.release(this.window);
      this.navigationHint.destroy();
      this.notice.destroy();
      this.agentControl.destroy();
      app.extensionPopup.close(this.window);
      if (!this.uiContents.isDestroyed()) this.uiContents.close();
      app.onWindowClosed(this);
      if (hadPrivate) app.onPrivateTabsClosed();
    });

    if (options.tab) this.tabs.adopt(options.tab);
    else if (options.saved && options.saved.tabs.length > 0) this.tabs.restore(options.saved, options.url);
    else this.tabs.open(options.url);

    void this.uiContents.loadFile(rendererPath('index.html'), { query: { lang: getLocale() } });
    app.onWindowFocus(this);
  }

  private get commandBar(): CommandBar {
    return this.app.commandBar;
  }

  private get findBar(): FindBar {
    return this.app.findBar;
  }

  private navigateByGesture(direction: 'back' | 'forward', source: 'native' | 'page'): void {
    if (process.platform !== 'darwin') return;
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

  private async sendWallpaper(): Promise<void> {
    const wallpaper = await loadWallpaper(path.join(app.getPath('userData'), 'wallpaper'));
    if (!this.uiContents.isDestroyed()) this.uiContents.send(IpcChannel.wallpaper, wallpaper);
  }

  readonly pushState = (): void => {
    if (this.pushQueued) return;
    this.pushQueued = true;
    setImmediate(() => {
      this.pushQueued = false;
      if (this.window.isDestroyed() || this.uiContents.isDestroyed()) return;
      const serialized = JSON.stringify(this.state());
      if (serialized === this.lastPushedState) return;
      this.lastPushedState = serialized;
      this.uiContents.send(IpcChannel.state, serialized);
    });
  };

  state(): BrowserState {
    const tabState = this.tabs.state();
    const tabIds = new Set(tabState.tabs.map((tab) => tab.id));
    for (const project of this.agentProjects) project.retainTabs(tabIds);
    return {
      ...tabState,
      developer: this.isDeveloper,
      pageFullScreen: this.isPageFullScreen(),
      windowFullScreen: this.window.isFullScreen(),
      addressPlaceholder: this.app.searchEngine().placeholder,
      panelCollapsed: this.app.settings.get().panelCollapsed,
      panelSide: this.app.settings.get().panelSide,
      pinnedDisplay: this.app.settings.get().pinnedDisplay,
      sidebarVisible: this.app.settings.get().sidebarVisible,
      toolbarVisible: this.app.settings.get().toolbarVisible,
      toolbarTabs: this.app.settings.get().toolbarTabs,
      toolbarButtons: this.app.settings.get().toolbarButtons,
      material: this.material(),
      defaultZoom: this.app.settings.get().defaultZoom,
      downloads: this.app.downloads.summary(),
      extensions: !this.isPrivate,
      profile: this.profile,
      agentPanelOpen: this.agentPanelOpen,
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
    };
  }

  openAgentPanel(): void {
    if (!this.agentPanelOpen) this.toggleAgentPanel();
  }

  toggleAgentPanel(): void {
    if (this.isPrivate && !this.isDeveloper) return;
    this.agentPanelOpen = !this.agentPanelOpen;
    if (this.agentPanelOpen) {
      if (this.agentProject.directory)
        this.projectTabs.bind(this.tabs.snapshotFor(), this.activeProjectId, this.isDeveloper);
      this.uiContents.focus();
      void this.agentProject.chat.refreshModels();
      void availableProviders().then((providers) => {
        if (providers.length === this.agentProviders.length) return;
        this.agentProviders = providers;
        this.pushState();
      });
    } else this.tabs.focusActive();
    this.pushState();
  }

  // Projects are shared by their tabs and tabs without a folder share the folderless project, so choosing a
  // folder moves this tab to that folder's project instead of pulling the other tabs along.
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

  get agentProject(): AgentProject {
    return this.agentProjects.find((project) => project.id === this.activeProjectId) ?? this.agentProjects[0];
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
        if (isActive(target) && !this.uiContents.isDestroyed()) this.uiContents.send(IpcChannel.agentOutput, output);
      },
      onChatUpdate: (target, snapshot) => {
        if (isActive(target) && !this.uiContents.isDestroyed())
          this.uiContents.send(IpcChannel.agentChatUpdate, JSON.stringify(snapshot));
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

  // A chat that is still working moves to the background and keeps going; an idle one is just cleared.
  newAgentChat(): void {
    if (this.isPrivate && !this.isDeveloper) return;
    const chat = this.agentChat;
    if (this.agentProject.setAsideChat()) this.showAgentChat();
    else if (!['starting', 'thinking', 'approval'].includes(chat.state().status)) chat.reset(chat.state().id);
  }

  // A Claude session belongs to the folder it started in, so another project continues from a digest of
  // the chat in a new tab rather than from the session itself.
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

  // A project lives as long as one of its tabs: closing the last one ends its chats and dev server.
  private closeAbandonedProjects(): void {
    for (const id of this.projectTabs.release((tabId) => this.tabs.snapshotFor(tabId) !== null)) {
      const project = this.agentProjects.find((candidate) => candidate.id === id);
      if (project?.directory) this.disposeProject(project);
    }
  }

  private showAgentChat(): void {
    if (!this.uiContents.isDestroyed())
      this.uiContents.send(IpcChannel.agentChatUpdate, JSON.stringify(this.agentChat.snapshot()));
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
    if (!this.uiContents.isDestroyed())
      this.uiContents.send(IpcChannel.agentChatUpdate, JSON.stringify(this.agentChat.snapshot()));
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
      // -t opens the file as text, so a script or app bundle Claude wrote is never launched.
      await new Promise<void>((resolve, reject) =>
        execFile('/usr/bin/open', ['-t', real], (error) => (error ? reject(error) : resolve())),
      );
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

  // Signing out ends the provider's login on this computer, terminal sessions included, so it is confirmed first.
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
      isPrivate: tab.isPrivate && !this.isDeveloper,
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
    // Pages outside local development are read only when the user attaches them to this message.
    const pages: Record<string, PageText> = Object.create(null);
    const external = contexts.filter((context) => !context.local);
    const capturedPages = await Promise.all(external.map((context) => this.tabs.pageText(context.id)));
    if (capturedPages.some((page) => !page)) return false;
    external.forEach((context, index) => {
      pages[context.id] = capturedPages[index]!;
    });
    // A closed, navigated or newly private tab must not send content under its old attachment.
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
      // A sliding panel only moves the page, so it skips the window-wide relayout on every frame.
      if (changed.length === 1 && changed[0] === 'panelSlide') {
        const { width, height } = this.window.getContentBounds();
        this.placePage(width, height);
      } else {
        this.applyLayout();
      }
    }
    this.reveal();
  }

  // The window stays hidden until the chrome reports its real layout, so the page never
  // appears at the default bounds first and then jumps.
  private reveal = (): void => {
    if (this.revealed || this.window.isDestroyed()) return;
    this.revealed = true;
    this.window.show();
  };

  openAddress(): void {
    const url = this.tabs.activeUrl;
    if (url === NEW_TAB_URL && this.focusNewTabSearch()) return;
    this.preconnector.opened(this.app.searchEngine());
    this.commandBar.open(this.commandHost, {
      placeholder: this.app.searchEngine().placeholder,
      mode: 'navigate',
      value: url === NEW_TAB_URL || url === 'about:blank' ? '' : url,
    });
    if (!this.tabs.activeIsPrivate) setImmediate(() => this.app.history.index());
  }

  runDevCommand(id: DevCommandId): void {
    const tabs = this.tabs;
    const browsing = this.sessionFor(tabs.activeIsPrivate);
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

  print(contents = this.tabs.activeContents()): void {
    printPage(contents);
  }

  savePageAsPdf(): Promise<void> {
    return savePdfFile(this.window, this.tabs.activeContents());
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

  private copyAddress(format: AddressFormat, page = this.tabs.activePage()): void {
    if (page && canViewSource(page.url)) clipboard.writeText(formatAddress(format, page.url, page.title));
  }

  moveActiveTabToNewWindow(): void {
    const id = this.tabs.activeTabId;
    const tab = id ? this.tabs.detach(id) : null;
    if (tab) this.app.openWindow({ tab, isPrivate: this.isPrivate, developer: this.isDeveloper, from: this });
  }

  close(): void {
    if (!this.window.isDestroyed()) this.window.close();
  }

  approveClose(): void {
    this.closeApproved = true;
  }

  handleAction(action: UiAction): void {
    const tabs = this.tabs;
    const app = this.app;
    switch (action.type) {
      case 'new-tab':
        tabs.open(action.url);
        break;
      case 'activate-tab':
        tabs.activate(action.id);
        break;
      case 'close-tab':
        tabs.close(action.id);
        break;
      case 'discard-tab':
        tabs.discard(action.id);
        break;
      case 'toggle-pin':
        tabs.togglePin(action.id);
        break;
      case 'toggle-mute':
        tabs.toggleMute(action.id);
        break;
      case 'open-tab-menu':
        this.openTabMenu(action.id);
        break;
      case 'move-tab':
        tabs.move(action.id, action.toIndex);
        break;
      case 'navigate':
        tabs.navigate(resolveInput(action.input, app.searchEngine()));
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
      case 'open-devtools':
        tabs.openDevTools();
        break;
      case 'open-dev-menu': {
        const tab = tabs.snapshotFor();
        if (!tab) break;
        this.popup(
          devMenuTemplate(tab, {
            run: (id) => this.runDevCommand(id),
            openDevTools: () => tabs.openDevTools(),
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
            app.permissionsFor(tabs.activeIsPrivate).set(origin, ['popups'], 'allow');
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
      case 'toggle-sidebar':
        app.updateSettings({ sidebarVisible: !app.settings.get().sidebarVisible });
        break;
      case 'toggle-agent-panel':
        this.toggleAgentPanel();
        break;
      case 'open-address':
        this.openAddress();
        break;
      case 'switch-profile':
        if (action.profile !== this.profile) app.switchProfile(action.profile, this);
        break;
      case 'open-profile-menu':
        this.popup(
          profileMenuTemplate({
            newWindow: () => app.openWindow({ from: this }),
            newPrivateWindow: () => app.openWindow({ isPrivate: true, from: this }),
            newPrivateTab: () => tabs.open(NEW_TAB_URL, { isPrivate: true }),
            newDeveloperWindow: () => app.openWindow({ developer: true, from: this }),
            openSettings: () => tabs.openSettings(),
          }),
        );
        break;
      case 'toggle-bookmark': {
        const page = tabs.activePage();
        if (page) app.toggleBookmark(page.url, page.title);
        break;
      }
      case 'open-bookmarks-menu':
        this.popup(
          libraryMenuTemplate(app.bookmarks, {
            open: (url) => tabs.navigate(url),
            showAll: () => tabs.openBookmarks(),
            importBookmarks: (file) => void importBookmarksWithDialog(this.window, app.importBookmarks, file),
            importHistory: (file) => void importHistoryWithDialog(this.window, app.importHistory, file),
          }),
        );
        break;
      case 'open-downloads':
        this.popup(downloadsMenuTemplate(app.downloads.list(), app.downloadActions(this)));
        break;
      case 'open-extensions-menu':
        this.openExtensionsMenu(sanitizeAnchor(action.anchor));
        break;
      case 'open-extension-store':
        tabs.open(STORE_HOME, { isPrivate: false });
        break;
      case 'open-history':
        tabs.openHistory();
        break;
      case 'toggle-translation':
        tabs.toggleTranslation();
        break;
      case 'open-settings':
        tabs.openSettings();
        break;
    }
  }

  private async openSiteInfo(): Promise<void> {
    const template = await siteInfoMenu({
      tabs: this.tabs,
      permissions: (isPrivate) => this.app.permissionsFor(isPrivate),
      session: (isPrivate) => this.sessionFor(isPrivate),
      certificates: this.app.certificates,
      protections: this.isDeveloper
        ? undefined
        : {
            preferences: this.app.siteProtections,
            settings: () => this.app.settings.get(),
          },
      clearSiteData: () => this.runDevCommand('clear-site-data'),
    });
    if (template && !this.window.isDestroyed()) this.popup(template);
  }

  private openExtensionsMenu(anchor: AnchorRect): void {
    const openTab = (url: string) => this.tabs.open(url, { isPrivate: false });
    const template = extensionsMenuTemplate(this.app.extensions.actions(), {
      openPopup: (url) =>
        this.app.extensionPopup.open({
          window: this.window,
          session: this.app.daily,
          url,
          anchor,
          onOpenUrl: openTab,
        }),
      openOptions: openTab,
      openStore: () => openTab(STORE_HOME),
      manage: () => this.tabs.openSettings('extensions'),
    });
    Menu.buildFromTemplate(template).popup({
      window: this.window,
      x: Math.round(anchor.x),
      y: Math.round(anchor.y + anchor.height + 4),
    });
  }

  private sessionFor(isPrivate: boolean): Session {
    if (!isPrivate) return this.app.daily;
    return this.isDeveloper ? this.app.developer : this.app.privateBrowsing;
  }

  private openTabMenu(id: TabId): void {
    const tabs = this.tabs;
    const tab = tabs.snapshotFor(id);
    if (!tab) return;
    this.popup(
      tabMenuTemplate(tab, id === tabs.activeTabId, {
        togglePin: () => tabs.togglePin(id),
        toggleMute: () => tabs.toggleMute(id),
        discard: () => tabs.discard(id),
        close: () => tabs.close(id),
      }),
    );
  }

  private popup(template: Electron.MenuItemConstructorOptions[]): void {
    Menu.buildFromTemplate(template).popup({ window: this.window });
  }

  private showContextMenu(contents: Electron.WebContents, params: Electron.ContextMenuParams): void {
    const tabs = this.tabs;
    const history = contents.navigationHistory;
    const isPrivate = tabs.isPrivateContents(contents);
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
      openInNewTab: (url) => tabs.open(url, { activate: false, isPrivate }),
      openInNewWindow: (url) => this.app.openWindow({ url, isPrivate, developer: this.isDeveloper, from: this }),
      copyText: (text) => clipboard.writeText(text),
      copyImage: () => contents.copyImageAt(params.x, params.y),
      download: (url) => contents.downloadURL(url),
      search: (text) => tabs.open(buildSearchUrl(this.app.searchEngine(), text), { isPrivate }),
      goBack: () => history.goBack(),
      goForward: () => history.goForward(),
      reload: () => contents.reload(),
      inspect: () => contents.inspectElement(params.x, params.y),
      print: () => this.print(contents),
      fullPageScreenshot: () => void this.saveScreenshot(true),
      viewSource: () => {
        if (canViewSource(contents.getURL())) tabs.open(`view-source:${contents.getURL()}`, { isPrivate });
      },
      copyAddress: (format) => this.copyAddress(format, { url: contents.getURL(), title: contents.getTitle() }),
      replaceMisspelling: (word) => contents.replaceMisspelling(word),
      addToDictionary: (word) => contents.session.addWordToSpellCheckerDictionary(word),
    });
    this.popup(template);
  }

  private material(): WindowMaterial {
    return this.glassApplied && !nativeTheme.prefersReducedTransparency ? 'glass' : 'opaque';
  }

  private isPageFullScreen(): boolean {
    return this.htmlFullScreenTabId !== null && this.htmlFullScreenTabId === this.tabs.activeTabId;
  }

  private endFind(): void {
    if (this.findTarget) this.tabs.stopFind(this.findTarget.tabId);
    this.findTarget = null;
    this.findBar.close(this.window);
  }

  private syncPageFullScreen(): void {
    if (this.isPageFullScreen()) {
      this.commandBar.close(this.window);
      this.endFind();
    }
    this.applyLayout();
    this.pushState();
  }

  private showWindowControls(): void {
    this.window.setWindowButtonVisibility(this.app.settings.get().toolbarVisible || this.window.isFullScreen());
    if (!this.window.isFullScreen()) this.window.setWindowButtonPosition(WINDOW_CONTROLS_INSET);
  }

  private applyLayout(): void {
    const { width, height } = this.window.getContentBounds();
    this.ui.setBounds({ x: 0, y: 0, width, height });
    this.commandBar.fitWindow(this.window);
    this.tabs.setPageRadius(this.placePage(width, height));
    if (process.platform === 'darwin') {
      this.showWindowControls();
    }
  }

  private placePage(width: number, height: number): number {
    const { radius, ...bounds } = pageFrame(width, height, this.layout, this.isPageFullScreen());
    this.tabs.setPageLayout(bounds, this.isPageFullScreen() ? 0 : this.layout.newTabCenterOffset);
    this.pageArea = bounds;
    this.findBar.relayout(this.window);
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
