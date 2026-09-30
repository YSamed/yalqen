import { contextBridge, ipcRenderer, webFrame, type IpcRendererEvent } from 'electron';
import {
  WEB_STORE_CALL,
  WEB_STORE_EVENT,
  WebStoreInstallStatus,
  WebStoreMv2Status,
  WebStoreResult,
  WebStoreWebGl,
  type WebStoreEventKind,
} from '../shared/web-store.js';

const PAGE_SCRIPT = `(() => {
  const bridge = globalThis.__yalqenWebStore;
  const chromeApi = (globalThis.chrome = globalThis.chrome || {});
  const runtime = (chromeApi.runtime = chromeApi.runtime || {});
  const extension = (chromeApi.extension = chromeApi.extension || {});
  const listeners = { installed: new Set(), uninstalled: new Set() };

  const setLastError = (message) => {
    const error = message ? { message } : null;
    runtime.lastError = error;
    extension.lastError = error;
  };
  const call = (method, ...args) => {
    const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
    const promise = bridge.call(method, args);
    if (callback) promise.then(callback);
    return promise;
  };
  const event = (kind) => ({
    addListener: (listener) => listeners[kind].add(listener),
    removeListener: (listener) => listeners[kind].delete(listener),
    hasListener: (listener) => listeners[kind].has(listener),
  });

  globalThis.__yalqenWebStoreEmit = (kind, value) => {
    for (const listener of [...listeners[kind]]) listener(value);
  };

  chromeApi.webstorePrivate = {
    ExtensionInstallStatus: ${JSON.stringify(WebStoreInstallStatus)},
    MV2DeprecationStatus: ${JSON.stringify(WebStoreMv2Status)},
    Result: ${JSON.stringify(WebStoreResult)},
    WebGlStatus: ${JSON.stringify(WebStoreWebGl)},
    beginInstallWithManifest3: (details, callback) =>
      bridge.call('beginInstall', [details]).then(({ result, message }) => {
        setLastError(result === 'success' ? null : message);
        if (callback) callback(result);
        return result;
      }),
    completeInstall: (...args) => call('completeInstall', ...args),
    enableAppLauncher: (...args) => call('enableAppLauncher', ...args),
    getBrowserLogin: (...args) => call('getBrowserLogin', ...args),
    getExtensionStatus: (...args) => call('getExtensionStatus', ...args),
    getFullChromeVersion: (...args) => call('getFullChromeVersion', ...args),
    getIsLauncherEnabled: (...args) => call('getIsLauncherEnabled', ...args),
    getMV2DeprecationStatus: (...args) => call('getMV2DeprecationStatus', ...args),
    getReferrerChain: (...args) => call('getReferrerChain', ...args),
    getStoreLogin: (...args) => call('getStoreLogin', ...args),
    getWebGLStatus: (...args) => call('getWebGLStatus', ...args),
    install: (...args) => call('install', ...args),
    isInIncognitoMode: (...args) => call('isInIncognitoMode', ...args),
    isPendingCustodianApproval: (...args) => call('isPendingCustodianApproval', ...args),
    setStoreLogin: (...args) => call('setStoreLogin', ...args),
  };
  runtime.getManifest = () => ({});
  chromeApi.management = Object.assign(chromeApi.management || {}, {
    onInstalled: event('installed'),
    onUninstalled: event('uninstalled'),
    getAll: (...args) => call('getAll', ...args),
    setEnabled: (...args) => call('setEnabled', ...args),
    uninstall: (...args) => call('uninstall', ...args),
  });
})();`;

const HIDE_SWITCH_BROWSER_BANNER = 'div[jscontroller="o2G9me"] { display: none !important; }';

export function setupWebStorePage(): void {
  contextBridge.exposeInMainWorld('__yalqenWebStore', {
    call: (method: string, args: unknown[]) => ipcRenderer.invoke(WEB_STORE_CALL, method, args) as Promise<unknown>,
  });
  ipcRenderer.on(WEB_STORE_EVENT, (_event: IpcRendererEvent, kind: WebStoreEventKind, value: unknown) => {
    const emit = `globalThis.__yalqenWebStoreEmit?.(${JSON.stringify(kind)}, ${JSON.stringify(value)})`;
    void webFrame.executeJavaScript(emit);
  });
  void webFrame.executeJavaScript(PAGE_SCRIPT);
  webFrame.insertCSS(HIDE_SWITCH_BROWSER_BANNER);
}
