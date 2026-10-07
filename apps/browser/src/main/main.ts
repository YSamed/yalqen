import { bench } from './bench/bench.js';
import fs from 'node:fs';
import path from 'node:path';
import { app, ipcMain, nativeTheme } from 'electron';
import {
  BOOKMARKS_URL,
  HISTORY_URL,
  NEW_TAB_URL,
  IpcChannel,
  type ChromeLayout,
  type AgentBridgeView,
  type ClearDataRequest,
  type UiAction,
  type SettingsView,
} from '../shared/types.js';
import { AdBlocker } from './privacy/adblock.js';
import { SiteProtections } from './privacy/site-protections.js';
import { registerAgentBridgeIpc } from './agent-bridge/agent-ipc.js';
import { AgentBridge, mcpUrl, setupSnippet } from './agent-bridge/bridge.js';
import type { BridgeHost } from './agent-bridge/tools.js';
import type { AgentProject } from './window/agent-project.js';
import {
  DEFAULT_TARGETS,
  connectionStates,
  repairConnections,
  type McpEndpoint,
} from './agent-bridge/agent-connections.js';
import { ActionRunner } from './agent-bridge/action-runner.js';
import { generateToken, tokenMatches } from './agent-bridge/auth.js';
import { createElectronHost } from './agent-bridge/electron-host.js';
import { isInScope } from './agent-bridge/tab-scope.js';
import { parseOtlpTraces } from './agent-bridge/tracing.js';
import { AgentTokenStore } from './agent-bridge/token-store.js';
import { benchPlanFromEnv, prepareBenchApp, runBench } from './bench/bench-driver.js';
import { BookmarkStore, runBookmarksCommand } from './library/bookmarks.js';
import {
  importBookmarkFile,
  importChromiumHistory,
  importFirefoxHistory,
  isFirefoxPlaces,
} from './library/browser-import.js';
import { CertificateExceptions, handleCertificateErrors } from './privacy/certificates.js';
import { clearSince } from './library/clear-data.js';
import { CommandBar } from './address-bar/command-bar.js';
import { DEFAULT_DEVICE_ID } from './devtools/devices.js';
import { DownloadManager } from './library/download-manager.js';
import { DownloadStore } from './library/downloads.js';
import { ExtensionPopup } from './extensions/extension-popup.js';
import { ExtensionManager } from './extensions/extensions.js';
import { registerExtensionsIpc } from './extensions/extensions-ipc.js';
import { registerWebStoreApi } from './extensions/web-store-api.js';
import { loadInternalPages, registerInternalScheme, serveInternalPages } from './pages/internal-pages.js';
import { HistoryStore } from './library/history.js';
import { RepoPrompt } from './app/repo-prompt.js';
import { HttpsOnly, hostResolverOptions } from './privacy/https-only.js';
import { chromeUserAgent } from './app/page-preferences.js';
import { FindBar } from './window/find-bar.js';
import { ExternalUrlInbox } from './app/external-urls.js';
import { startMemorySaver } from './tabs/memory-saver.js';
import { LAZY_SAVE_DELAY_MS } from './storage/json-file.js';
import { installAppMenu } from './app/app-menu.js';
import { getLocale, pickLocale, setLocale, t } from '../shared/i18n.js';
import { installPasswordHandlers, safeStorageCipher } from './privacy/password-handlers.js';
import { PasswordStore } from './privacy/passwords.js';
import { installDisplayMediaHandler } from './privacy/display-media.js';
import { installPermissionHandlers } from './privacy/permission-handlers.js';
import { PermissionStore } from './privacy/permissions.js';
import { RequestRuleStore } from './devtools/request-rules.js';
import { SessionStore, pinnedOnly, type SavedSession, type SavedTab } from './tabs/persistence.js';
import { SEARCH_ENGINES, isValidSearchTemplate, resolveSearchEngine } from './address-bar/search.js';
import { SettingsStore } from './app/settings.js';
import {
  broadcastAgentBridge,
  broadcastExtensions,
  broadcastPasswords,
  broadcastSettings,
  isSettingsFrame,
} from './app/settings-page.js';
import { registerSettingsIpc } from './app/settings-ipc.js';
import {
  applyCookieBlocking,
  applyPageLanguage,
  eachSession,
  forgetSessionData,
  openBrowsingSessions,
} from './app/sessions.js';
import { isDefaultBrowser } from './app/default-browser.js';
import { EMPTY_HISTORY_INDEX, suggest } from './address-bar/suggestions.js';
import { appIconPath, preloadPath, rendererPath } from './app/paths.js';
import { Updater, loadAutoUpdater } from './app/updater.js';
import { UsageReporter, USAGE_ENDPOINT } from './app/usage.js';
import { ChatPreferenceStore } from './agent-bridge/chat-preferences.js';
import { YalqenWindow, type AppContext, type WindowOptions } from './window/window.js';
import { ZoomStore } from './tabs/zoom.js';

const COMMAND_BAR_PREWARM_MS = 5000;

bench?.mark('modules-loaded');
if (bench) prepareBenchApp();
// The profile folder keeps its prototype name: renaming it would leave every existing profile behind.
app.setPath('userData', bench?.profile ?? path.join(app.getPath('appData'), 'yalqen-electron-prototype'));

const appIcon = appIconPath();

registerInternalScheme();
app.setName('Yalqen');
setLocale(pickLocale(app.getPreferredSystemLanguages()));

const primary = app.requestSingleInstanceLock();
const externalUrls = new ExternalUrlInbox(primary);

function startBrowser(): void {
  const userData = app.getPath('userData');
  app.userAgentFallback = chromeUserAgent(app.userAgentFallback);
  const sessions = openBrowsingSessions();
  const { daily, privateBrowsing, developer } = sessions;
  const settings = new SettingsStore(userData, getLocale());
  const siteProtections = new SiteProtections(
    () => settings.get(),
    (patch) => updateSettings(patch),
  );
  const cookiesAllowed = (url: string, isPrivate: boolean) =>
    siteProtections.isAllowed('blockThirdPartyCookies', url, isPrivate);
  const { interfaceLanguage } = settings.get();
  if (interfaceLanguage !== 'system') setLocale(interfaceLanguage);
  const history = new HistoryStore(userData);
  const repoPrompt = new RepoPrompt(userData);
  const chatPreferences = new ChatPreferenceStore(userData);
  const downloads = new DownloadStore(userData);
  const bookmarks = new BookmarkStore(userData);
  const store = new SessionStore(userData);
  const defaultZoom = () => settings.get().defaultZoom;
  const zoom = new ZoomStore(userData, defaultZoom);
  const permissions = new PermissionStore(userData);
  const passwords = new PasswordStore(userData, safeStorageCipher);
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
  let quitPending = false;
  const confirmQuit = async (): Promise<boolean> => {
    const open = [...windows];
    for (const window of open) {
      if (!(await window.tabs.confirmCloseAll())) return false;
    }
    if (open.length !== windows.length || open.some((window, index) => windows[index] !== window)) return false;
    for (const window of open) window.approveClose();
    return true;
  };
  let started = false;
  const eachWindow = (run: (window: YalqenWindow) => void) => {
    for (const window of [...windows]) run(window);
  };
  const pushState = () => eachWindow((window) => window.pushState());
  const extensions = new ExtensionManager(
    userData,
    daily,
    () => {
      pushState();
      broadcastExtensions(extensions.list());
    },
    { automatic: () => settings.get().autoUpdateExtensions },
  );
  const extensionPopup = new ExtensionPopup();
  const reloadPages = (prefix: string) => eachWindow((window) => window.tabs.reloadPages(prefix));
  const windowOf = (contents: Electron.WebContents) =>
    windows.find((window) => window.tabs.hasContents(contents)) ?? current;
  const windowsToSave = () =>
    windows.filter((window) => !window.isPrivate).map((window) => window.tabs.toSavedWindow());
  const sessionSnapshot = (): SavedSession => {
    const saved = windowsToSave();
    return {
      version: 2,
      windows:
        settings.get().startupBehavior === 'restore'
          ? saved
          : saved.map(pinnedOnly).filter((window) => window.tabs.length > 0),
    };
  };

  applyPageLanguage(sessions, settings.get().pageLanguage);
  applyCookieBlocking(sessions, settings.get().blockThirdPartyCookies, cookiesAllowed);
  installPermissionHandlers({
    sessions: [
      [daily, false],
      [privateBrowsing, true],
      [developer, true],
    ],
    storeFor: permissionsFor,
    parentOf: (contents) => windowOf(contents)?.window,
  });
  installDisplayMediaHandler({
    sessions: [daily, privateBrowsing, developer],
    parentOf: (contents) => windowOf(contents)?.window,
  });
  installPasswordHandlers({
    store: passwords,
    savesPasswords: (contents) =>
      contents.session === daily && windows.some((window) => window.tabs.hasContents(contents)),
    parentOf: (contents) => windowOf(contents)?.window,
    isSettingsFrame,
    onChange: () => broadcastPasswords(passwords.view()),
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
    directory: () => settings.get().downloadDirectory ?? app.getPath('downloads'),
    askBeforeDownload: () => settings.get().askBeforeDownload,
    askDownloadLocation: () => settings.get().askDownloadLocation,
    parentOf: (contents) => windowOf(contents)?.window,
    onStateChange: pushState,
  });
  const downloadsChanged = () => downloadManager.changed();

  const agentTokens = new AgentTokenStore(userData, safeStorageCipher);
  const focusedFirst = () => (current ? [current, ...windows.filter((window) => window !== current)] : windows);
  const projectAgents = new Map<AgentProject, { token: string; host: BridgeHost }>();
  const projectAgent = (window: YalqenWindow, project: AgentProject) => {
    let agent = projectAgents.get(project);
    if (!agent) {
      const host = createElectronHost(
        () => [window.tabs],
        agentActions,
        (url) => window.projectIncludes(project, url),
      );
      agent = { token: generateToken(), host };
      projectAgents.set(project, agent);
    }
    return agent;
  };
  const agentActions = new ActionRunner({
    policy: () => settings.get().agentActions,
    windows: () => focusedFirst().map((window) => window.agentActionWindow()),
    inScope: (url) => isInScope({ url, isPrivate: false }, settings.get().agentOrigins),
  });
  const agentBridge = new AgentBridge({
    enabled: () => settings.get().agentBridge,
    host: createElectronHost(() => focusedFirst().map((window) => window.tabs), agentActions),
    token: () => agentTokens.get(),
    scopedHost: (token) => [...projectAgents.values()].find((agent) => tokenMatches(token, agent.token))?.host ?? null,
    version: app.getVersion(),
    onChange: () => {
      eachWindow((window) => window.tabs.syncAgent());
      broadcastAgentBridge(agentView());
      repairAgentConnections();
    },
    onTraces: (body) => {
      if (!settings.get().agentTracing) return;
      const spans = parseOtlpTraces(body);
      eachWindow((window) => {
        for (const tab of window.tabs.observedTabs()) tab.agent?.addSpans(spans);
      });
    },
  });
  const mcpEndpoint = (): McpEndpoint | null => {
    const port = agentBridge.port;
    return port ? { url: mcpUrl(port), token: agentTokens.get() } : null;
  };
  let connectionsRevision = 0;
  const connectionsChanged = () => {
    connectionsRevision++;
    broadcastAgentBridge(agentView());
  };
  let repairedFor = '';
  const repairAgentConnections = () => {
    const endpoint = mcpEndpoint();
    const key = endpoint ? `${endpoint.url} ${endpoint.token}` : '';
    if (!endpoint || key === repairedFor) return;
    repairedFor = key;
    void repairConnections(endpoint).then(
      (repaired) => repaired.length > 0 && connectionsChanged(),
      () => undefined,
    );
  };
  const agentView = (): AgentBridgeView => {
    const status = agentBridge.status();
    const port = status.port;
    return {
      ...status,
      url: port ? mcpUrl(port) : null,
      claudeCommand: port ? setupSnippet('claude', port, '<token>') : null,
      codexConfig: port ? setupSnippet('codex', port, '<token>') : null,
      otelConfig: port ? setupSnippet('otel', port, '<token>') : null,
      observedTabs: windows.reduce((count, window) => count + window.tabs.observedTabs().length, 0),
      connectionsRevision,
    };
  };
  registerAgentBridgeIpc({
    view: agentView,
    snippet: (kind) => agentBridge.snippet(kind),
    regenerateToken: () => {
      agentTokens.regenerate();
      broadcastAgentBridge(agentView());
      repairAgentConnections();
    },
    connections: async () => {
      const endpoint = mcpEndpoint();
      return endpoint ? connectionStates(endpoint) : null;
    },
    connect: async (id) => {
      const endpoint = mcpEndpoint();
      if (!endpoint) return { ok: false, reason: 'failed', detail: 'The agent connection is not running.' };
      const result = await DEFAULT_TARGETS[id].connect(endpoint);
      connectionsChanged();
      return result;
    },
    disconnect: async (id) => {
      const result = await DEFAULT_TARGETS[id].disconnect();
      connectionsChanged();
      return result;
    },
  });

  handleCertificateErrors(certificates, eachSession(sessions));
  const adBlocker = new AdBlocker([daily, privateBrowsing], path.join(userData, 'adblock-engine.bin'), (session, url) =>
    siteProtections.isAllowed('adBlocking', url, session === privateBrowsing),
  );
  adBlocker.setEnabled(settings.get().adBlocking);
  const searchEngine = () => resolveSearchEngine(settings.get().searchEngine, settings.get().customSearchTemplate);
  const commandBar = new CommandBar({
    preload: preloadPath('command-preload'),
    page: rendererPath('command.html'),
  });
  const findBar = new FindBar({
    preload: preloadPath('find-preload'),
    page: rendererPath('find.html'),
  });
  nativeTheme.themeSource = settings.get().theme;
  let deviceId = DEFAULT_DEVICE_ID;

  const settingsView = (): SettingsView => {
    const { version: _version, ...values } = settings.get();
    return {
      values,
      downloadDirectory: values.downloadDirectory ?? app.getPath('downloads'),
      defaultBrowser: isDefaultBrowser(),
      engines: SEARCH_ENGINES.map(({ id, label }) => ({ id, label })),
      customTemplateValid: isValidSearchTemplate(values.customSearchTemplate),
      version: app.getVersion(),
      update: updater.status(),
    };
  };
  const updater = new Updater({
    load: app.isPackaged && !bench ? loadAutoUpdater : null,
    automatic: () => settings.get().autoUpdate,
    onChange: () => broadcastSettings(settingsView()),
    // quitAndInstall closes the windows before before-quit fires, so the session is saved first.
    beforeInstall: async () => {
      if (!(await confirmQuit())) return false;
      quitting = true;
      store.saveNow({ version: 2, windows: windowsToSave(), resume: true });
      return true;
    },
  });
  const updateSettings = (patch: unknown) => {
    const previous = settings.get();
    const next = settings.update(patch);
    if (next === previous) return;
    if (next.defaultZoom !== previous.defaultZoom) eachWindow((window) => window.tabs.applyDefaultZoom());
    if (next.pageLanguage !== previous.pageLanguage) applyPageLanguage(sessions, next.pageLanguage);
    if (next.secureDns !== previous.secureDns) app.configureHostResolver(hostResolverOptions(next.secureDns));
    nativeTheme.themeSource = next.theme;
    if (next.freezeBackgroundTabs !== previous.freezeBackgroundTabs)
      eachWindow((window) => window.tabs.applyFreezeSetting());
    if (next.autoUpdate !== previous.autoUpdate) updater.schedule();
    if (next.autoUpdateExtensions !== previous.autoUpdateExtensions && !bench) extensions.scheduleUpdates();
    if (next.usageCounting !== previous.usageCounting) usage.schedule();
    if (next.agentBridge !== previous.agentBridge) void agentBridge.sync();
    else if (next.agentOrigins !== previous.agentOrigins) eachWindow((window) => window.tabs.syncAgent());
    if (next.agentTracing !== previous.agentTracing) eachWindow((window) => window.tabs.refreshRequestRules());
    adBlocker.setEnabled(next.adBlocking);
    applyCookieBlocking(sessions, next.blockThirdPartyCookies, cookiesAllowed);
    pushState();
    broadcastSettings(settingsView());
  };

  const usage = new UsageReporter({
    directory: userData,
    endpoint: app.isPackaged && !bench ? USAGE_ENDPOINT : null,
    enabled: () => settings.get().usageCounting,
    active: () => windows.some((window) => !window.isPrivate && !window.window.isDestroyed()),
  });

  const context: AppContext = {
    icon: appIcon,
    daily,
    privateBrowsing,
    developer,
    requestRules,
    settings,
    siteProtections,
    commandBar,
    findBar,
    history,
    repoPrompt,
    dismissAnnouncement: () => settings.update({ dismissedAnnouncement: app.getVersion() }),
    dismissFeedback: () => settings.update({ dismissedFeedback: app.getVersion() }),
    dismissUpdate: () => {
      const status = updater.status();
      if (status.state === 'ready') settings.update({ dismissedUpdate: status.version });
    },
    installUpdate: () => updater.install(),
    chatPreferences,
    downloads,
    bookmarks,
    extensions,
    extensionPopup,
    certificates,
    httpsOnly,
    closedTabs,
    pageTheme: fs.readFileSync(rendererPath('tokens.css'), 'utf8'),
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
    importBookmarks: async (file) => {
      const result = await importBookmarkFile(bookmarks, file);
      if (result.bookmarks > 0 || result.folders > 0) bookmarksChanged();
      return result;
    },
    importHistory: async (file) => {
      const result = await (isFirefoxPlaces(file) ? importFirefoxHistory : importChromiumHistory)(history, file);
      if (result.visits > 0) reloadPages(HISTORY_URL);
      return result;
    },
    runDownloadsCommand: (command, params) => downloadManager.runCommand(command, params),
    updateSettings,
    deviceId: () => deviceId,
    openWindow: (options) => openWindow(options),
    switchProfile: (profile, from) => {
      const target = [...windows].reverse().find((window) => window.profile === profile);
      if (target) target.focus();
      else openWindow({ developer: profile === 'developer', isPrivate: profile === 'private', from });
    },
    onWindowChange: (persist) => {
      if (persist && !quitting)
        store.scheduleSave(sessionSnapshot, persist === 'lazy' ? LAZY_SAVE_DELAY_MS : undefined);
    },
    onPrivateTabsClosed: () => {
      if (windows.some((window) => !window.isDeveloper && window.tabs.hasPrivateTabs)) return;
      siteProtections.clearPrivate();
      privatePermissions = new PermissionStore(null);
      privateZoom = new ZoomStore(null, defaultZoom);
      downloads.removePrivate();
      downloadsChanged();
      forgetSessionData(privateBrowsing);
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
    agentScope: (url, privateBrowsing) =>
      agentBridge.port !== null && isInScope({ url, isPrivate: privateBrowsing }, settings.get().agentOrigins),
    agentConnection: async (window, project) => {
      if (!settings.get().agentBridge) updateSettings({ agentBridge: true });
      await agentBridge.sync();
      if (agentBridge.port === null) throw new Error('Agent connection unavailable');
      return { url: mcpUrl(agentBridge.port), token: projectAgent(window, project).token };
    },
    releaseAgentConnection: (project) => projectAgents.delete(project),
    onWindowClosed: (window) => {
      const index = windows.indexOf(window);
      if (index >= 0) windows.splice(index, 1);
      if (window.isDeveloper && !windows.some((other) => other.isDeveloper)) forgetSessionData(developer);
      if (current === window) current = windows.at(-1) ?? null;
    },
  };

  const openWindow = (options: WindowOptions): YalqenWindow => {
    const window = new YalqenWindow(context, options);
    windows.push(window);
    current = window;
    return window;
  };

  const internalPages = loadInternalPages({
    newTab: rendererPath('newtab.html'),
    newTabScript: rendererPath('newtab-suggestions.js'),
    history: rendererPath('history.html'),
    downloads: rendererPath('downloads.html'),
    bookmarks: rendererPath('bookmarks.html'),
    settings: rendererPath('settings.html'),
  });
  for (const [browsing, isPrivate] of [
    [daily, false],
    [privateBrowsing, true],
    [developer, true],
  ] as const) {
    serveInternalPages(browsing, internalPages, {
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
      readyUpdate: () => {
        const status = updater.status();
        return !isPrivate && status.state === 'ready' && settings.get().dismissedUpdate !== status.version
          ? status.version
          : null;
      },
      showAnnouncement: () => !isPrivate && settings.get().dismissedAnnouncement !== app.getVersion(),
      showFeedback: () => !isPrivate && settings.get().dismissedFeedback !== app.getVersion(),
      showRepoPrompt: () => !isPrivate && repoPrompt.take(),
      suggestions: (query) =>
        suggest(query, {
          tabs: [],
          bookmarks: bookmarks.suggestions(),
          history: isPrivate ? EMPTY_HISTORY_INDEX : history.index(),
        }),
    });
  }

  installAppMenu({
    current: () => current,
    openWindow,
    settings,
    updateSettings,
    updater,
    toggleBookmark: context.toggleBookmark,
    deviceId: () => deviceId,
    selectDevice: (id) => {
      deviceId = id;
    },
  });

  const senderWindow = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    windows.find((window) => window.uiContents === event.sender);
  ipcMain.handle(IpcChannel.getState, (event) => senderWindow(event)?.state() ?? null);
  ipcMain.on(IpcChannel.setLayout, (event, next: ChromeLayout) => senderWindow(event)?.setLayout(next));
  ipcMain.on(IpcChannel.action, (event, action: UiAction) => senderWindow(event)?.handleAction(action));
  // Agent access belongs only to the browser chrome's main frame, never a browsing tab.
  const agentSenderWindow = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
    event.senderFrame === event.sender.mainFrame ? senderWindow(event) : undefined;
  ipcMain.handle(IpcChannel.agentSnapshot, (event) => agentSenderWindow(event)?.agentSession.snapshot() ?? null);
  ipcMain.handle(IpcChannel.agentSelectDirectory, (event) => agentSenderWindow(event)?.selectAgentDirectory() ?? null);
  ipcMain.handle(
    IpcChannel.agentStart,
    (event, size: unknown) => agentSenderWindow(event)?.startAgentSession(size) ?? null,
  );
  ipcMain.handle(IpcChannel.agentStop, (event, id: unknown) => agentSenderWindow(event)?.agentSession.stop(id));
  ipcMain.on(IpcChannel.agentInput, (event, id: unknown, data: unknown) =>
    agentSenderWindow(event)?.agentSession.write(id, data),
  );
  ipcMain.on(IpcChannel.agentResize, (event, id: unknown, size: unknown) =>
    agentSenderWindow(event)?.agentSession.resize(id, size),
  );
  ipcMain.handle(IpcChannel.agentElementRemove, (event, id: unknown) =>
    agentSenderWindow(event)?.removeAgentElement(id),
  );
  ipcMain.handle(
    IpcChannel.agentElementHighlight,
    (event, id: unknown) => agentSenderWindow(event)?.highlightAgentElement(id) ?? false,
  );
  ipcMain.handle(IpcChannel.projectRunStart, (event) => agentSenderWindow(event)?.startProjectRun() ?? false);
  ipcMain.handle(IpcChannel.projectRunStop, (event) => agentSenderWindow(event)?.projectRunner.stop());
  ipcMain.handle(IpcChannel.agentChatSnapshot, (event) => agentSenderWindow(event)?.agentChat.snapshot() ?? null);
  ipcMain.handle(IpcChannel.visualComparisonGet, (event) => agentSenderWindow(event)?.getVisualComparison() ?? null);
  ipcMain.handle(IpcChannel.visualComparisonCapture, (event, stage: unknown, tabId: unknown) => {
    const window = agentSenderWindow(event);
    if (!window) throw new Error('visual-comparison:unavailable');
    return window.captureVisualComparison(stage, tabId);
  });
  ipcMain.handle(IpcChannel.visualComparisonClear, (event) => agentSenderWindow(event)?.clearVisualComparison());
  ipcMain.handle(
    IpcChannel.visualComparisonReview,
    (event) => agentSenderWindow(event)?.getVisualComparisonReview() ?? null,
  );
  ipcMain.handle(IpcChannel.responsiveScanGet, (event) => agentSenderWindow(event)?.getResponsiveScan() ?? null);
  ipcMain.handle(IpcChannel.responsiveScanRun, (event, tabId: unknown) => {
    const window = agentSenderWindow(event);
    if (!window) throw new Error('responsive-scan:unavailable');
    return window.runResponsiveScan(tabId);
  });
  ipcMain.handle(IpcChannel.responsiveScanCancel, (event) => agentSenderWindow(event)?.cancelResponsiveScan());
  ipcMain.handle(IpcChannel.responsiveScanClear, (event) => agentSenderWindow(event)?.clearResponsiveScan());
  ipcMain.handle(
    IpcChannel.responsiveScanReview,
    (event) => agentSenderWindow(event)?.getResponsiveScanReview() ?? null,
  );
  ipcMain.handle(
    IpcChannel.agentChatSend,
    (event, id: unknown, text: unknown, tabIds: unknown, images: unknown) =>
      agentSenderWindow(event)?.sendAgentChat(id, text, tabIds, images) ?? false,
  );
  ipcMain.handle(
    IpcChannel.agentChatFix,
    (event, tabId: unknown) => agentSenderWindow(event)?.fixAgentEpisode(tabId) ?? false,
  );
  ipcMain.handle(IpcChannel.agentChatInterrupt, (event, id: unknown) =>
    agentSenderWindow(event)?.agentChat.interrupt(id),
  );
  ipcMain.handle(IpcChannel.agentChatSignIn, (event) => agentSenderWindow(event)?.signInAgent() ?? false);
  ipcMain.handle(IpcChannel.agentChatSignOut, (event) => agentSenderWindow(event)?.signOutAgent() ?? false);
  ipcMain.handle(IpcChannel.agentChatNew, (event) => agentSenderWindow(event)?.newAgentChat());
  ipcMain.handle(
    IpcChannel.agentChatShowBackground,
    (event, id: unknown) => agentSenderWindow(event)?.showBackgroundAgentChat(id) ?? false,
  );
  ipcMain.handle(
    IpcChannel.agentChatDismissBackground,
    (event, id: unknown) => agentSenderWindow(event)?.dismissBackgroundAgentChat(id) ?? false,
  );
  ipcMain.handle(
    IpcChannel.agentChatOpenBackground,
    (event, id: unknown) => agentSenderWindow(event)?.openBackgroundAgentChatInTab(id) ?? false,
  );
  ipcMain.handle(
    IpcChannel.agentChatContinueBackground,
    (event, id: unknown) => agentSenderWindow(event)?.continueAgentChatInProject(id) ?? false,
  );
  ipcMain.handle(IpcChannel.agentChatReset, (event, id: unknown) => agentSenderWindow(event)?.agentChat.reset(id));
  ipcMain.handle(
    IpcChannel.agentChatPermission,
    (event, id: unknown, requestId: unknown, allow: unknown, answers: unknown, always: unknown) =>
      agentSenderWindow(event)?.agentChat.respond(id, requestId, allow, answers, always),
  );
  ipcMain.handle(IpcChannel.agentChatConfigure, (event, id: unknown, settings: unknown) =>
    agentSenderWindow(event)?.agentChat.configure(id, settings),
  );
  ipcMain.handle(
    IpcChannel.agentChatRewind,
    (event, id: unknown, messageId: unknown, dryRun: unknown) =>
      agentSenderWindow(event)?.agentChat.rewind(id, messageId, dryRun) ?? null,
  );
  ipcMain.handle(IpcChannel.agentChatHistory, (event) => agentSenderWindow(event)?.agentChat.history() ?? []);
  ipcMain.handle(
    IpcChannel.agentChatOpen,
    (event, sessionId: unknown, fork: unknown) => agentSenderWindow(event)?.agentChat.open(sessionId, fork) ?? false,
  );
  ipcMain.handle(
    IpcChannel.agentChatDelete,
    (event, sessionId: unknown) => agentSenderWindow(event)?.agentChat.delete(sessionId) ?? false,
  );
  ipcMain.handle(
    IpcChannel.agentChatProvider,
    (event, provider: unknown) => agentSenderWindow(event)?.selectAgentProvider(provider) ?? false,
  );
  ipcMain.handle(IpcChannel.agentProjectAdd, (event) => agentSenderWindow(event)?.newAgentProject() ?? false);
  ipcMain.handle(
    IpcChannel.agentProjectSelect,
    (event, id: unknown) => agentSenderWindow(event)?.selectAgentProject(id) ?? false,
  );
  ipcMain.handle(
    IpcChannel.agentProjectClose,
    (event, id: unknown) => agentSenderWindow(event)?.closeAgentProject(id) ?? false,
  );
  ipcMain.handle(
    IpcChannel.agentChatFiles,
    (event, query: unknown) => agentSenderWindow(event)?.searchAgentFiles(query) ?? [],
  );
  ipcMain.handle(
    IpcChannel.agentChatOpenFile,
    (event, path: unknown) => agentSenderWindow(event)?.openAgentFile(path) ?? false,
  );
  ipcMain.handle(IpcChannel.agentChatCancelQueued, (event, id: unknown, messageId: unknown) =>
    agentSenderWindow(event)?.agentChat.cancelQueued(id, messageId),
  );
  registerWebStoreApi({
    daily,
    extensions,
    parentWindow: (contents) => windowOf(contents)?.window ?? null,
  });
  registerExtensionsIpc({
    extensions,
    parentWindow: (contents) => windowOf(contents)?.window,
    openTab: (contents, url) => {
      windowOf(contents)?.tabs.open(url, { isPrivate: false });
    },
  });
  const clearData = async (request: ClearDataRequest) => {
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
  };
  registerSettingsIpc({
    view: settingsView,
    update: updateSettings,
    clearData,
    updater,
    relaunch: () => {
      void confirmQuit().then((allowed) => {
        if (!allowed) return;
        quitting = true;
        store.saveNow(sessionSnapshot());
        // Release only after consent: cancelling must not schedule a later relaunch.
        app.releaseSingleInstanceLock();
        app.relaunch();
        app.quit();
      });
    },
    requestRules,
    permissions,
    onRequestRulesSaved: () => eachWindow((window) => window.tabs.refreshRequestRules()),
  });

  const stopMemorySaver = startMemorySaver({
    tabSets: () => windows.map((window) => window.tabs),
    afterMinutes: () => settings.get().discardAfterMinutes,
  });

  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault();
    if (quitPending) return;
    quitPending = true;
    void confirmQuit().then((allowed) => {
      quitPending = false;
      if (!allowed) return;
      quitting = true;
      store.saveNow(sessionSnapshot());
      app.quit();
    });
  });
  app.on('will-quit', () => {
    stopMemorySaver();
    void agentBridge.stop();
    updater.stop();
    usage.stop();
    downloadManager.destroy();
    adBlocker.destroy();
    commandBar.destroy();
    findBar.destroy();
    extensionPopup.close();
    extensions.stopUpdates();
    extensions.saveNow();
    history.saveNow();
    repoPrompt.saveNow();
    chatPreferences.saveNow();
    downloads.saveNow();
    bookmarks.saveNow();
    zoom.saveNow();
    permissions.saveNow();
    passwords.saveNow();
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
    const saved = store.load();
    const restoring = settings.get().startupBehavior === 'restore' || saved?.resume === true;
    const savedWindows = saved?.windows ?? [];
    const restored = (restoring ? savedWindows : savedWindows.map(pinnedOnly)).filter(
      (window) => window.tabs.length > 0,
    );
    const openExternal = (urls: string[]) => {
      const window = current && !current.window.isDestroyed() ? current : openWindow({ url: urls.shift() });
      for (const url of urls) window.tabs.open(url);
      window.focus();
    };
    const [first, ...rest] = externalUrls.deliverTo(openExternal);
    if (restored.length === 0) openWindow(first ? { url: first } : {});
    restored.forEach((window, index) =>
      openWindow({ saved: window, url: !restoring && index === restored.length - 1 ? first : undefined }),
    );
    if (restoring && restored.length > 0 && first) openExternal([first, ...rest]);
    else if (rest.length > 0) openExternal(rest);
  };
  void extensions.loadAll().then(() => {
    bench?.mark('extensions-loaded');
    if (!bench) extensions.scheduleUpdates();
    openInitialWindows();
    usage.schedule();
    void agentBridge.sync();
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
  version: t('main.aboutVersion', { electron: process.versions.electron }),
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
