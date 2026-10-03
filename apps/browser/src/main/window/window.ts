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
import { importBookmarksWithDialog, importHistoryWithDialog } from './import-dialogs.js';
import { printPage, savePdfFile, saveScreenshotFile } from './page-capture.js';
import { loadWallpaper } from './wallpaper.js';
import { libraryMenuTemplate, profileMenuTemplate, siteInfoMenu, tabMenuTemplate } from './window-menus.js';
import { buildSearchUrl, type SearchEngine } from '../address-bar/search.js';
import type { SettingsStore } from '../app/settings.js';
import { clearSiteData } from '../privacy/site-data.js';
import { EMPTY_HISTORY_INDEX, suggest } from '../address-bar/suggestions.js';
import { TabManager, type DetachedTab } from '../tabs/tabs.js';
import { resolveInput, withoutHash } from '../address-bar/url.js';
import type { RequestRuleStore } from '../devtools/request-rules.js';
import type { ZoomStore } from '../tabs/zoom.js';
import { AgentSession, type AgentConnection } from '../agent-bridge/agent-session.js';

const WINDOW_CONTROLS_INSET = { x: 16, y: 15 };
const CASCADE_OFFSET = 24;
const REVEAL_FALLBACK_MS = 1000;

export interface AppContext {
  icon: string;
  daily: Session;
  privateBrowsing: Session;
  developer: Session;
  requestRules: RequestRuleStore;
  settings: SettingsStore;
  commandBar: CommandBar;
  findBar: FindBar;
  history: HistoryStore;
  repoPrompt: RepoPrompt;
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
  agentConnection(): Promise<AgentConnection>;
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
  readonly window: BaseWindow;
  readonly tabs: TabManager;
  readonly isPrivate: boolean;
  readonly isDeveloper: boolean;
  readonly agentSession: AgentSession;
  private agentPanelOpen = false;
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
    this.agentSession = new AgentSession({
      connect: () => app.agentConnection(),
      onState: this.pushState,
      onOutput: (output) => {
        if (!this.uiContents.isDestroyed()) this.uiContents.send(IpcChannel.agentOutput, output);
      },
    });
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
      freezeBackground: () => app.settings.get().freezeBackgroundTabs,
      onChange: (persist) => {
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

    this.window.on('close', () => {
      app.onWindowClosing(this);
      nativeTheme.off('updated', this.pushState);
      this.preconnector.cancel();
      this.agentSession.dispose();
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
      if (this.uiContents.isDestroyed()) return;
      const serialized = JSON.stringify(this.state());
      if (serialized === this.lastPushedState) return;
      this.lastPushedState = serialized;
      this.uiContents.send(IpcChannel.state, serialized);
    });
  };

  state(): BrowserState {
    return {
      ...this.tabs.state(),
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
    };
  }

  toggleAgentPanel(): void {
    if (this.isPrivate && !this.isDeveloper) return;
    this.agentPanelOpen = !this.agentPanelOpen;
    if (this.agentPanelOpen) this.uiContents.focus();
    else this.tabs.focusActive();
    this.pushState();
  }

  async selectAgentDirectory(): Promise<ReturnType<AgentSession['state']>> {
    if ((this.isPrivate && !this.isDeveloper) || this.selectingAgentDirectory || this.agentSession.active) {
      return this.agentSession.state();
    }
    this.selectingAgentDirectory = true;
    try {
      const result = await dialog.showOpenDialog(this.window, {
        title: t('agentPanel.chooseProject'),
        defaultPath: this.agentSession.state().directory ?? app.getPath('documents'),
        properties: ['openDirectory'],
      });
      if (!this.window.isDestroyed() && !result.canceled && result.filePaths[0]) {
        this.agentSession.selectDirectory(result.filePaths[0]);
      }
    } finally {
      this.selectingAgentDirectory = false;
    }
    return this.agentSession.state();
  }

  startAgentSession(size: unknown): Promise<ReturnType<AgentSession['state']>> {
    if (this.isPrivate && !this.isDeveloper) return Promise.resolve(this.agentSession.state());
    return this.agentSession.start(size);
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
        const detail = react.source ? formatLocation(react.source) : react.component ? label : null;
        this.notice.show(
          [t('picker.selected', { label: react.component ?? label }), detail, t('picker.copied', { id })].filter(
            (line) => line !== null,
          ),
        );
        break;
      }
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

function verificationLines({ result, requests, errors }: Verification): string[] {
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
