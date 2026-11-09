import { contextBridge, ipcRenderer } from 'electron';
import { ExtensionBridgeChannel, type ExtensionBridgeEvent } from '../shared/extension-bridge.js';

type Dispatch = (...args: unknown[]) => void;

interface Bridge {
  createTab(properties: unknown): Promise<unknown>;
  removeTabs(ids: unknown): Promise<void>;
  cookies(method: string, details: unknown): Promise<unknown>;
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
}

contextBridge.executeInMainWorld({ func: installExtensionApis, args: [bridge] });
ipcRenderer.send(ExtensionBridgeChannel.subscribe);
