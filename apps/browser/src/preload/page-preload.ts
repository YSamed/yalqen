import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  ExtensionsChannel,
  NEW_TAB_URL,
  PageChannel,
  PasswordsChannel,
  RequestRulesChannel,
  SETTINGS_URL,
  SettingsChannel as settingsChannel,
  type ClearDataRequest,
  type ExtensionInfo,
  type NewTabCenter,
  type PasswordsView,
  type ProcessUsage,
  type RequestRule,
  type SettingsApi,
  type SettingsValues,
  type SettingsView,
  type SubmittedCredential,
} from '../shared/types.js';

const THRESHOLD = 90;
const GAP_MS = 350;
const COOLDOWN_MS = 650;
const PENDING_CENTER_MS = 250;

let distance = 0;
let lastAt = 0;
let navigatedAt = 0;

if (location.href === NEW_TAB_URL && window === window.top) {
  let centerOffset = 0;
  let pending: NewTabCenter | null = null;
  let pendingTimer = 0;
  const applyCenterOffset = () => {
    document.documentElement?.style.setProperty('--newtab-center-offset', `${centerOffset}px`);
  };
  const apply = (offset: number) => {
    pending = null;
    clearTimeout(pendingTimer);
    centerOffset = offset;
    applyCenterOffset();
  };
  // An offset meant for a new page width waits for the matching resize, so both land in the same frame.
  const receive = (center: NewTabCenter | undefined) => {
    if (!center || !Number.isFinite(center.offset)) return;
    if (center.width === null || Math.abs(window.innerWidth - center.width) < 1) {
      apply(center.offset);
      return;
    }
    pending = center;
    clearTimeout(pendingTimer);
    pendingTimer = window.setTimeout(() => apply(center.offset), PENDING_CENTER_MS);
  };
  window.addEventListener('resize', () => {
    if (pending) receive(pending);
  });
  ipcRenderer.on(PageChannel.newTabCenter, (_event, center: NewTabCenter) => receive(center));
  receive(ipcRenderer.sendSync(PageChannel.newTabCenter));
  window.addEventListener('DOMContentLoaded', applyCenterOffset, { once: true });
}

function hasHorizontalScroller(event: WheelEvent): boolean {
  for (const target of event.composedPath()) {
    if (!(target instanceof Element)) continue;
    const style = getComputedStyle(target);
    if (!['auto', 'scroll', 'overlay'].includes(style.overflowX)) continue;
    if (target.scrollWidth > target.clientWidth + 1) return true;
  }
  return (
    document.scrollingElement !== null &&
    document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1
  );
}

window.addEventListener(
  'wheel',
  (event) => {
    if (!event.isTrusted) return;
    if (
      event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      event.shiftKey
    )
      return;
    if (Math.abs(event.deltaX) < Math.abs(event.deltaY) * 1.25 || hasHorizontalScroller(event)) {
      distance = 0;
      return;
    }

    const now = performance.now();
    if (now - navigatedAt < COOLDOWN_MS) return;
    if (now - lastAt > GAP_MS || Math.sign(event.deltaX) !== Math.sign(distance)) distance = 0;
    lastAt = now;
    distance += event.deltaX;
    if (Math.abs(distance) < THRESHOLD) return;

    ipcRenderer.send(PageChannel.swipe, distance < 0 ? 'back' : 'forward');
    navigatedAt = now;
    distance = 0;
  },
  { capture: true, passive: true },
);

function subscribe<T>(name: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(name, handler);
  return () => ipcRenderer.off(name, handler);
}

if (location.href.startsWith(SETTINGS_URL) && window === window.top) {
  const api: SettingsApi = {
    get: () => ipcRenderer.invoke(settingsChannel.get) as Promise<SettingsView>,
    update: (patch: Partial<SettingsValues>) =>
      ipcRenderer.invoke(settingsChannel.update, patch) as Promise<SettingsView>,
    clearData: (request: ClearDataRequest) => ipcRenderer.invoke(settingsChannel.clearData, request) as Promise<void>,
    makeDefault: () => ipcRenderer.invoke(settingsChannel.makeDefault) as Promise<SettingsView>,
    processUsage: () => ipcRenderer.invoke(settingsChannel.processUsage) as Promise<ProcessUsage>,
    checkForUpdates: () => ipcRenderer.invoke(settingsChannel.checkForUpdates) as Promise<void>,
    installUpdate: () => ipcRenderer.invoke(settingsChannel.installUpdate) as Promise<void>,
    requestRules: () => ipcRenderer.invoke(RequestRulesChannel.list) as Promise<RequestRule[]>,
    saveRequestRules: (rules: RequestRule[]) =>
      ipcRenderer.invoke(RequestRulesChannel.save, rules) as Promise<RequestRule[]>,
    extensions: () => ipcRenderer.invoke(ExtensionsChannel.list) as Promise<ExtensionInfo[]>,
    installExtension: () => ipcRenderer.invoke(ExtensionsChannel.install) as Promise<string | null>,
    removeExtension: (path: string) => ipcRenderer.invoke(ExtensionsChannel.remove, path) as Promise<void>,
    setExtensionEnabled: (path: string, enabled: boolean) =>
      ipcRenderer.invoke(ExtensionsChannel.setEnabled, path, enabled) as Promise<void>,
    openExtensionOptions: (path: string) => ipcRenderer.invoke(ExtensionsChannel.openOptions, path) as Promise<void>,
    onChange: (listener) => subscribe<SettingsView>(settingsChannel.changed, listener),
    onExtensionsChange: (listener) => subscribe<ExtensionInfo[]>(ExtensionsChannel.changed, listener),
    passwords: () => ipcRenderer.invoke(PasswordsChannel.list) as Promise<PasswordsView>,
    revealPassword: (id: string) => ipcRenderer.invoke(PasswordsChannel.reveal, id) as Promise<string | null>,
    copyPassword: (id: string) => ipcRenderer.invoke(PasswordsChannel.copy, id) as Promise<boolean>,
    removePassword: (id: string) => ipcRenderer.invoke(PasswordsChannel.remove, id) as Promise<void>,
    allowSaving: (origin: string) => ipcRenderer.invoke(PasswordsChannel.allowSaving, origin) as Promise<void>,
    onPasswordsChange: (listener) => subscribe<PasswordsView>(PasswordsChannel.changed, listener),
  };
  contextBridge.exposeInMainWorld('yalqenSettings', api);
}

const USERNAME_TYPES = new Set(['text', 'email', 'tel']);

function filledPasswords(scope: ParentNode): HTMLInputElement[] {
  return [...scope.querySelectorAll<HTMLInputElement>('input[type="password"]')].filter((input) => input.value);
}

function usernameFor(scope: ParentNode, password: HTMLInputElement): string {
  const inputs = [...scope.querySelectorAll<HTMLInputElement>('input')].filter((input) => input.value.trim());
  const tagged = inputs.find((input) => input.autocomplete.split(/\s+/).includes('username'));
  if (tagged) return tagged.value;
  const before = inputs.slice(0, inputs.indexOf(password) + 1).filter((input) => USERNAME_TYPES.has(input.type));
  return before.at(-1)?.value ?? '';
}

// On a change-password form the new password is the one worth keeping.
function credentialIn(scope: ParentNode): SubmittedCredential | null {
  const passwords = filledPasswords(scope);
  if (passwords.length === 0) return null;
  const password = passwords.find((input) => input.autocomplete.split(/\s+/).includes('new-password')) ?? passwords[0];
  return { username: usernameFor(scope, password), password: password.value };
}

function reportCredential(scope: ParentNode): void {
  const credential = credentialIn(scope);
  if (credential) ipcRenderer.send(PageChannel.credentialSubmitted, credential);
}

if (window === window.top && (location.protocol === 'https:' || location.protocol === 'http:')) {
  document.addEventListener(
    'submit',
    (event) => {
      if (event.isTrusted && event.target instanceof HTMLFormElement) reportCredential(event.target);
    },
    { capture: true },
  );
  // Script-driven logins often skip the form's submit, so the click or Enter that starts them counts too.
  document.addEventListener(
    'click',
    (event) => {
      if (!event.isTrusted || !(event.target instanceof Element)) return;
      const button = event.target.closest('button, input[type="submit"], [role="button"]');
      if (button) reportCredential(button.closest('form') ?? document);
    },
    { capture: true },
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (!event.isTrusted || event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
      if (event.target.type === 'password' || USERNAME_TYPES.has(event.target.type)) {
        reportCredential(event.target.form ?? document);
      }
    },
    { capture: true },
  );
}
