import { contextBridge, ipcRenderer } from 'electron';
import {
  ExtensionBridgeChannel,
  type ExtensionBridgeEvent,
  type ExtensionWindows,
} from '../shared/extension-bridge.js';

type Dispatch = (...args: unknown[]) => void;

interface Bridge {
  createTab(properties: unknown): Promise<unknown>;
  removeTabs(ids: unknown): Promise<void>;
  cookies(method: string, details: unknown): Promise<unknown>;
  windows(): Promise<ExtensionWindows>;
  subscribe(event: ExtensionBridgeEvent, dispatch: Dispatch): void;
}

const dispatchers = new Map<ExtensionBridgeEvent, Dispatch>();
ipcRenderer.on(ExtensionBridgeChannel.event, (_event, name: ExtensionBridgeEvent, args: unknown[]) => {
  dispatchers.get(name)?.(...args);
});

const bridge: Bridge = {
  createTab: (properties) => ipcRenderer.invoke(ExtensionBridgeChannel.createTab, properties),
  removeTabs: (ids) => ipcRenderer.invoke(ExtensionBridgeChannel.removeTabs, ids),
  cookies: (method, details) => ipcRenderer.invoke(ExtensionBridgeChannel.cookies, method, details),
  windows: () => ipcRenderer.invoke(ExtensionBridgeChannel.windows),
  subscribe: (event, dispatch) => {
    dispatchers.set(event, dispatch);
  },
};

// Runs in the extension's own world and is serialized there, so it must not reference anything outside itself.
function installExtensionApis(api: Bridge): void {
  type Listener = (...args: unknown[]) => void;
  type Callback = ((value?: unknown) => void) | undefined;
  const chromeApi = (globalThis as { chrome?: Record<string, unknown> }).chrome;
  const tabs = chromeApi?.tabs as Record<string, unknown> | undefined;
  const runtime = chromeApi?.runtime as { id: string; getManifest(): { permissions?: string[] } } | undefined;
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
  const event = (name: ExtensionBridgeEvent) => {
    const listeners = new Set<Listener>();
    api.subscribe(name, (...args) => {
      for (const listener of [...listeners]) {
        try {
          listener(...args);
        } catch (error) {
          console.error(error);
        }
      }
    });
    return {
      addListener: (listener: Listener) => void listeners.add(listener),
      removeListener: (listener: Listener) => void listeners.delete(listener),
      hasListener: (listener: Listener) => listeners.has(listener),
      hasListeners: () => listeners.size > 0,
    };
  };
  const define = (target: Record<string, unknown>, key: string, value: unknown) =>
    Object.defineProperty(target, key, { value, configurable: true, enumerable: true, writable: true });

  define(tabs, 'create', (properties: unknown, callback: Callback) =>
    settle(api.createTab(properties ?? {}), callback),
  );
  define(tabs, 'remove', (ids: unknown, callback: Callback) => settle(api.removeTabs(ids), callback));
  define(tabs, 'onUpdated', event('tabs.onUpdated'));
  define(tabs, 'onRemoved', event('tabs.onRemoved'));

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
    // shortcut: only the redirect URL; launchWebAuthFlow and getAuthToken stay missing until an extension needs them.
    define(chromeApi, 'identity', {
      getRedirectURL: (path = '') => `https://${runtime.id}.chromiumapp.org/${String(path).replace(/^\//, '')}`,
    });
  }

  if (!chromeApi.windows) {
    // Without chrome.windows, Grammarly's background page throws while starting up and never loads the
    // signed-in account. shortcut: no create/update/remove; extensions only read windows and follow focus.
    const WINDOW_ID_NONE = -1;
    const WINDOW_ID_CURRENT = -2;
    const lastArgument = (args: unknown[]) => args.find((arg) => typeof arg === 'function') as Callback;
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

  // Electron's chrome.permissions throws on permissions it does not implement, so an extension that checks
  // for "cookies" before reading its sign-in cookie would treat itself as signed out.
  const bridged = ['cookies', 'identity'].filter((name) => permissions.includes(name));
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
