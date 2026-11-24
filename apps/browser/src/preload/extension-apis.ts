import { contextBridge, ipcRenderer } from 'electron';
import {
  ExtensionBridgeChannel,
  type ExtensionBridgeEvent,
  type ExtensionWindows,
  suggestedShortcut,
} from '../shared/extension-bridge.js';

type Dispatch = (...args: unknown[]) => void;

interface Bridge {
  createTab(properties: unknown): Promise<unknown>;
  removeTabs(ids: unknown): Promise<void>;
  currentTab(): Promise<unknown>;
  cookies(method: string, details: unknown): Promise<unknown>;
  windows(): Promise<ExtensionWindows>;
  contextMenus(method: string, args: unknown[]): Promise<void>;
  notifications(method: string, args: unknown[]): Promise<unknown>;
  library(namespace: string, method: string, args: unknown[]): Promise<unknown>;
  sidePanel(method: string, args: unknown[]): Promise<unknown>;
  action(method: string, args: unknown[]): Promise<unknown>;
  shortcut(suggested: unknown): string;
  subscribe(event: ExtensionBridgeEvent, dispatch: Dispatch): void;
}

const dispatchers = new Map<ExtensionBridgeEvent, Dispatch>();
ipcRenderer.on(ExtensionBridgeChannel.event, (_event, name: ExtensionBridgeEvent, args: unknown[]) => {
  dispatchers.get(name)?.(...args);
});

const bridge: Bridge = {
  createTab: (properties) => ipcRenderer.invoke(ExtensionBridgeChannel.createTab, properties),
  removeTabs: (ids) => ipcRenderer.invoke(ExtensionBridgeChannel.removeTabs, ids),
  currentTab: () => ipcRenderer.invoke(ExtensionBridgeChannel.currentTab),
  cookies: (method, details) => ipcRenderer.invoke(ExtensionBridgeChannel.cookies, method, details),
  windows: () => ipcRenderer.invoke(ExtensionBridgeChannel.windows),
  contextMenus: (method, args) => ipcRenderer.invoke(ExtensionBridgeChannel.contextMenus, method, args),
  notifications: (method, args) => ipcRenderer.invoke(ExtensionBridgeChannel.notifications, method, args),
  library: (namespace, method, args) => ipcRenderer.invoke(ExtensionBridgeChannel.library, namespace, method, args),
  sidePanel: (method, args) => ipcRenderer.invoke(ExtensionBridgeChannel.sidePanel, method, args),
  action: (method, args) => ipcRenderer.invoke(ExtensionBridgeChannel.action, method, args),
  shortcut: (suggested) => suggestedShortcut(suggested, globalThis.process?.platform ?? ''),
  subscribe: (event, dispatch) => {
    dispatchers.set(event, dispatch);
  },
};

function installExtensionApis(api: Bridge): void {
  type Listener = (...args: unknown[]) => void;
  type Callback = ((value?: unknown) => void) | undefined;
  const chromeApi = (globalThis as { chrome?: Record<string, unknown> }).chrome;
  const tabs = chromeApi?.tabs as Record<string, unknown> | undefined;
  const runtime = chromeApi?.runtime as
    | {
        id: string;
        getManifest(): {
          permissions?: string[];
          commands?: Record<string, { description?: string; suggested_key?: unknown }>;
        };
      }
    | undefined;
  if (!chromeApi || !tabs || !runtime) return;
  const permissions = runtime.getManifest().permissions ?? [];

  const settle = <T>(promise: Promise<T>, callback: Callback): Promise<T> | undefined => {
    if (typeof callback !== 'function') return promise;
    promise.then(
      (value) => callback(value),
      (error: unknown) => {
        console.error(error);
        callback();
      },
    );
    return undefined;
  };
  const lastArgument = (args: unknown[]) => args.find((arg) => typeof arg === 'function') as Callback;
  const event = (name?: ExtensionBridgeEvent) => {
    const listeners = new Set<Listener>();
    if (name) {
      api.subscribe(name, (...args) => {
        for (const listener of [...listeners]) {
          try {
            listener(...args);
          } catch (error) {
            console.error(error);
          }
        }
      });
    }
    return {
      addListener: (listener: Listener) => void listeners.add(listener),
      removeListener: (listener: Listener) => void listeners.delete(listener),
      hasListener: (listener: Listener) => listeners.has(listener),
      hasListeners: () => listeners.size > 0,
    };
  };
  // Extensions such as uBlock Origin Lite read `self.browser || self.chrome`, and Electron defines both.
  const browserApi = (globalThis as { browser?: Record<string, unknown> }).browser;
  const counterpart = (target: Record<string, unknown>): Record<string, unknown> | null => {
    if (!browserApi || browserApi === chromeApi) return null;
    if (target === chromeApi) return browserApi;
    const name = ['tabs', 'permissions'].find((key) => chromeApi[key] === target);
    const mirror = name ? browserApi[name] : null;
    return mirror && typeof mirror === 'object' && mirror !== target ? (mirror as Record<string, unknown>) : null;
  };
  const define = (target: Record<string, unknown>, key: string, value: unknown) => {
    for (const object of [target, counterpart(target)]) {
      if (object) Object.defineProperty(object, key, { value, configurable: true, enumerable: true, writable: true });
    }
  };

  define(tabs, 'create', (properties: unknown, callback: Callback) =>
    settle(api.createTab(properties ?? {}), callback),
  );
  define(tabs, 'remove', (ids: unknown, callback: Callback) => settle(api.removeTabs(ids), callback));
  define(tabs, 'getCurrent', (callback: Callback) => settle(api.currentTab(), callback));
  const tabUpdated = event('tabs.onUpdated');
  const tabRemoved = event('tabs.onRemoved');
  define(tabs, 'onUpdated', tabUpdated);
  define(tabs, 'onRemoved', tabRemoved);

  if (!chromeApi.cookies && permissions.includes('cookies')) {
    const call = (method: string) => (details: unknown, callback: Callback) =>
      settle(api.cookies(method, details ?? {}), callback);
    define(chromeApi, 'cookies', {
      get: call('get'),
      getAll: call('getAll'),
      set: call('set'),
      remove: call('remove'),
      getAllCookieStores: (callback: Callback) => settle(api.cookies('getAllCookieStores', {}), callback),
      onChanged: event('cookies.onChanged'),
    });
  }

  if (!chromeApi.identity && permissions.includes('identity')) {
    const redirectUrl = (path = '') => `https://${runtime.id}.chromiumapp.org/${String(path).replace(/^\//, '')}`;
    // shortcut: interactive: false is always refused, so silent token refresh falls back to the interactive flow.
    const webAuthFlow = (details: unknown): Promise<string> => {
      const { url, interactive } = (typeof details === 'object' && details !== null ? details : {}) as {
        url?: unknown;
        interactive?: unknown;
      };
      if (typeof url !== 'string') return Promise.reject(new Error('Authorization url is required'));
      if (interactive !== true) return Promise.reject(new Error('User interaction required.'));
      return api.createTab({ url, active: true }).then(
        (tab) =>
          new Promise((resolve, reject) => {
            const { id } = tab as { id: number };
            const stop = () => {
              tabUpdated.removeListener(updated);
              tabRemoved.removeListener(removed);
            };
            const updated: Listener = (tabId, change) => {
              const next = (change as { url?: unknown } | undefined)?.url;
              if (tabId !== id || typeof next !== 'string' || !next.startsWith(redirectUrl())) return;
              stop();
              resolve(next);
              api.removeTabs(id).catch(() => {});
            };
            const removed: Listener = (tabId) => {
              if (tabId !== id) return;
              stop();
              reject(new Error('The user did not approve access.'));
            };
            tabUpdated.addListener(updated);
            tabRemoved.addListener(removed);
          }),
      );
    };
    define(chromeApi, 'identity', {
      getRedirectURL: redirectUrl,
      launchWebAuthFlow: (details: unknown, callback: Callback) => settle(webAuthFlow(details), callback),
      getAuthToken: (...args: unknown[]) =>
        settle(
          Promise.reject(new Error('getAuthToken needs a Chrome Google account; use launchWebAuthFlow')),
          lastArgument(args),
        ),
    });
  }

  if (!chromeApi.commands) {
    const commands = Object.entries(runtime.getManifest().commands ?? {}).map(
      ([name, { description = '', suggested_key }]) => ({ name, description, shortcut: api.shortcut(suggested_key) }),
    );
    define(chromeApi, 'commands', {
      getAll: (callback: Callback) => settle(Promise.resolve(commands), callback),
      onCommand: event('commands.onCommand'),
    });
  }

  if (!chromeApi.contextMenus && permissions.includes('contextMenus')) {
    let nextId = Date.now();
    const call = (method: string, args: unknown[], callback: Callback) =>
      settle(api.contextMenus(method, args), callback);
    const plain = (properties: unknown) => {
      const { onclick: _onclick, ...rest } = (
        typeof properties === 'object' && properties !== null ? properties : {}
      ) as Record<string, unknown>;
      return rest;
    };
    define(chromeApi, 'contextMenus', {
      ACTION_MENU_TOP_LEVEL_LIMIT: 6,
      create: (properties: unknown, callback: Callback) => {
        const options = plain(properties);
        const id = options.id ?? ++nextId;
        void call('create', [{ ...options, id }], callback ?? (() => {}));
        return id;
      },
      update: (id: unknown, properties: unknown, callback: Callback) =>
        call('update', [id, plain(properties)], callback),
      remove: (id: unknown, callback: Callback) => call('remove', [id], callback),
      removeAll: (callback: Callback) => call('removeAll', [], callback),
      onClicked: event('contextMenus.onClicked'),
    });
  }

  if (!chromeApi.notifications && permissions.includes('notifications')) {
    const call = (method: string, args: unknown[], callback: Callback) =>
      settle(api.notifications(method, args), callback);
    define(chromeApi, 'notifications', {
      create: (...args: unknown[]) => {
        const [id, options] = typeof args[0] === 'object' && args[0] !== null ? [undefined, args[0]] : args;
        return call('create', [id, options], lastArgument(args));
      },
      clear: (id: unknown, callback: Callback) => call('clear', [id], callback),
      getAll: (callback: Callback) => call('getAll', [], callback),
      getPermissionLevel: (callback: Callback) => call('getPermissionLevel', [], callback),
      onClicked: event('notifications.onClicked'),
      onButtonClicked: event('notifications.onButtonClicked'),
      onClosed: event('notifications.onClosed'),
      onShowSettings: event(),
      onPermissionLevelChanged: event(),
    });
  }

  if (!chromeApi.webNavigation && permissions.includes('webNavigation')) {
    define(chromeApi, 'webNavigation', {
      onBeforeNavigate: event('webNavigation.onBeforeNavigate'),
      onCommitted: event('webNavigation.onCommitted'),
      onDOMContentLoaded: event('webNavigation.onDOMContentLoaded'),
      onCompleted: event('webNavigation.onCompleted'),
      onErrorOccurred: event('webNavigation.onErrorOccurred'),
      onHistoryStateUpdated: event('webNavigation.onHistoryStateUpdated'),
      onReferenceFragmentUpdated: event(),
      onCreatedNavigationTarget: event(),
      onTabReplaced: event(),
    });
  }

  const library = (namespace: string, methods: string[], events: Record<string, ExtensionBridgeEvent | undefined>) => {
    if (chromeApi[namespace] || !permissions.includes(namespace)) return;
    const members: Record<string, unknown> = Object.fromEntries(
      methods.map((method) => [
        method,
        (...args: unknown[]) =>
          settle(
            api.library(
              namespace,
              method,
              args.filter((arg) => typeof arg !== 'function'),
            ),
            lastArgument(args),
          ),
      ]),
    );
    for (const [name, bridged] of Object.entries(events)) members[name] = event(bridged);
    define(chromeApi, namespace, members);
  };
  library('history', ['search', 'getVisits', 'addUrl', 'deleteUrl', 'deleteRange', 'deleteAll'], {
    onVisited: 'history.onVisited',
    onVisitRemoved: 'history.onVisitRemoved',
  });
  library(
    'bookmarks',
    [
      'get',
      'getChildren',
      'getRecent',
      'getTree',
      'getSubTree',
      'search',
      'create',
      'move',
      'update',
      'remove',
      'removeTree',
    ],
    {
      onCreated: 'bookmarks.onCreated',
      onRemoved: 'bookmarks.onRemoved',
      onChanged: 'bookmarks.onChanged',
      onMoved: 'bookmarks.onMoved',
      onChildrenReordered: undefined,
      onImportBegan: undefined,
      onImportEnded: undefined,
    },
  );
  library(
    'downloads',
    [
      'download',
      'search',
      'pause',
      'resume',
      'cancel',
      'show',
      'showDefaultFolder',
      'erase',
      'getFileIcon',
      'setShelfEnabled',
      'setUiOptions',
    ],
    {
      onCreated: 'downloads.onCreated',
      onChanged: 'downloads.onChanged',
      onErased: 'downloads.onErased',
      onDeterminingFilename: undefined,
    },
  );
  const sidePanelCall =
    (method: string) =>
    (...args: unknown[]) =>
      settle(
        api.sidePanel(
          method,
          args.filter((arg) => typeof arg !== 'function'),
        ),
        lastArgument(args),
      );
  if (!chromeApi.sidePanel && permissions.includes('sidePanel')) {
    define(chromeApi, 'sidePanel', {
      setOptions: sidePanelCall('setOptions'),
      getOptions: sidePanelCall('getOptions'),
      setPanelBehavior: sidePanelCall('setPanelBehavior'),
      getPanelBehavior: sidePanelCall('getPanelBehavior'),
      open: sidePanelCall('open'),
      close: sidePanelCall('close'),
      onOpened: event('sidePanel.onOpened'),
      onClosed: event('sidePanel.onClosed'),
    });
  }
  // Electron's own chrome.action is a stub that drops every value, so it is replaced, not only filled in.
  {
    type Pixels = { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer> };
    const isPixels = (value: unknown): value is Pixels =>
      typeof value === 'object' && value !== null && 'data' in value && typeof (value as Pixels).width === 'number';
    // ImageData does not survive IPC, so it crosses as a PNG data url.
    const pngUrl = async (pixels: Pixels): Promise<string> => {
      const canvas = new OffscreenCanvas(pixels.width, pixels.height);
      canvas.getContext('2d')!.putImageData(new ImageData(pixels.data, pixels.width, pixels.height), 0, 0);
      const bytes = new Uint8Array(await (await canvas.convertToBlob()).arrayBuffer());
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return `data:image/png;base64,${btoa(binary)}`;
    };
    const imageData = async (value: unknown): Promise<unknown> => {
      if (isPixels(value)) return pngUrl(value);
      if (typeof value !== 'object' || value === null) return value;
      const entries = await Promise.all(
        Object.entries(value).map(async ([size, pixels]) => [size, isPixels(pixels) ? await pngUrl(pixels) : pixels]),
      );
      return Object.fromEntries(entries);
    };
    const call =
      (method: string) =>
      (...args: unknown[]) =>
        settle(
          api.action(
            method,
            args.filter((arg) => typeof arg !== 'function'),
          ),
          lastArgument(args),
        );
    const clicked = event('action.onClicked');
    const actionApi = {
      ...Object.fromEntries(
        [
          'setBadgeText',
          'getBadgeText',
          'setBadgeBackgroundColor',
          'getBadgeBackgroundColor',
          'setBadgeTextColor',
          'getBadgeTextColor',
          'setTitle',
          'getTitle',
          'setPopup',
          'getPopup',
          'enable',
          'disable',
          'isEnabled',
          'openPopup',
        ].map((method) => [method, call(method)]),
      ),
      setIcon: (details: unknown, callback: Callback) => {
        const { imageData: raw, ...rest } = (typeof details === 'object' && details !== null ? details : {}) as {
          imageData?: unknown;
        };
        return settle(
          imageData(raw).then((converted) =>
            api.action('setIcon', [converted === undefined ? rest : { ...rest, imageData: converted }]),
          ),
          callback,
        );
      },
      getUserSettings: (callback: Callback) => settle(Promise.resolve({ isOnToolbar: true }), callback),
      onClicked: {
        ...clicked,
        addListener: (listener: Listener) => {
          clicked.addListener(listener);
          api.action('listen', []).catch(() => {});
        },
      },
    };
    define(chromeApi, 'action', actionApi);
    define(chromeApi, 'browserAction', actionApi);
  }

  const downloads = chromeApi.downloads as Record<string, unknown> | undefined;
  if (downloads && permissions.includes('downloads.open') && !downloads.open) {
    // Chrome opens a downloaded file only in response to a user gesture.
    define(downloads, 'open', (id: unknown, callback: Callback) =>
      settle(
        (globalThis as { navigator?: { userActivation?: { isActive: boolean } } }).navigator?.userActivation?.isActive
          ? api.library('downloads', 'open', [id])
          : Promise.reject(new Error('downloads.open requires a user gesture')),
        callback,
      ),
    );
  }

  if (!chromeApi.windows) {
    const WINDOW_ID_NONE = -1;
    const WINDOW_ID_CURRENT = -2;
    type Window = ExtensionWindows['windows'][number];
    const pick = (choose: (result: ExtensionWindows) => Window | undefined) =>
      api.windows().then((result) => {
        const window = choose(result);
        if (!window) throw new Error('No browser window');
        return window;
      });
    const lastFocused = ({ windows }: ExtensionWindows) => windows.find((window) => window.focused) ?? windows[0];
    const current = (result: ExtensionWindows) =>
      result.windows.find((window) => window.id === result.currentId) ?? lastFocused(result);
    define(chromeApi, 'windows', {
      WINDOW_ID_NONE,
      WINDOW_ID_CURRENT,
      getCurrent: (...args: unknown[]) => settle(pick(current), lastArgument(args)),
      getLastFocused: (...args: unknown[]) => settle(pick(lastFocused), lastArgument(args)),
      get: (id: unknown, ...args: unknown[]) =>
        settle(
          pick(id === WINDOW_ID_CURRENT ? current : ({ windows }) => windows.find((window) => window.id === id)),
          lastArgument(args),
        ),
      getAll: (...args: unknown[]) =>
        settle(
          api.windows().then(({ windows }) => windows),
          lastArgument(args),
        ),
      onCreated: event('windows.onCreated'),
      onRemoved: event('windows.onRemoved'),
      onFocusChanged: event('windows.onFocusChanged'),
    });
  }

  const bridged = ['cookies', 'identity', 'history', 'bookmarks', 'downloads', 'downloads.open', 'sidePanel'].filter(
    (name) => permissions.includes(name),
  );
  const native = chromeApi.permissions as
    | {
        contains(query: unknown): Promise<boolean>;
        getAll(): Promise<{ permissions?: string[]; origins?: string[] }>;
        request(query: unknown): Promise<boolean>;
      }
    | undefined;
  if (native && bridged.length > 0) {
    const split = (query: unknown) => {
      const { permissions: names, ...rest } = (typeof query === 'object' && query !== null ? query : {}) as {
        permissions?: unknown;
      };
      const list = Array.isArray(names) ? names : [];
      return {
        granted: list.every((name) => !bridged.includes(name) || permissions.includes(name)),
        rest: { ...rest, permissions: list.filter((name) => !bridged.includes(name)) },
      };
    };
    const original = {
      contains: native.contains?.bind(native),
      request: native.request?.bind(native),
    };
    const check = (method: 'contains' | 'request') => (query: unknown, callback: Callback) => {
      const { granted, rest } = split(query);
      const nothingElse = rest.permissions.length === 0 && !(rest as { origins?: unknown[] }).origins?.length;
      const forward = original[method];
      const result = !granted
        ? Promise.resolve(false)
        : nothingElse || !forward
          ? Promise.resolve(true)
          : forward(rest);
      return settle(result, callback);
    };
    const getAll = native.getAll.bind(native);
    define(native, 'contains', check('contains'));
    define(native, 'request', check('request'));
    define(native, 'getAll', (callback: Callback) =>
      settle(
        getAll().then((all) => ({ ...all, permissions: [...new Set([...(all.permissions ?? []), ...bridged])] })),
        callback,
      ),
    );
  }
}

contextBridge.executeInMainWorld({ func: installExtensionApis, args: [bridge] });
ipcRenderer.send(ExtensionBridgeChannel.subscribe);
