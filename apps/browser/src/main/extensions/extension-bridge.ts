import {
  app,
  ipcMain,
  type IpcMainInvokeEvent,
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
} from '../../shared/extension-bridge.js';
import { callCookies, chromeCookieChange, cookieUrl, extensionGrant, hostPermitted } from './extension-cookies.js';

export interface ExtensionBridgeHost {
  open(url: string | null, active: boolean): WebContents | null;
  close(contents: WebContents): boolean;
  isTab(contents: WebContents): boolean;
  windowId(contents: WebContents): number;
  isActive(contents: WebContents): boolean;
  // Browser windows extensions may know about, most recently focused first.
  windows(): ExtensionWindowState[];
}

interface Receiver {
  extensionId(): string | null;
  send(name: ExtensionBridgeEvent, args: unknown[]): void;
}

// Electron's chrome.tabs has no create/remove and never fires onUpdated/onRemoved, and chrome.cookies,
// chrome.identity and chrome.windows are missing; sign-in flows such as Grammarly's open a tab, watch it reach the chromiumapp.org
// redirect and then read the account cookie.
export class ExtensionBridge {
  private readonly workers = new Map<number, Receiver>();
  // A worker that stops and starts again keeps its ServiceWorkerMain and the IPC handlers on it.
  private readonly handled = new WeakSet<ServiceWorkerMain>();
  private readonly frames = new Map<WebContents, Receiver>();
  private readonly keepAlive = new Map<number, () => void>();
  private readonly watched = new Set<WebContents>();

  constructor(
    private readonly session: Session,
    private readonly host: ExtensionBridgeHost,
    preloadFile: string,
  ) {
    for (const type of ['service-worker', 'frame'] as const) {
      session.registerPreloadScript({ type, filePath: preloadFile, matches: ['chrome-extension://*/*'] });
    }
    // shortcut: events reach running workers only; Chrome would wake a stopped one, add that if an extension needs it.
    session.serviceWorkers.on('running-status-changed', ({ versionId, runningStatus }) => {
      if (runningStatus === 'stopped') this.workers.delete(versionId);
      else if (!this.workers.has(versionId)) this.attachWorker(versionId);
    });
    ipcMain.handle(ExtensionBridgeChannel.createTab, (event, properties) =>
      this.create(this.frameExtension(event), properties),
    );
    ipcMain.handle(ExtensionBridgeChannel.removeTabs, (event, ids) => this.remove(this.frameExtension(event), ids));
    ipcMain.handle(ExtensionBridgeChannel.cookies, (event, method, details) =>
      this.cookies(this.frameExtension(event), method, details),
    );
    ipcMain.handle(ExtensionBridgeChannel.windows, (event) => this.windows(this.frameExtension(event), event.sender));
    ipcMain.on(ExtensionBridgeChannel.subscribe, (event) => {
      const contents = event.sender;
      if (contents.session !== session || event.senderFrame !== contents.mainFrame || this.frames.has(contents)) return;
      this.frames.set(contents, {
        // A tab can navigate away from the extension page that subscribed.
        extensionId: () => (contents.isDestroyed() ? null : extensionIdOf(contents.getURL())),
        send: (name, args) => {
          if (!contents.isDestroyed()) contents.send(ExtensionBridgeChannel.event, name, args);
        },
      });
      contents.once('destroyed', () => this.frames.delete(contents));
    });
    app.on('web-contents-created', (_event, contents) => this.watch(contents));
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
    // Registering the handlers again would throw and crash the app the second time the worker starts.
    if (this.handled.has(worker)) return;
    this.handled.add(worker);
    worker.ipc.handle(ExtensionBridgeChannel.createTab, (_event, properties) =>
      this.create(extensionId, properties, worker),
    );
    worker.ipc.handle(ExtensionBridgeChannel.removeTabs, (_event, ids) => this.remove(extensionId, ids));
    worker.ipc.handle(ExtensionBridgeChannel.cookies, (_event, method, details) =>
      this.cookies(extensionId, method, details),
    );
    worker.ipc.handle(ExtensionBridgeChannel.windows, () => this.windows(extensionId));
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
    // The worker would otherwise idle out mid sign-in and lose the listeners watching this tab.
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
      // The redirect carries the sign-in code, so only the extension it belongs to may see it.
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

  // shortcut: Chrome also shows URLs to extensions with matching host permissions; only "tabs" is checked here.
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
