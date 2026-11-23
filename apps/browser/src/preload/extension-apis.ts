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
  declarativeNetRequest(state: unknown): Promise<void>;
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
  declarativeNetRequest: (state) => ipcRenderer.invoke(ExtensionBridgeChannel.declarativeNetRequest, state),
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
    define(chromeApi, 'identity', {
      getRedirectURL: (path = '') => `https://${runtime.id}.chromiumapp.org/${String(path).replace(/^\//, '')}`,
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

  // Dark Reader asks this at startup; Electron loads extensions without file access.
  const extensionApi = chromeApi.extension as Record<string, unknown> | undefined;
  if (extensionApi && typeof extensionApi.isAllowedFileSchemeAccess !== 'function')
    define(extensionApi, 'isAllowedFileSchemeAccess', (callback: Callback) => settle(Promise.resolve(false), callback));
  if (extensionApi && typeof extensionApi.isAllowedIncognitoAccess !== 'function')
    define(extensionApi, 'isAllowedIncognitoAccess', (callback: Callback) => settle(Promise.resolve(false), callback));

  type Method = (...args: unknown[]) => Promise<unknown>;
  const rules = chromeApi.declarativeNetRequest as Record<string, Method> | undefined;
  if (rules && typeof rules.getDynamicRules === 'function') {
    const read = (name: string) => (typeof rules[name] === 'function' ? rules[name]() : Promise.resolve([]));
    const sync = () =>
      Promise.all([read('getEnabledRulesets'), read('getDynamicRules'), read('getSessionRules')])
        .then(([enabled, dynamic, session]) => api.declarativeNetRequest({ enabled, dynamic, session }))
        .catch((error: unknown) => console.error(error));
    for (const name of ['updateDynamicRules', 'updateSessionRules', 'updateEnabledRulesets']) {
      const original = rules[name];
      if (typeof original !== 'function') continue;
      define(rules, name, (...args: unknown[]) => {
        const callback = lastArgument(args);
        const done = original
          .apply(
            rules,
            args.filter((arg) => arg !== callback),
          )
          .then((value) => {
            void sync();
            return value;
          });
        return settle(done, callback);
      });
    }
    if (typeof (globalThis as { ServiceWorkerGlobalScope?: unknown }).ServiceWorkerGlobalScope !== 'undefined')
      void sync();
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
