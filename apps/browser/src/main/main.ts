import { bench } from './bench.js';
import fs from 'node:fs';
import path from 'node:path';
import { BaseWindow, Menu, app, dialog, ipcMain, nativeTheme, session } from 'electron';
import {
  BOOKMARKS_URL,
  ExtensionsChannel,
  HISTORY_URL,
  NEW_TAB_URL,
  IpcChannel,
  RequestRulesChannel,
  SettingsChannel,
  type ChromeLayout,
  type UiAction,
  type SettingsView,
} from '../shared/types.js';
import { AdBlocker } from './adblock.js';
import { benchPlanFromEnv, prepareBenchApp, runBench } from './bench-driver.js';
import { BookmarkStore, runBookmarksCommand } from './bookmarks.js';
import { CertificateExceptions } from './certificates.js';
import { clearSince, sanitizeClearRequest } from './clear-data.js';
import { CommandBar } from './command-bar.js';
import { DEFAULT_DEVICE_ID, DEVICES } from './devices.js';
import { DownloadManager } from './download-manager.js';
import { DownloadStore } from './downloads.js';
import { ExtensionPopup } from './extension-popup.js';
import { ExtensionManager } from './extensions.js';
import { loadInternalPages, registerInternalScheme, serveInternalPages } from './internal-pages.js';
import { HistoryStore } from './history.js';
import { HttpsOnly, hostResolverOptions } from './https-only.js';
import { acceptLanguages, chromeUserAgent, spellCheckerLanguages } from './page-preferences.js';
import { setThirdPartyCookieBlocking } from './third-party-cookies.js';
import { FindBar } from './find-bar.js';
import { externalUrls } from './launch.js';
import { DISCARD_CHECK_MS, pressureVictim, readMemoryPressure } from './memory-saver.js';
import { LAZY_SAVE_DELAY_MS } from './json-file.js';
import { buildMenu } from './menu.js';
import { installPermissionHandlers } from './permission-handlers.js';
import { PermissionStore } from './permissions.js';
import { processUsage } from './process-metrics.js';
import { RequestRuleStore } from './request-rules.js';
import { SessionStore, pinnedOnly, type SavedSession, type SavedTab } from './persistence.js';
import { SEARCH_ENGINES, isValidSearchTemplate, resolveSearchEngine } from './search.js';
import { SettingsStore } from './settings.js';
import { broadcastExtensions, broadcastSettings, isSettingsFrame } from './settings-page.js';
import { EMPTY_HISTORY_INDEX, suggest } from './suggestions.js';
import { recentPages } from './tabs.js';
import { YalqenWindow, type AppContext, type WindowOptions } from './window.js';
import { ZoomStore } from './zoom.js';

const DAILY_PARTITION = 'persist:daily';
const PRIVATE_PARTITION = 'private';
const DEVELOPER_PARTITION = 'developer';
const COMMAND_BAR_PREWARM_MS = 5000;

bench?.mark('modules-loaded');
if (bench) prepareBenchApp();
app.setPath('userData', bench?.profile ?? path.join(app.getPath('appData'), 'yalqen-electron-prototype'));

const appIcon = app.isPackaged
  ? path.join(process.resourcesPath, 'brand/icon-512.png')
  : path.resolve(app.getAppPath(), '../../design/brand/png/fitted/icon-512.png');

registerInternalScheme();
app.setName('Yalqen');

const primary = app.requestSingleInstanceLock();
const isFile = (file: string) => {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
};
const pendingUrls: string[] = primary ? externalUrls(process.argv.slice(1), process.cwd(), isFile) : [];
let openExternal: ((urls: string[]) => void) | null = null;
const receiveUrls = (urls: string[]) => {
  if (urls.length === 0) return;
  if (openExternal) openExternal(urls);
  else pendingUrls.push(...urls);
};
app.on('open-url', (event, url) => {
  event.preventDefault();
  receiveUrls(externalUrls([url], process.cwd(), isFile));
});
app.on('open-file', (event, file) => {
  event.preventDefault();
  receiveUrls(externalUrls([file], process.cwd(), isFile));
});
app.on('second-instance', (_event, argv, workingDirectory) => {
  receiveUrls(externalUrls(argv.slice(1), workingDirectory, isFile));
});

function startBrowser(): void {
  const userData = app.getPath('userData');
  app.userAgentFallback = chromeUserAgent(app.userAgentFallback);
  const daily = session.fromPartition(DAILY_PARTITION);
  const privateBrowsing = session.fromPartition(PRIVATE_PARTITION);
  const developer = session.fromPartition(DEVELOPER_PARTITION);
  const settings = new SettingsStore(userData);
  const history = new HistoryStore(userData);
  const downloads = new DownloadStore(userData);
  const bookmarks = new BookmarkStore(userData);
  const store = new SessionStore(userData);
  const defaultZoom = () => settings.get().defaultZoom;
  const zoom = new ZoomStore(userData, defaultZoom);
  const permissions = new PermissionStore(userData);
  const requestRules = new RequestRuleStore(userData);
  const certificates = new CertificateExceptions();
  const httpsOnly = new HttpsOnly(() => settings.get().httpsOnly);
  app.configureHostResolver(hostResolverOptions(settings.get().secureDns));
  bench?.mark('stores-loaded');
  const closedTabs: SavedTab[] = [];
  let privatePermissions = new PermissionStore(null);
  let privateZoom = new ZoomStore(null, defaultZoom);
  const permissionsFor = (isPrivate: boolean) => (isPrivate ? privatePermissions : permissions);

  const windows: YalqenWindow[] = [];
  let current: YalqenWindow | null = null;
  let quitting = false;
  let started = false;
  const eachWindow = (run: (window: YalqenWindow) => void) => {
    for (const window of [...windows]) run(window);
  };
  const pushState = () => eachWindow((window) => window.pushState());
  const extensions = new ExtensionManager(userData, daily, () => {
    pushState();
    broadcastExtensions(extensions.list());
  });
  const extensionPopup = new ExtensionPopup();
  const reloadPages = (prefix: string) => eachWindow((window) => window.tabs.reloadPages(prefix));
  const windowOf = (contents: Electron.WebContents) =>
    windows.find((window) => window.tabs.hasContents(contents)) ?? current;
  const sessionSnapshot = (): SavedSession => {
    const saved = windows.filter((window) => !window.isPrivate).map((window) => window.tabs.toSavedWindow());
    return {
      version: 2,
      windows:
        settings.get().startupBehavior === 'restore'
          ? saved
          : saved.map(pinnedOnly).filter((window) => window.tabs.length > 0),
    };
  };

  const applyLanguages = () => {
    const language = settings.get().pageLanguage;
    for (const browsing of [daily, privateBrowsing, developer]) {
      browsing.setUserAgent(browsing.getUserAgent(), acceptLanguages(language));
      if (process.platform !== 'darwin') browsing.setSpellCheckerLanguages(spellCheckerLanguages(language));
    }
  };
  applyLanguages();
  const applyCookieBlocking = () => {
    for (const browsing of [daily, privateBrowsing]) {
      setThirdPartyCookieBlocking(browsing, settings.get().blockThirdPartyCookies);
    }
  };
  applyCookieBlocking();
  setThirdPartyCookieBlocking(developer, false);
  installPermissionHandlers({
    sessions: [
      [daily, false],
      [privateBrowsing, true],
      [developer, true],
    ],
    storeFor: permissionsFor,
    parentOf: (contents) => windowOf(contents)?.window,
  });

  const bookmarksChanged = () => {
    pushState();
    reloadPages(BOOKMARKS_URL);
  };

  const downloadManager = new DownloadManager({
    store: downloads,
    daily,
    privateBrowsing,
    developer,
    directory: () => app.getPath('downloads'),
    onStateChange: pushState,
  });
  const downloadsChanged = () => downloadManager.changed();

  app.on('certificate-error', (event, contents, url, _error, certificate, callback, isMainFrame) => {
    const browsing = [daily, privateBrowsing, developer].includes(contents.session);
    if (browsing && certificates.allows(url, certificate.fingerprint)) {
      event.preventDefault();
      callback(true);
      return;
    }
    if (browsing && isMainFrame) certificates.reject(url, certificate.fingerprint);
    callback(false);
  });
  const adBlocker = new AdBlocker([daily, privateBrowsing], path.join(userData, 'adblock-engine.bin'));
  adBlocker.setEnabled(settings.get().adBlocking);
  const searchEngine = () => resolveSearchEngine(settings.get().searchEngine, settings.get().customSearchTemplate);
  const commandBar = new CommandBar({
    preload: path.join(__dirname, '../preload/command-preload.js'),
    page: path.join(__dirname, '../renderer/command.html'),
  });
  const findBar = new FindBar({
    preload: path.join(__dirname, '../preload/find-preload.js'),
    page: path.join(__dirname, '../renderer/find.html'),
  });
  nativeTheme.themeSource = settings.get().theme;
  let deviceId = DEFAULT_DEVICE_ID;

  const clientPath = app.isPackaged ? undefined : process.execPath;
  const clientArgs = app.isPackaged ? undefined : [path.resolve(process.argv[1] ?? '.')];
  const settingsView = (): SettingsView => {
    const { version: _version, ...values } = settings.get();
    return {
      values,
      defaultBrowser: app.isDefaultProtocolClient('https', clientPath, clientArgs),
      engines: SEARCH_ENGINES.map(({ id, label }) => ({ id, label })),
      customTemplateValid: isValidSearchTemplate(values.customSearchTemplate),
    };
  };
  const updateSettings = (patch: unknown) => {
    const previous = settings.get();
    const next = settings.update(patch);
    if (next === previous) return;
    if (next.defaultZoom !== previous.defaultZoom) eachWindow((window) => window.tabs.applyDefaultZoom());
    if (next.pageLanguage !== previous.pageLanguage) applyLanguages();
    if (next.secureDns !== previous.secureDns) app.configureHostResolver(hostResolverOptions(next.secureDns));
    nativeTheme.themeSource = next.theme;
    if (next.freezeBackgroundTabs !== previous.freezeBackgroundTabs)
      eachWindow((window) => window.tabs.applyFreezeSetting());
    adBlocker.setEnabled(next.adBlocking);
    applyCookieBlocking();
    pushState();
    broadcastSettings(settingsView());
  };

  const context: AppContext = {
    icon: appIcon,
    daily,
    privateBrowsing,
    developer,
    requestRules,
    settings,
    commandBar,
    findBar,
    history,
    downloads,
    bookmarks,
    extensions,
    extensionPopup,
    certificates,
    httpsOnly,
    closedTabs,
    permissionsFor,
    zoomFor: (isPrivate) => (isPrivate ? privateZoom : zoom),
    searchEngine,
    downloadActions: (window) => downloadManager.actions(() => window.tabs.openDownloads()),
    downloadsChanged,
    toggleBookmark: (url, title) => {
      const existing = bookmarks.find(url);
      if (existing) bookmarks.remove(existing.id);
      else bookmarks.add(url, title);
      bookmarksChanged();
    },
    runBookmarksCommand: (command, params) => {
      if (runBookmarksCommand(bookmarks, command, params)) bookmarksChanged();
    },
    runDownloadsCommand: (command, params) => downloadManager.runCommand(command, params),
    updateSettings,
    deviceId: () => deviceId,
    openWindow: (options) => openWindow(options),
    onWindowChange: (persist) => {
      if (persist && !quitting)
        store.scheduleSave(sessionSnapshot, persist === 'lazy' ? LAZY_SAVE_DELAY_MS : undefined);
    },
    onPrivateTabsClosed: () => {
      if (windows.some((window) => !window.isDeveloper && window.tabs.hasPrivateTabs)) return;
      privatePermissions = new PermissionStore(null);
      privateZoom = new ZoomStore(null, defaultZoom);
      downloads.removePrivate();
      downloadsChanged();
      void privateBrowsing.clearStorageData();
      void privateBrowsing.clearCache();
      void privateBrowsing.clearAuthCache();
      void privateBrowsing.closeAllConnections();
    },
    onWindowFocus: (window) => {
      current = window;
    },
    onWindowClosing: (window) => {
      if (quitting) return;
      if (windows.length === 1) {
        quitting = true;
        store.saveNow(sessionSnapshot());
        return;
      }
      const index = windows.indexOf(window);
      if (index >= 0) windows.splice(index, 1);
      store.scheduleSave(sessionSnapshot);
    },
    onWindowClosed: (window) => {
      const index = windows.indexOf(window);
      if (index >= 0) windows.splice(index, 1);
      if (window.isDeveloper && !windows.some((other) => other.isDeveloper)) {
        void developer.clearStorageData();
        void developer.clearCache();
        void developer.clearAuthCache();
        void developer.closeAllConnections();
      }
      if (current === window) current = windows.at(-1) ?? null;
    },
  };

  const openWindow = (options: WindowOptions): YalqenWindow => {
    const window = new YalqenWindow(context, options);
    windows.push(window);
    current = window;
    return window;
  };

  const rendererDir = path.join(__dirname, '../renderer');
  const internalPages = loadInternalPages({
    newTab: path.join(rendererDir, 'newtab.html'),
    newTabScript: path.join(rendererDir, 'newtab-suggestions.js'),
    history: path.join(rendererDir, 'history.html'),
    downloads: path.join(rendererDir, 'downloads.html'),
    bookmarks: path.join(rendererDir, 'bookmarks.html'),
    settings: path.join(rendererDir, 'settings.html'),
  });
  for (const [browsing, isPrivate] of [
    [daily, false],
    [privateBrowsing, true],
    [developer, true],
  ] as const) {
    serveInternalPages(browsing, internalPages, {
      recent: () => recentPages(closedTabs),
      pinned: () => [
        ...new Map(windows.flatMap((window) => window.tabs.pinnedPages).map((page) => [page.url, page])).values(),
      ],
      visits: (query) => history.list(query),
      downloads: { list: () => downloads.list(), changes: downloadManager.changes },
      bookmarks: (query) => ({ folders: bookmarks.folders(), bookmarks: bookmarks.bookmarks(query) }),
      showWelcome: () => {
        const showWelcome = !settings.get().welcomeCompleted;
        if (showWelcome) settings.update({ welcomeCompleted: true });
        return showWelcome;
      },
      suggestions: (query) =>
        suggest(query, {
          tabs: [],
          bookmarks: bookmarks.bookmarks(),
          history: isPrivate ? EMPTY_HISTORY_INDEX : history.index(),
        }),
    });
  }

  const inWindow = (run: (window: YalqenWindow) => void) => () => {
    run(current && !current.window.isDestroyed() ? current : openWindow({}));
  };
  Menu.setApplicationMenu(
    buildMenu({
      newTab: inWindow((window) => window.tabs.open()),
      newWindow: () => openWindow({ from: current ?? undefined }),
      newPrivateWindow: () => openWindow({ isPrivate: true, from: current ?? undefined }),
      newDeveloperWindow: () => openWindow({ developer: true, from: current ?? undefined }),
      newPrivateTab: inWindow((window) => window.tabs.open(NEW_TAB_URL, { isPrivate: true })),
      closeTab: () => {
        if (current?.tabs.activeTabId) current.tabs.close(current.tabs.activeTabId);
      },
      closeWindow: () => BaseWindow.getFocusedWindow()?.close(),
      reopenClosedTab: inWindow((window) => window.tabs.reopenClosed()),
      moveTabToNewWindow: inWindow((window) => window.moveActiveTabToNewWindow()),
      selectNextTab: inWindow((window) => window.tabs.selectRelative(1)),
      selectPreviousTab: inWindow((window) => window.tabs.selectRelative(-1)),
      selectTab: (index) => current?.tabs.selectByIndex(index),
      focusAddress: inWindow((window) => window.openAddress()),
      find: () => current?.openFind(),
      findNext: (forward) => current?.openFind(forward),
      reload: () => current?.tabs.reload(),
      hardReload: () => current?.tabs.reloadIgnoringCache(),
      zoom: (direction) => current?.tabs.zoom(direction),
      togglePanel: () => updateSettings({ panelCollapsed: !settings.get().panelCollapsed }),
      toggleSidebar: () => updateSettings({ sidebarVisible: !settings.get().sidebarVisible }),
      toggleToolbar: () => updateSettings({ toolbarVisible: !settings.get().toolbarVisible }),
      toggleDevTools: () => current?.tabs.toggleDevTools(),
      toggleDeviceView: () => current?.tabs.toggleEmulation(deviceId),
      rotateDevice: () => current?.tabs.rotateDevice(),
      devices: DEVICES.map((device) => ({
        id: device.id,
        label: device.label,
        checked: device.id === deviceId,
      })),
      selectDevice: (id) => {
        deviceId = id;
        current?.tabs.selectDevice(id);
      },
      openSettings: inWindow((window) => window.tabs.openSettings()),
      toggleBookmark: () => {
        const page = current?.tabs.activePage();
        if (page) context.toggleBookmark(page.url, page.title);
      },
      showBookmarks: inWindow((window) => window.tabs.openBookmarks()),
      print: () => current?.print(),
      savePdf: () => void current?.savePageAsPdf(),
      viewSource: () => current?.tabs.viewSource(),
      devCommand: (id) => current?.runDevCommand(id),
    }),
  );

  const senderWindow = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    windows.find((window) => window.uiContents === event.sender);
  ipcMain.handle(IpcChannel.getState, (event) => senderWindow(event)?.state() ?? null);
  ipcMain.on(IpcChannel.setLayout, (event, next: ChromeLayout) => senderWindow(event)?.setLayout(next));
  ipcMain.on(IpcChannel.action, (event, action: UiAction) => senderWindow(event)?.handleAction(action));
  ipcMain.handle(SettingsChannel.get, (event) => (isSettingsFrame(event) ? settingsView() : null));
  ipcMain.handle(RequestRulesChannel.list, (event) => (isSettingsFrame(event) ? requestRules.list() : null));
  ipcMain.handle(RequestRulesChannel.save, (event, rules: unknown) => {
    if (!isSettingsFrame(event)) return null;
    const saved = requestRules.save(rules);
    eachWindow((window) => window.tabs.refreshRequestRules());
    return saved;
  });
  ipcMain.handle(ExtensionsChannel.list, (event) => (isSettingsFrame(event) ? extensions.list() : null));
  ipcMain.handle(ExtensionsChannel.install, async (event) => {
    if (!isSettingsFrame(event)) return null;
    const parent = windowOf(event.sender)?.window;
    const options: Electron.OpenDialogOptions = {
      title: 'Uzantı klasörünü seçin',
      buttonLabel: 'Yükle',
      properties: ['openDirectory'],
    };
    const { canceled, filePaths } = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    return canceled || !filePaths[0] ? null : extensions.install(filePaths[0]);
  });
  ipcMain.handle(ExtensionsChannel.remove, (event, directory: unknown) => {
    if (isSettingsFrame(event) && typeof directory === 'string') extensions.remove(directory);
  });
  ipcMain.handle(ExtensionsChannel.setEnabled, async (event, directory: unknown, enabled: unknown) => {
    if (isSettingsFrame(event) && typeof directory === 'string' && typeof enabled === 'boolean') {
      await extensions.setEnabled(directory, enabled);
    }
  });
  ipcMain.handle(ExtensionsChannel.openOptions, (event, directory: unknown) => {
    const url = isSettingsFrame(event) && typeof directory === 'string' ? extensions.optionsUrl(directory) : null;
    if (url) windowOf(event.sender)?.tabs.open(url, { isPrivate: false });
  });
  ipcMain.handle(SettingsChannel.clearData, async (event, value: unknown) => {
    if (!isSettingsFrame(event)) return;
    const request = sanitizeClearRequest(value);
    if (!request) return;
    const since = clearSince(request.range, Date.now());
    if (request.history) {
      history.clearSince(since);
      closedTabs.length = 0;
      reloadPages(HISTORY_URL);
      reloadPages(NEW_TAB_URL);
    }
    if (request.downloads) {
      downloads.removeSince(since);
      downloadsChanged();
    }
    if (request.siteData) await daily.clearStorageData();
    if (request.cache) await daily.clearCache();
  });
  ipcMain.handle(SettingsChannel.makeDefault, (event) => {
    if (!isSettingsFrame(event)) return null;
    for (const scheme of ['http', 'https']) {
      if (!app.setAsDefaultProtocolClient(scheme, clientPath, clientArgs)) {
        console.warn(`[default-browser] the system did not accept ${scheme}`);
      }
    }
    return settingsView();
  });
  ipcMain.handle(SettingsChannel.processUsage, (event) => (isSettingsFrame(event) ? processUsage() : null));
  ipcMain.handle(SettingsChannel.update, (event, patch: unknown) => {
    if (!isSettingsFrame(event)) return null;
    updateSettings(patch);
    return settingsView();
  });

  const nextPressureVictim = () =>
    pressureVictim(
      windows.flatMap((window) => window.tabs.discardCandidates().map((tab) => ({ ...tab, window }))),
      Date.now(),
    );
  const discardUnderPressure = (count: number) => {
    for (let i = 0; i < count; i++) {
      const victim = nextPressureVictim();
      if (!victim?.window.tabs.discard(victim.id)) return;
    }
  };
  const discardTimer = setInterval(() => {
    const minutes = settings.get().discardAfterMinutes;
    if (minutes === 0) return;
    eachWindow((window) => window.tabs.discardInactive(Date.now(), minutes));
    if (!nextPressureVictim()) return;
    void readMemoryPressure().then((pressure) => {
      if (pressure !== 'normal') discardUnderPressure(pressure === 'critical' ? 3 : 1);
    });
  }, DISCARD_CHECK_MS);

  app.on('before-quit', () => {
    if (quitting) return;
    quitting = true;
    store.saveNow(sessionSnapshot());
  });
  app.on('will-quit', () => {
    clearInterval(discardTimer);
    downloadManager.destroy();
    adBlocker.destroy();
    commandBar.destroy();
    findBar.destroy();
    extensionPopup.close();
    extensions.saveNow();
    history.saveNow();
    downloads.saveNow();
    bookmarks.saveNow();
    zoom.saveNow();
    permissions.saveNow();
    requestRules.saveNow();
  });
  app.on('activate', () => {
    if (started && windows.length === 0 && !quitting) openWindow({});
  });

  // The first address bar open would otherwise wait for a new renderer, so it loads right after the first page.
  const prewarmCommandBar = () => {
    const warm = () => {
      bench?.mark('command-bar-prewarm');
      commandBar.prewarm();
    };
    current?.tabs.activeContents()?.once('did-stop-loading', warm);
    setTimeout(warm, COMMAND_BAR_PREWARM_MS);
  };

  // Content scripts only reach pages that load after their extension, so restored tabs wait for it.
  const openInitialWindows = () => {
    started = true;
    const restoring = settings.get().startupBehavior === 'restore';
    const savedWindows = store.load()?.windows ?? [];
    const restored = (restoring ? savedWindows : savedWindows.map(pinnedOnly)).filter(
      (window) => window.tabs.length > 0,
    );
    const [first, ...rest] = pendingUrls.splice(0);
    if (restored.length === 0) openWindow(first ? { url: first } : {});
    restored.forEach((window, index) =>
      openWindow({ saved: window, url: !restoring && index === restored.length - 1 ? first : undefined }),
    );
    openExternal = (urls) => {
      const window = current && !current.window.isDestroyed() ? current : openWindow({ url: urls.shift() });
      for (const url of urls) window.tabs.open(url);
      window.focus();
    };
    if (restoring && restored.length > 0 && first) openExternal([first, ...rest]);
    else if (rest.length > 0) openExternal(rest);
  };
  void extensions.loadAll().then(() => {
    bench?.mark('extensions-loaded');
    openInitialWindows();
    prewarmCommandBar();
    if (!bench) return;
    void runBench(
      bench,
      {
        window: () => current,
        adBlockerReady: () => adBlocker.whenReady(),
        commandBarPainted: () => commandBar.painted(),
        closeCommandBar: (window) => commandBar.close(window.window),
      },
      benchPlanFromEnv(process.env),
    );
  });
}

app.setAboutPanelOptions({
  applicationName: 'Yalqen',
  applicationVersion: app.getVersion(),
  version: `Faz 0 prototipi · Electron ${process.versions.electron}`,
  iconPath: appIcon,
});

if (!primary) {
  app.quit();
} else {
  app.whenReady().then(() => {
    bench?.mark('app-ready');
    app.dock?.setIcon(appIcon);
    startBrowser();
  });
}
app.on('window-all-closed', () => app.quit());
