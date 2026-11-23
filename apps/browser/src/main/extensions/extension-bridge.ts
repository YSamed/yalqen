import { randomUUID } from 'node:crypto';
import {
  app,
  ipcMain,
  Notification,
  type ContextMenuParams,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
  type ServiceWorkerMain,
  type Session,
  type WebContents,
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
  shortcutMatches,
  suggestedShortcut,
} from '../../shared/extension-bridge.js';
import { callCookies, chromeCookieChange, cookieUrl, extensionGrant, hostPermitted } from './extension-cookies.js';
import { ExtensionMenus } from './extension-menus.js';

export interface ExtensionBridgeHost {
  open(url: string | null, active: boolean): WebContents | null;
  close(contents: WebContents): boolean;
  isTab(contents: WebContents): boolean;
  windowId(contents: WebContents): number;
  isActive(contents: WebContents): boolean;
  windows(): ExtensionWindowState[];
  declarativeNetRequest?(extensionId: string, state: unknown): void;
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

  constructor(
    private readonly session: Session,
    private readonly host: ExtensionBridgeHost,
    preloadFile: string,
  ) {
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
    ipcMain.handle(ExtensionBridgeChannel.declarativeNetRequest, (event, state) =>
      this.host.declarativeNetRequest?.(this.frameExtension(event), state),
    );
    ipcMain.handle(ExtensionBridgeChannel.notifications, (event, method, args) =>
      this.notify(this.frameExtension(event), method, args),
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

  private contextMenus(extensionId: string, method: unknown, args: unknown): void {
    this.permitted(extensionId, 'contextMenus');
    this.menus.call(extensionId, method, Array.isArray(args) ? args : []);
  }

  // shortcut: no icon, image or progress, and buttons show only where Electron supports actions (macOS).
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
    const { title, message, buttons, silent } = (typeof options === 'object' && options !== null ? options : {}) as {
      title?: unknown;
      message?: unknown;
      buttons?: unknown;
      silent?: unknown;
    };
    if (typeof title !== 'string' || typeof message !== 'string')
      throw new Error('Notification title and message are required');
    const notificationId = typeof id === 'string' && id ? id : randomUUID();
    shown.get(notificationId)?.close();
    const notification = new Notification({
      title,
      body: message,
      silent: silent === true,
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

  // shortcut: only fires while a page has focus, and _execute_* commands are not bound; route browser UI keys when needed.
  private command(input: Electron.Input): { extensionId: string; name: string } | null {
    for (const { id, manifest } of this.session.extensions.getAllExtensions()) {
      const commands = (manifest as { commands?: Record<string, { suggested_key?: unknown }> }).commands ?? {};
      for (const [name, { suggested_key }] of Object.entries(commands)) {
        if (name.startsWith('_execute_')) continue;
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
    worker.ipc.handle(ExtensionBridgeChannel.declarativeNetRequest, (_event, state) =>
      this.host.declarativeNetRequest?.(extensionId, state),
    );
    worker.ipc.handle(ExtensionBridgeChannel.notifications, (_event, method, args) =>
      this.notify(extensionId, method, args),
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
      if (input.type !== 'keyDown' || input.isAutoRepeat || !isTab()) return;
      const command = this.command(input);
      if (!command) return;
      event.preventDefault();
      this.deliver(command.extensionId, 'commands.onCommand', [command.name, this.tab(contents, command.extensionId)]);
    });
    const navigation = (name: ExtensionBridgeEvent, details: Record<string, unknown> = {}) => {
      if (isTab()) this.navigation(name, contents, details);
    };
    contents.on('did-start-navigation', ({ url, isMainFrame, isSameDocument }) => {
      if (isMainFrame && !isSameDocument) navigation('webNavigation.onBeforeNavigate', { url });
    });
    contents.on('did-navigate', () =>
      navigation('webNavigation.onCommitted', { transitionType: 'link', transitionQualifiers: [] }),
    );
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => {
      if (isMainFrame)
        navigation('webNavigation.onHistoryStateUpdated', { url, transitionType: 'link', transitionQualifiers: [] });
    });
    contents.on('dom-ready', () => navigation('webNavigation.onDOMContentLoaded'));
    contents.on('did-finish-load', () => navigation('webNavigation.onCompleted'));
    contents.on('did-fail-load', (_event, _code, error, url, isMainFrame) => {
      if (isMainFrame) navigation('webNavigation.onErrorOccurred', { url, error });
    });
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
      const seesUrls = this.seesUrls(extensionId);
      if (!seesUrls && !('status' in change)) continue;
      const visible = seesUrls ? change : { status: change.status };
      receiver.send(name, [contents.id, visible, this.tab(contents, extensionId)]);
    }
  }

  // shortcut: main frame only (frameId 0); report subframes when an extension needs them.
  private navigation(name: ExtensionBridgeEvent, contents: WebContents, details: Record<string, unknown>): void {
    const event = {
      tabId: contents.id,
      url: contents.getURL(),
      frameId: 0,
      parentFrameId: -1,
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
