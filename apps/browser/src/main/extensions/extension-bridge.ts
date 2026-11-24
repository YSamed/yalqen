import { randomUUID } from 'node:crypto';
import {
  app,
  ipcMain,
  nativeImage,
  Notification,
  webFrameMain,
  type ContextMenuParams,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type ServiceWorkerMain,
  type Session,
  type WebContents,
  type WebFrameMain,
} from 'electron';
import {
  authRedirectExtension,
  chromeWindow,
  extensionIdOf,
  ExtensionBridgeChannel,
  extensionTabUrl,
  type ExtensionBridgeEvent,
  type ExtensionWindowState,
  type ExtensionWindows,
  fragmentOnly,
  shortcutMatches,
  suggestedShortcut,
} from '../../shared/extension-bridge.js';
import { callCookies, chromeCookieChange, cookieUrl, extensionGrant, hostPermitted } from './extension-cookies.js';
import { ExtensionMenus } from './extension-menus.js';
import { extensionFile } from './extension-manifest.js';
import { ExtensionLibrary, suggestedFilename, type LibraryNamespace, type LibraryStores } from './extension-library.js';
import { CHOOSE_NAME_TIMEOUT_MS } from '../library/download-manager.js';
import type { DownloadEntry } from '../library/downloads.js';
import { SidePanelApi } from './side-panel-api.js';
import { ActionApi, type ActionState } from './action-api.js';
import { SilentAuthFlows } from './auth-flow.js';

const ACTION_COMMANDS = new Set(['_execute_action', '_execute_browser_action', '_execute_page_action']);

export interface ExtensionBridgeHost {
  open(url: string | null, active: boolean): WebContents | null;
  close(contents: WebContents): boolean;
  isTab(contents: WebContents): boolean;
  windowId(contents: WebContents): number;
  isActive(contents: WebContents): boolean;
  windows(): ExtensionWindowState[];
  openAction(extensionId: string, contents: WebContents | null): void;
  openActionPopup(
    windowId: number | null,
    popupUrl: (activeTab: WebContents | null) => string | null,
  ): 'opened' | 'no-window' | 'no-popup';
  openSidePanel(extensionId: string, url: string, windowId: number | null): WebContents | null;
  closeSidePanel(extensionId: string, windowId: number | null): void;
  sidePanelOpen(extensionId: string, windowId: number): boolean;
  refreshSidePanel(windowId: number): void;
}

interface Receiver {
  extensionId(): string | null;
  send(name: ExtensionBridgeEvent, args: unknown[]): void;
}

export class ExtensionBridge {
  private readonly workers = new Map<number, Receiver>();
  private readonly handled = new WeakSet<ServiceWorkerMain>();
  private readonly frames = new Map<WebContents, Receiver>();
  private readonly keepAlive = new Map<number, () => void>();
  private readonly watched = new Set<WebContents>();
  private readonly menus = new ExtensionMenus();
  private readonly notifications = new Map<string, Map<string, Notification>>();
  private library: ExtensionLibrary | null = null;
  private readonly historyListeners = new Set<string>();
  private readonly filenameListeners = new Set<string>();
  private readonly filenameRequests = new Map<
    string,
    { waiting: Set<string>; settle: (name: string | null) => void }
  >();
  private readonly sidePanels: SidePanelApi;
  private readonly actions: ActionApi;
  private readonly silentAuth: SilentAuthFlows;

  constructor(
    private readonly session: Session,
    private readonly host: ExtensionBridgeHost,
    preloadFile: string,
  ) {
    this.sidePanels = new SidePanelApi(
      session,
      host,
      (extensionId, name, args) => this.deliver(extensionId, name, args),
      (id) => this.tabContents(id),
    );
    this.actions = new ActionApi(session, host, (id) => this.tabContents(id));
    this.silentAuth = new SilentAuthFlows(session);
    for (const type of ['service-worker', 'frame'] as const) {
      session.registerPreloadScript({ type, filePath: preloadFile, matches: ['chrome-extension://*/*'] });
    }
    session.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
      if (runningStatus === 'stopped') this.workers.delete(versionId);
      else if (!this.workers.has(versionId)) this.attachWorker(versionId);
    });
    ipcMain.handle(ExtensionBridgeChannel.createTab, (event, properties) =>
      this.create(this.frameExtension(event), properties),
    );
    ipcMain.handle(ExtensionBridgeChannel.removeTabs, (event, ids) => this.remove(this.frameExtension(event), ids));
    ipcMain.handle(ExtensionBridgeChannel.currentTab, (event) => {
      const extensionId = this.frameExtension(event);
      return this.host.isTab(event.sender) ? this.tab(event.sender, extensionId) : undefined;
    });
    ipcMain.handle(ExtensionBridgeChannel.cookies, (event, method, details) =>
      this.cookies(this.frameExtension(event), method, details),
    );
    ipcMain.handle(ExtensionBridgeChannel.windows, (event) => this.windows(this.frameExtension(event), event.sender));
    ipcMain.handle(ExtensionBridgeChannel.contextMenus, (event, method, args) =>
      this.contextMenus(this.frameExtension(event), method, args),
    );
    ipcMain.handle(ExtensionBridgeChannel.notifications, (event, method, args) =>
      this.notify(this.frameExtension(event), method, args),
    );
    ipcMain.handle(ExtensionBridgeChannel.library, (event, namespace, method, args) =>
      this.callLibrary(this.frameExtension(event), namespace, method, args),
    );
    ipcMain.handle(ExtensionBridgeChannel.sidePanel, (event, method, args) =>
      this.sidePanel(this.frameExtension(event), method, args),
    );
    ipcMain.handle(ExtensionBridgeChannel.action, (event, method, args) =>
      this.action(this.frameExtension(event), method, args),
    );
    ipcMain.handle(ExtensionBridgeChannel.webAuthFlow, (event, details) =>
      this.webAuthFlow(this.frameExtension(event), details),
    );
    ipcMain.on(ExtensionBridgeChannel.subscribe, (event) => {
      const contents = event.sender;
      if (contents.session !== session || event.senderFrame !== contents.mainFrame || this.frames.has(contents)) return;
      this.frames.set(contents, {
        extensionId: () => (contents.isDestroyed() ? null : extensionIdOf(contents.getURL())),
        send: (name, args) => {
          if (!contents.isDestroyed()) contents.send(ExtensionBridgeChannel.event, name, args);
        },
      });
      contents.once('destroyed', () => this.frames.delete(contents));
    });
    app.on('web-contents-created', (_event, contents) => this.watch(contents));
    session.extensions.on('extension-unloaded', (_event, { id }) => {
      this.menus.call(id, 'removeAll', []);
      for (const notification of this.notifications.get(id)?.values() ?? []) notification.close();
      this.notifications.delete(id);
      this.sidePanels.forget(id);
      this.actions.forget(id);
      this.historyListeners.delete(id);
      this.filenameListeners.delete(id);
      for (const request of this.filenameRequests.values())
        if (request.waiting.delete(id) && request.waiting.size === 0) request.settle(null);
      this.silentAuth.cancel(id);
    });
    session.cookies.on('changed', (_event, cookie, cause, removed) => {
      const change = chromeCookieChange(cookie, cause, removed);
      if (!change) return;
      const url = cookieUrl(cookie);
      for (const receiver of this.receivers()) {
        const extensionId = receiver.extensionId();
        const grant = extensionId ? this.grant(extensionId) : null;
        if (grant?.permissions.includes('cookies') && hostPermitted(grant.hosts, url))
          receiver.send('cookies.onChanged', [change]);
      }
    });
  }

  isSilentAuth(contents: WebContents): boolean {
    return this.silentAuth.owns(contents);
  }

  attachLibrary(stores: LibraryStores): void {
    this.library = new ExtensionLibrary(stores, {
      wants: (permission) =>
        this.session.extensions.getAllExtensions().some(({ id }) => this.grant(id).permissions.includes(permission)),
      emit: (permission, name, args) => {
        for (const { id } of this.session.extensions.getAllExtensions()) {
          if (!this.grant(id).permissions.includes(permission)) continue;
          if (permission !== 'history' || this.historyListeners.has(id)) this.deliver(id, name, args);
          else for (const receiver of this.receivers()) if (receiver.extensionId() === id) receiver.send(name, args);
        }
      },
    });
  }

  chooseDownloadName(entry: DownloadEntry): Promise<string | null> | null {
    const waiting = new Set(
      [...this.filenameListeners].filter((id) => this.grant(id).permissions.includes('downloads')),
    );
    if (!this.library || waiting.size === 0) return null;
    const item = this.library.pendingDownload(entry);
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => settle(null), CHOOSE_NAME_TIMEOUT_MS);
      const settle = (name: string | null) => {
        clearTimeout(timer);
        this.filenameRequests.delete(requestId);
        resolve(name);
      };
      this.filenameRequests.set(requestId, { waiting, settle });
      for (const id of waiting) this.deliver(id, 'downloads.onDeterminingFilename', [item, requestId]);
    });
  }

  private suggestFilename(extensionId: string, requestId: unknown, suggestion: unknown): void {
    const request = typeof requestId === 'string' ? this.filenameRequests.get(requestId) : undefined;
    if (!request?.waiting.delete(extensionId)) return;
    const name = suggestedFilename(suggestion);
    if (name || request.waiting.size === 0) request.settle(name);
  }

  windowCreated(state: ExtensionWindowState): void {
    this.emit('windows.onCreated', [chromeWindow(state)]);
  }

  windowFocusChanged(id: number): void {
    this.emit('windows.onFocusChanged', [id]);
  }

  windowRemoved(id: number): void {
    this.emit('windows.onRemoved', [id]);
  }

  menuItems(contents: WebContents, params: ContextMenuParams): MenuItemConstructorOptions[] {
    if (contents.session !== this.session) return [];
    return this.session.extensions
      .getAllExtensions()
      .flatMap(({ id, name }) =>
        this.grant(id).permissions.includes('contextMenus')
          ? this.menus.template(id, name, params, (info) =>
              this.deliver(id, 'contextMenus.onClicked', [
                info,
                this.host.isTab(contents) ? this.tab(contents, id) : undefined,
              ]),
            )
          : [],
      );
  }

  private permitted(extensionId: string, permission: string): void {
    if (!this.session.extensions.getExtension(extensionId)) throw new Error('Unknown extension');
    if (!this.grant(extensionId).permissions.includes(permission)) throw new Error(`Missing ${permission} permission`);
  }

  sidePanelUrl(extensionId: string, tab: WebContents | null): string | null {
    return this.grant(extensionId).permissions.includes('sidePanel')
      ? this.sidePanels.panelUrl(extensionId, tab)
      : null;
  }

  opensSidePanelOnAction(extensionId: string): boolean {
    return this.sidePanels.opensOnAction(extensionId);
  }

  toggleSidePanel(extensionId: string, windowId: number, tab: WebContents | null): void {
    if (this.sidePanelUrl(extensionId, tab)) this.sidePanels.toggle(extensionId, windowId, tab);
  }

  sidePanelTabSwitched(extensionId: string, windowId: number, tab: WebContents | null, url: string | null): void {
    this.sidePanels.tabSwitched(extensionId, windowId, tab, url);
  }

  actionState(extensionId: string, tab: WebContents | null): ActionState | null {
    return this.actions.state(extensionId, tab);
  }

  actionClicked(extensionId: string, contents: WebContents | null): void {
    if (contents && contents.session !== this.session) return;
    const tab = contents && this.host.isTab(contents) ? this.tab(contents, extensionId) : undefined;
    this.deliver(extensionId, 'action.onClicked', [tab]);
  }

  private action(extensionId: string, method: unknown, args: unknown): unknown {
    if (typeof method !== 'string') throw new Error('Unsupported action method');
    return this.actions.call(extensionId, method, Array.isArray(args) ? args : []);
  }

  private async webAuthFlow(extensionId: string, details: unknown, worker?: ServiceWorkerMain): Promise<string> {
    this.permitted(extensionId, 'identity');
    const task = worker && !worker.isDestroyed() ? worker.startTask() : null;
    try {
      return await this.silentAuth.launch(extensionId, details);
    } finally {
      task?.end();
    }
  }

  private sidePanel(extensionId: string, method: unknown, args: unknown): unknown {
    this.permitted(extensionId, 'sidePanel');
    if (typeof method !== 'string') throw new Error('Unsupported sidePanel method');
    return this.sidePanels.call(extensionId, method, Array.isArray(args) ? args : []);
  }

  private callLibrary(extensionId: string, namespace: unknown, method: unknown, args: unknown): unknown {
    if (namespace !== 'history' && namespace !== 'bookmarks' && namespace !== 'downloads')
      throw new Error('Unknown extension API');
    this.permitted(extensionId, namespace);
    if (!this.library || typeof method !== 'string') throw new Error(`Unsupported ${namespace} method`);
    // shortcut: a sleeping worker wakes for history events only once it has run since launch and registered a listener, persist them like Chrome's lazy listeners if that bites.
    if (namespace === 'history' && method === 'listen') {
      this.historyListeners.add(extensionId);
      return undefined;
    }
    // shortcut: an extension that listens in both a page and its worker counts only its first answer, merge them if an extension needs that.
    if (namespace === 'downloads' && method === 'listen') {
      this.filenameListeners.add(extensionId);
      return undefined;
    }
    if (namespace === 'downloads' && method === 'suggest') {
      const [requestId, suggestion] = Array.isArray(args) ? args : [];
      this.suggestFilename(extensionId, requestId, suggestion);
      return undefined;
    }
    return this.library.call(
      namespace as LibraryNamespace,
      method,
      Array.isArray(args) ? args : [],
      this.grant(extensionId).permissions,
    );
  }

  private contextMenus(extensionId: string, method: unknown, args: unknown): void {
    this.permitted(extensionId, 'contextMenus');
    this.menus.call(extensionId, method, Array.isArray(args) ? args : []);
  }

  // shortcut: no image or progress, icons load only from the extension or data urls, and buttons show only where Electron supports actions (macOS).
  private notify(extensionId: string, method: unknown, args: unknown): unknown {
    this.permitted(extensionId, 'notifications');
    const [id, options] = Array.isArray(args) ? args : [];
    const shown = this.notifications.get(extensionId) ?? new Map<string, Notification>();
    this.notifications.set(extensionId, shown);
    if (method === 'getAll') return Object.fromEntries([...shown.keys()].map((key) => [key, true]));
    if (method === 'getPermissionLevel') return Notification.isSupported() ? 'granted' : 'denied';
    if (method === 'clear') {
      const notification = typeof id === 'string' ? shown.get(id) : undefined;
      if (!notification) return false;
      shown.delete(id as string);
      notification.close();
      return true;
    }
    if (method !== 'create') throw new Error('Unsupported notifications method');
    if (!Notification.isSupported()) throw new Error('Notifications are not supported');
    const { title, message, buttons, silent, iconUrl } = (
      typeof options === 'object' && options !== null ? options : {}
    ) as {
      title?: unknown;
      message?: unknown;
      buttons?: unknown;
      silent?: unknown;
      iconUrl?: unknown;
    };
    if (typeof title !== 'string' || typeof message !== 'string')
      throw new Error('Notification title and message are required');
    const notificationId = typeof id === 'string' && id ? id : randomUUID();
    shown.get(notificationId)?.close();
    const notification = new Notification({
      title,
      body: message,
      silent: silent === true,
      icon: this.notificationIcon(extensionId, iconUrl),
      actions: (Array.isArray(buttons) ? buttons : []).slice(0, 2).map((button: { title?: unknown }) => ({
        type: 'button' as const,
        text: String(button?.title ?? ''),
      })),
    });
    shown.set(notificationId, notification);
    notification.on('click', () => this.deliver(extensionId, 'notifications.onClicked', [notificationId]));
    notification.on('action', (event) =>
      this.deliver(extensionId, 'notifications.onButtonClicked', [notificationId, event.actionIndex]),
    );
    notification.on('close', () => {
      if (shown.get(notificationId) !== notification) return;
      shown.delete(notificationId);
      this.deliver(extensionId, 'notifications.onClosed', [notificationId, true]);
    });
    notification.show();
    return notificationId;
  }

  private notificationIcon(extensionId: string, iconUrl: unknown): Electron.NativeImage | undefined {
    if (typeof iconUrl !== 'string' || !iconUrl) return undefined;
    const extension = this.session.extensions.getExtension(extensionId);
    const file = extension && !iconUrl.startsWith('data:') ? extensionFile(extension.path, extensionId, iconUrl) : null;
    const icon = iconUrl.startsWith('data:')
      ? nativeImage.createFromDataURL(iconUrl)
      : file
        ? nativeImage.createFromPath(file)
        : null;
    return icon && !icon.isEmpty() ? icon : undefined;
  }

  // Pages and the browser UI both call this, so a shortcut works wherever focus is.
  shortcut(input: Electron.Input, contents: WebContents | null): boolean {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return false;
    if (!input.control && !input.meta && !input.alt) return false;
    if (contents && contents.session !== this.session) return false;
    const command = this.command(input);
    if (!command) return false;
    if (ACTION_COMMANDS.has(command.name)) {
      this.host.openAction(command.extensionId, contents);
      return true;
    }
    const tab = contents && this.host.isTab(contents) ? this.tab(contents, command.extensionId) : undefined;
    this.deliver(command.extensionId, 'commands.onCommand', [command.name, tab]);
    return true;
  }

  // A sleeping MV3 worker has no receiver, so start it before handing over a user action.
  private deliver(extensionId: string, name: ExtensionBridgeEvent, args: unknown[]): void {
    for (const receiver of this.frames.values()) if (receiver.extensionId() === extensionId) receiver.send(name, args);
    const extension = this.session.extensions.getExtension(extensionId);
    const background = (extension?.manifest as { background?: { service_worker?: unknown } } | undefined)?.background;
    if (!extension || typeof background?.service_worker !== 'string') return;
    this.session.serviceWorkers.startWorkerForScope(extension.url).then(
      (worker) => {
        if (!worker.isDestroyed()) worker.send(ExtensionBridgeChannel.event, name, args);
      },
      (error: unknown) => console.error(error),
    );
  }

  // shortcut: fires only while a Yalqen window has focus (no "global" commands).
  private command(input: Electron.Input): { extensionId: string; name: string } | null {
    for (const { id, manifest } of this.session.extensions.getAllExtensions()) {
      const commands = (manifest as { commands?: Record<string, { suggested_key?: unknown }> }).commands ?? {};
      for (const [name, { suggested_key }] of Object.entries(commands)) {
        if (name.startsWith('_execute_') && !ACTION_COMMANDS.has(name)) continue;
        if (shortcutMatches(suggestedShortcut(suggested_key, process.platform), input, process.platform))
          return { extensionId: id, name };
      }
    }
    return null;
  }

  private windows(extensionId: string, contents?: WebContents): ExtensionWindows {
    if (!this.session.extensions.getExtension(extensionId)) throw new Error('Unknown extension');
    return {
      currentId: contents ? this.host.windowId(contents) : null,
      windows: this.host.windows().map(chromeWindow),
    };
  }

  private emit(name: ExtensionBridgeEvent, args: unknown[]): void {
    for (const receiver of this.receivers()) {
      if (receiver.extensionId()) receiver.send(name, args);
    }
  }

  private grant(extensionId: string) {
    return extensionGrant(this.session.extensions.getExtension(extensionId)?.manifest);
  }

  private cookies(extensionId: string, method: unknown, details: unknown): Promise<unknown> {
    if (!this.session.extensions.getExtension(extensionId)) throw new Error('Unknown extension');
    return callCookies(this.session.cookies, this.grant(extensionId), method, details);
  }

  private attachWorker(versionId: number): void {
    const worker = this.session.serviceWorkers.getWorkerFromVersionID(versionId);
    const extensionId = worker ? extensionIdOf(worker.scope) : null;
    if (!worker || !extensionId) return;
    this.workers.set(versionId, {
      extensionId: () => extensionId,
      send: (name, args) => {
        if (!worker.isDestroyed()) worker.send(ExtensionBridgeChannel.event, name, args);
      },
    });
    if (this.handled.has(worker)) return;
    this.handled.add(worker);
    worker.ipc.handle(ExtensionBridgeChannel.createTab, (_event, properties) =>
      this.create(extensionId, properties, worker),
    );
    worker.ipc.handle(ExtensionBridgeChannel.removeTabs, (_event, ids) => this.remove(extensionId, ids));
    worker.ipc.handle(ExtensionBridgeChannel.currentTab, () => undefined);
    worker.ipc.handle(ExtensionBridgeChannel.cookies, (_event, method, details) =>
      this.cookies(extensionId, method, details),
    );
    worker.ipc.handle(ExtensionBridgeChannel.windows, () => this.windows(extensionId));
    worker.ipc.handle(ExtensionBridgeChannel.contextMenus, (_event, method, args) =>
      this.contextMenus(extensionId, method, args),
    );
    worker.ipc.handle(ExtensionBridgeChannel.notifications, (_event, method, args) =>
      this.notify(extensionId, method, args),
    );
    worker.ipc.handle(ExtensionBridgeChannel.library, (_event, namespace, method, args) =>
      this.callLibrary(extensionId, namespace, method, args),
    );
    worker.ipc.handle(ExtensionBridgeChannel.sidePanel, (_event, method, args) =>
      this.sidePanel(extensionId, method, args),
    );
    worker.ipc.handle(ExtensionBridgeChannel.action, (_event, method, args) => this.action(extensionId, method, args));
    worker.ipc.handle(ExtensionBridgeChannel.webAuthFlow, (_event, details) =>
      this.webAuthFlow(extensionId, details, worker),
    );
  }

  private frameExtension(event: IpcMainInvokeEvent): string {
    const extensionId = event.sender.session === this.session ? extensionIdOf(event.senderFrame?.url ?? '') : null;
    if (!extensionId) throw new Error('Only extension pages can use this API');
    return extensionId;
  }

  private create(extensionId: string, properties: unknown, worker?: ServiceWorkerMain): unknown {
    if (!this.session.extensions.getExtension(extensionId)) throw new Error('Unknown extension');
    const { url, active } = (typeof properties === 'object' && properties !== null ? properties : {}) as {
      url?: unknown;
      active?: unknown;
    };
    const contents = this.host.open(extensionTabUrl(url, extensionId), active !== false);
    if (!contents) throw new Error('No browser window to open the tab in');
    if (worker && !worker.isDestroyed()) this.keepAlive.set(contents.id, worker.startTask().end);
    return this.tab(contents, extensionId);
  }

  private remove(extensionId: string, ids: unknown): void {
    if (!this.session.extensions.getExtension(extensionId)) throw new Error('Unknown extension');
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      const contents = typeof id === 'number' ? this.tabContents(id) : null;
      if (!contents || !this.host.close(contents)) throw new Error(`No tab with id: ${String(id)}`);
    }
  }

  private tabContents(id: number): WebContents | null {
    return (
      [...this.watched].find(
        (contents) => contents.id === id && !contents.isDestroyed() && this.host.isTab(contents),
      ) ?? null
    );
  }

  private watch(contents: WebContents): void {
    if (contents.session !== this.session) return;
    this.watched.add(contents);
    const isTab = () => !contents.isDestroyed() && this.host.isTab(contents);
    let lastWindow = -1;
    const updated = (change: Record<string, unknown>, only?: string) => {
      if (!isTab()) return;
      lastWindow = this.host.windowId(contents);
      this.broadcast(
        'tabs.onUpdated',
        contents,
        change,
        only ?? authRedirectExtension(String(change.url ?? '')) ?? undefined,
      );
    };
    contents.on('did-start-navigation', ({ url, isMainFrame, isSameDocument }) => {
      if (isMainFrame && !isSameDocument) updated({ status: 'loading', url });
    });
    contents.on('did-redirect-navigation', ({ url, isMainFrame }) => {
      if (isMainFrame) updated({ url });
    });
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame) updated({ url });
    });
    contents.on('did-stop-loading', () => updated({ status: 'complete' }));
    contents.on('before-input-event', (event, input) => {
      if (isTab() && this.shortcut(input, contents)) event.preventDefault();
    });
    const navigation = (
      name: ExtensionBridgeEvent,
      frame: WebFrameMain | null | undefined,
      details: Record<string, unknown> = {},
    ) => {
      if (isTab() && frame && !frame.isDestroyed()) this.navigation(name, contents, frame, details);
    };
    const frameOf = (isMainFrame: boolean, processId: number, routingId: number) =>
      isMainFrame ? contents.mainFrame : webFrameMain.fromId(processId, routingId);
    const committed = { transitionType: 'link', transitionQualifiers: [] };
    contents.on('did-start-navigation', ({ url, isMainFrame, isSameDocument, frame }) => {
      if (!isSameDocument)
        navigation('webNavigation.onBeforeNavigate', isMainFrame ? contents.mainFrame : frame, { url });
    });
    const lastUrls = new Map<number, string>();
    const frameKey = (frame: WebFrameMain | null | undefined) => (frame?.parent ? frame.frameTreeNodeId : 0);
    contents.on('did-frame-navigate', (_event, url, _code, _status, isMainFrame, processId, routingId) => {
      const frame = frameOf(isMainFrame, processId, routingId);
      lastUrls.set(frameKey(frame), url);
      navigation('webNavigation.onCommitted', frame, { url, ...committed });
    });
    contents.on('did-navigate-in-page', (_event, url, isMainFrame, processId, routingId) => {
      const frame = frameOf(isMainFrame, processId, routingId);
      const key = frameKey(frame);
      const name = fragmentOnly(lastUrls.get(key), url)
        ? 'webNavigation.onReferenceFragmentUpdated'
        : 'webNavigation.onHistoryStateUpdated';
      lastUrls.set(key, url);
      navigation(name, frame, { url, ...committed });
    });
    contents.on('dom-ready', () => navigation('webNavigation.onDOMContentLoaded', contents.mainFrame));
    // shortcut: a subframe whose frame object is replaced mid-load (process swap) may miss onDOMContentLoaded.
    contents.on('frame-created', (_event, { frame }) => {
      if (frame?.parent) frame.on('dom-ready', () => navigation('webNavigation.onDOMContentLoaded', frame));
    });
    contents.on('did-frame-finish-load', (_event, isMainFrame, processId, routingId) =>
      navigation('webNavigation.onCompleted', frameOf(isMainFrame, processId, routingId)),
    );
    contents.on('did-fail-load', (_event, _code, error, url, isMainFrame, processId, routingId) =>
      navigation('webNavigation.onErrorOccurred', frameOf(isMainFrame, processId, routingId), { url, error }),
    );
    const catchAuthRedirect = (event: Electron.Event<{ url: string; isMainFrame: boolean }>) => {
      const extensionId = event.isMainFrame ? authRedirectExtension(event.url) : null;
      if (!extensionId || !isTab()) return;
      event.preventDefault();
      updated({ url: event.url }, extensionId);
    };
    contents.on('will-navigate', catchAuthRedirect);
    contents.on('will-redirect', catchAuthRedirect);
    contents.once('destroyed', () => {
      this.watched.delete(contents);
      this.keepAlive.get(contents.id)?.();
      this.keepAlive.delete(contents.id);
      this.actions.dropTab(contents.id);
      this.sidePanels.dropTab(contents.id);
      if (lastWindow === -1) return;
      for (const receiver of this.receivers()) {
        if (receiver.extensionId())
          receiver.send('tabs.onRemoved', [contents.id, { windowId: lastWindow, isWindowClosing: false }]);
      }
    });
  }

  private receivers(): Receiver[] {
    return [...this.workers.values(), ...this.frames.values()];
  }

  private broadcast(name: ExtensionBridgeEvent, contents: WebContents, change: Record<string, unknown>, only?: string) {
    for (const receiver of this.receivers()) {
      const extensionId = receiver.extensionId();
      if (!extensionId || (only && extensionId !== only)) continue;
      // The auth redirect belongs to the extension that asked for it, even without the tabs permission.
      const seesUrls = extensionId === only || this.seesUrls(extensionId);
      if (!seesUrls && !('status' in change)) continue;
      const visible = seesUrls ? change : { status: change.status };
      receiver.send(name, [contents.id, visible, this.tab(contents, extensionId)]);
    }
  }

  // Chrome numbers the main frame 0 and other frames by frame tree node id, like scripting.executeScript does.
  private navigation(
    name: ExtensionBridgeEvent,
    contents: WebContents,
    frame: WebFrameMain,
    details: Record<string, unknown>,
  ): void {
    const frameId = (target: WebFrameMain) => (target.parent ? target.frameTreeNodeId : 0);
    const event = {
      tabId: contents.id,
      url: frame.url,
      frameId: frameId(frame),
      parentFrameId: frame.parent ? frameId(frame.parent) : -1,
      timeStamp: Date.now(),
      ...details,
    };
    for (const receiver of this.receivers()) {
      const extensionId = receiver.extensionId();
      if (extensionId && this.grant(extensionId).permissions.includes('webNavigation')) receiver.send(name, [event]);
    }
  }

  private seesUrls(extensionId: string): boolean {
    return this.grant(extensionId).permissions.includes('tabs');
  }

  private tab(contents: WebContents, extensionId: string): Record<string, unknown> {
    const seesUrls = this.seesUrls(extensionId);
    return {
      id: contents.id,
      windowId: this.host.windowId(contents),
      index: -1,
      active: this.host.isActive(contents),
      highlighted: this.host.isActive(contents),
      pinned: false,
      incognito: false,
      discarded: false,
      autoDiscardable: true,
      groupId: -1,
      status: contents.isLoading() ? 'loading' : 'complete',
      ...(seesUrls ? { url: contents.getURL(), title: contents.getTitle() } : {}),
    };
  }
}
