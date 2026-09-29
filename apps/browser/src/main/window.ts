import fs from 'node:fs';
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
import {
  NEW_TAB_URL,
  IpcChannel,
  type AnchorRect,
  type BrowserState,
  type ChromeLayout,
  type DevCommandId,
  type DeviceId,
  type UiAction,
  type WindowMaterial,
} from '../shared/types.js';
import { bookmarksMenuTemplate, type BookmarkStore } from './bookmarks.js';
import type { CertificateExceptions } from './certificates.js';
import type { CommandBar, CommandBarHost } from './command-bar.js';
import { contextMenuTemplate } from './context-menu.js';
import {
  autoReloadSeconds,
  isDevCommandId,
  isDevCommandInput,
  matchDevCommands,
  overridePatch,
} from './dev-commands.js';
import { devMenuTemplate } from './dev-menu.js';
import { downloadsMenuTemplate, type DownloadActions, type DownloadStore } from './downloads.js';
import { sanitizeAnchor, type ExtensionPopup } from './extension-popup.js';
import { extensionsMenuTemplate, type ExtensionManager } from './extensions.js';
import type { FindBar, FindBarHost } from './find-bar.js';
import { applyGlass, glassAvailable } from './glass.js';
import type { HistoryStore } from './history.js';
import type { HttpsOnly } from './https-only.js';
import { canViewSource, formatAddress, pageFileName, type AddressFormat } from './page-export.js';
import { pageFrame } from './page-layout.js';
import { fontPreferences } from './page-preferences.js';
import { permissionOrigin, type PermissionStore } from './permissions.js';
import type { PersistChange, SavedTab, SavedWindow } from './persistence.js';
import { blockedPopupsTemplate } from './popups.js';
import { Preconnector } from './preconnect.js';
import { loadWallpaper } from './wallpaper.js';
import { buildSearchUrl, type SearchEngine } from './search.js';
import type { SettingsStore } from './settings.js';
import { clearSiteData, cookieUrl, cookiesForHost } from './site-data.js';
import { siteInfoTemplate } from './site-info.js';
import { EMPTY_HISTORY_INDEX, suggest } from './suggestions.js';
import { TabManager, type DetachedTab } from './tabs.js';
import { resolveInput, withoutHash } from './url.js';
import type { RequestRuleStore } from './request-rules.js';
import type { ZoomStore } from './zoom.js';

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
  downloads: DownloadStore;
  bookmarks: BookmarkStore;
  extensions: ExtensionManager;
  extensionPopup: ExtensionPopup;
  certificates: CertificateExceptions;
  httpsOnly: HttpsOnly;
  closedTabs: SavedTab[];
  permissionsFor(isPrivate: boolean): PermissionStore;
  zoomFor(isPrivate: boolean): ZoomStore;
  searchEngine(): SearchEngine;
  downloadActions(window: YalqenWindow): DownloadActions;
  downloadsChanged(): void;
  toggleBookmark(url: string, title: string): void;
  runBookmarksCommand(command: string, params: URLSearchParams): void;
  runDownloadsCommand(command: string, params: URLSearchParams): void;
  updateSettings(patch: unknown): void;
  deviceId(): DeviceId;
  openWindow(options: WindowOptions): YalqenWindow;
  onWindowChange(persist: PersistChange): void;
  onPrivateTabsClosed(): void;
  onWindowFocus(window: YalqenWindow): void;
  onWindowClosing(window: YalqenWindow): void;
  onWindowClosed(window: YalqenWindow): void;
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
  private readonly ui: WebContentsView;
  // view.webContents reads undefined once the contents are destroyed; this reference keeps answering isDestroyed().
  readonly uiContents: Electron.WebContents;
  private readonly commandHost: CommandBarHost;
  private readonly findHost: FindBarHost;
  private pageArea: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  private readonly preconnector: Preconnector;
  private layout: ChromeLayout = {
    panelWidth: 220,
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
      title: this.isDeveloper ? 'Yalqen (geliştirici)' : this.isPrivate ? 'Yalqen (gizli)' : 'Yalqen',
      icon: app.icon,
      titleBarStyle: 'hiddenInset',
      transparent: glassAvailable,
      show: false,
    });

    this.ui = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.uiContents = this.ui.webContents;
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
            bookmarks: app.bookmarks.bookmarks(),
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
      pagePreload: path.join(__dirname, '../preload/page-preload.js'),
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
          message: 'Sayfa güvenli olmayan bir adrese yönlendiriyor',
          detail: `${new URL(url).host} HTTPS yerine HTTP ile açılmak istiyor. Bu sitedeki bilgileriniz şifrelenmeden gönderilir.`,
          buttons: ['Geri dön', 'HTTP ile devam et'],
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
      const hadPrivate = this.tabs.hasPrivateTabs;
      this.tabs.destroyAll();
      this.commandBar.release(this.window);
      this.findBar.release(this.window);
      app.extensionPopup.close(this.window);
      if (!this.uiContents.isDestroyed()) this.uiContents.close();
      app.onWindowClosed(this);
      if (hadPrivate) app.onPrivateTabsClosed();
    });

    if (options.tab) this.tabs.adopt(options.tab);
    else if (options.saved && options.saved.tabs.length > 0) this.tabs.restore(options.saved, options.url);
    else this.tabs.open(options.url);

    void this.uiContents.loadFile(path.join(__dirname, '../renderer/index.html'));
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
    if (direction === 'back') this.tabs.goBack();
    else this.tabs.goForward();
  }

  isFocused(): boolean {
    return !this.window.isDestroyed() && this.window.isFocused();
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
      const state = this.state();
      const serialized = JSON.stringify(state);
      if (serialized === this.lastPushedState) return;
      this.lastPushedState = serialized;
      this.uiContents.send(IpcChannel.state, state);
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
      sidebarVisible: this.app.settings.get().sidebarVisible,
      toolbarVisible: this.app.settings.get().toolbarVisible,
      toolbarTabs: this.app.settings.get().toolbarTabs,
      material: this.material(),
      defaultZoom: this.app.settings.get().defaultZoom,
      downloads: this.app.downloads.summary(),
      extensions: !this.isPrivate && this.app.extensions.active,
    };
  }

  setLayout(layout: ChromeLayout): void {
    const changed = (Object.keys(layout) as (keyof ChromeLayout)[]).some((key) => layout[key] !== this.layout[key]);
    if (changed) {
      this.layout = layout;
      this.applyLayout();
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
    contents?.print({}, (success, reason) => {
      if (!success && reason !== 'Print job canceled' && reason !== 'cancelled') {
        console.warn(`[print] could not print: ${reason}`);
      }
    });
  }

  async savePageAsPdf(): Promise<void> {
    const contents = this.tabs.activeContents();
    if (!contents) return;
    const { canceled, filePath } = await dialog.showSaveDialog(this.window, {
      title: 'PDF olarak kaydet',
      defaultPath: path.join(app.getPath('downloads'), pageFileName(contents.getTitle(), contents.getURL(), 'pdf')),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath || contents.isDestroyed()) return;
    try {
      await fs.promises.writeFile(filePath, await contents.printToPDF({ printBackground: true }));
    } catch (error) {
      console.warn('[print] could not save the page as PDF:', error);
      void dialog.showMessageBox(this.window, {
        type: 'error',
        message: 'Sayfa PDF olarak kaydedilemedi.',
        detail: String(error),
      });
    }
  }

  async saveScreenshot(fullPage: boolean): Promise<void> {
    try {
      const capture = await this.tabs.captureActive(fullPage);
      if (!capture) return;
      const { canceled, filePath } = await dialog.showSaveDialog(this.window, {
        title: fullPage ? 'Tam sayfa ekran görüntüsünü kaydet' : 'Ekran görüntüsünü kaydet',
        defaultPath: path.join(app.getPath('downloads'), pageFileName(capture.title, capture.url, 'png')),
        filters: [{ name: 'PNG', extensions: ['png'] }],
      });
      if (canceled || !filePath) return;
      await fs.promises.writeFile(filePath, capture.png);
    } catch (error) {
      console.warn('[screenshot] could not save the screenshot:', error);
      void dialog.showMessageBox(this.window, {
        type: 'error',
        message: 'Ekran görüntüsü kaydedilemedi.',
        detail: String(error),
      });
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
      case 'move-tab':
        tabs.move(action.id, action.toIndex);
        break;
      case 'navigate':
        tabs.navigate(resolveInput(action.input, app.searchEngine()));
        break;
      case 'go-back':
        tabs.goBack();
        break;
      case 'go-forward':
        tabs.goForward();
        break;
      case 'reload':
        tabs.reload();
        break;
      case 'open-devtools':
        tabs.openDevTools();
        break;
      case 'open-dev-menu': {
        const tab = tabs.state().tabs.find((item) => item.id === tabs.activeTabId);
        if (!tab) break;
        this.popup(
          devMenuTemplate(tab, { run: (id) => this.runDevCommand(id), openDevTools: () => tabs.openDevTools() }),
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
      case 'open-address':
        this.openAddress();
        break;
      case 'open-profile-menu':
        this.popup([
          { label: 'Yalqen profili', enabled: false },
          { type: 'separator' },
          { label: 'Yeni pencere', click: () => app.openWindow({ from: this }) },
          { label: 'Yeni gizli pencere', click: () => app.openWindow({ isPrivate: true, from: this }) },
          { label: 'Yeni gizli sekme', click: () => tabs.open(NEW_TAB_URL, { isPrivate: true }) },
          { label: 'Yeni geliştirici penceresi', click: () => app.openWindow({ developer: true, from: this }) },
          { type: 'separator' },
          { label: 'Ayarlar…', click: () => tabs.openSettings() },
        ]);
        break;
      case 'toggle-bookmark': {
        const page = tabs.activePage();
        if (page) app.toggleBookmark(page.url, page.title);
        break;
      }
      case 'open-bookmarks-menu': {
        const template = bookmarksMenuTemplate(app.bookmarks.folders(), app.bookmarks.bookmarks(), {
          open: (url) => tabs.navigate(url),
          showAll: () => tabs.openBookmarks(),
        });
        this.popup(template);
        break;
      }
      case 'open-downloads':
        this.popup(downloadsMenuTemplate(app.downloads.list(), app.downloadActions(this)));
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
      case 'open-settings':
        tabs.openSettings();
        break;
    }
  }

  private async openSiteInfo(): Promise<void> {
    const { tabs, app } = this;
    const tab = tabs.state().tabs.find((item) => item.id === tabs.activeTabId);
    if (!tab) return;
    const origin = permissionOrigin(tab.url);
    const store = app.permissionsFor(tab.isPrivate);
    const browsing = this.sessionFor(tab.isPrivate);
    const [cookies, storage] = origin
      ? await Promise.all([
          browsing.cookies.get({}).then(
            (all) => cookiesForHost(all, new URL(origin).hostname),
            () => [],
          ),
          tabs.measureActiveStorage(),
        ])
      : [[], null];
    if (tabs.activeTabId !== tab.id || this.window.isDestroyed()) return;
    const template = siteInfoTemplate(
      {
        url: tab.url,
        security: tab.security,
        permissions: origin ? store.list(origin) : [],
        data: origin ? { cookies: cookies.length, storage } : undefined,
      },
      {
        setPermission: (kind, decision) => {
          if (origin) store.set(origin, [kind], decision);
        },
        revokeCertificateException: () => {
          app.certificates.revoke(tab.url);
          void browsing.closeAllConnections().then(() => tabs.reload());
        },
        clearCookies: () => {
          void Promise.allSettled(
            cookies.map((cookie) => browsing.cookies.remove(cookieUrl(cookie), cookie.name)),
          ).then(() => tabs.reloadIgnoringCache());
        },
        clearSiteData: () => this.runDevCommand('clear-site-data'),
      },
    );
    this.popup(template);
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

  private popup(template: Electron.MenuItemConstructorOptions[]): void {
    Menu.buildFromTemplate(template).popup({ window: this.window });
  }

  private showContextMenu(contents: Electron.WebContents, params: Electron.ContextMenuParams): void {
    const tabs = this.tabs;
    const history = contents.navigationHistory;
    const isPrivate = tabs.isPrivateContents(contents);
    const translation = tabs.state().tabs.find((tab) => tab.id === tabs.activeTabId)?.translation;
    const template = contextMenuTemplate(params, {
      translation:
        translation?.available && translation.status !== 'translating'
          ? {
              label: translation.status === 'translated' ? 'Özgün sayfayı göster' : 'Sayfayı çevir',
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
    const { radius, ...bounds } = pageFrame(width, height, this.layout, this.isPageFullScreen());
    this.tabs.setPageLayout(bounds, this.isPageFullScreen() ? 0 : this.layout.newTabCenterOffset);
    this.tabs.setPageRadius(radius);
    this.pageArea = bounds;
    this.findBar.relayout(this.window);
    if (process.platform === 'darwin') {
      this.showWindowControls();
    }
  }
}
