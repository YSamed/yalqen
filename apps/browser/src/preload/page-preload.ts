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
import { WEB_STORE_ORIGIN } from '../shared/web-store.js';
import { setupWebStorePage } from './web-store.js';

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

if (location.origin === WEB_STORE_ORIGIN && window === window.top) setupWebStorePage();

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
    installExtensionFromStore: (input: string) =>
      ipcRenderer.invoke(ExtensionsChannel.installFromStore, input) as Promise<string | null>,
    openExtensionStore: () => ipcRenderer.invoke(ExtensionsChannel.openStore) as Promise<void>,
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
const SUBMISSION_WATCH_MS = 10_000;
const SUBMISSION_POLL_MS = 100;
const FILL_WATCH_MS = 10_000;
const FILL_THROTTLE_MS = 100;

function hasToken(input: HTMLInputElement, token: string): boolean {
  return input.autocomplete.split(/\s+/).includes(token);
}

function isShown(input: HTMLInputElement): boolean {
  return input.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
}

function isFillable(input: HTMLInputElement): boolean {
  return !input.disabled && isShown(input);
}

function passwordInputs(scope: ParentNode): HTMLInputElement[] {
  return [...scope.querySelectorAll<HTMLInputElement>('input[type="password"]')];
}

function usernameFor(scope: ParentNode, password: HTMLInputElement): string {
  const inputs = [...scope.querySelectorAll<HTMLInputElement>('input')].filter((input) => input.value.trim());
  const tagged = inputs.find((input) => hasToken(input, 'username'));
  if (tagged) return tagged.value;
  const before = inputs.slice(0, inputs.indexOf(password) + 1).filter((input) => USERNAME_TYPES.has(input.type));
  return before.at(-1)?.value ?? '';
}

// On a change-password form the new password is the one worth keeping.
function submittedPassword(scope: ParentNode): HTMLInputElement | null {
  const passwords = passwordInputs(scope).filter((input) => input.value);
  return passwords.find((input) => hasToken(input, 'new-password')) ?? passwords[0] ?? null;
}

let submissionWatch = 0;

// Script-driven logins that succeed often just swap the form out, with no navigation to wait for.
function watchForSuccess(password: HTMLInputElement): void {
  clearInterval(submissionWatch);
  const startedAt = performance.now();
  submissionWatch = window.setInterval(() => {
    if (performance.now() - startedAt > SUBMISSION_WATCH_MS) {
      clearInterval(submissionWatch);
      return;
    }
    const formGone = !(password.isConnected && isShown(password)) && !passwordInputs(document).some(isShown);
    if (!formGone) return;
    clearInterval(submissionWatch);
    ipcRenderer.send(PageChannel.credentialAccepted);
  }, SUBMISSION_POLL_MS);
}

function reportCredential(scope: ParentNode): void {
  const password = submittedPassword(scope);
  if (!password) return;
  const credential: SubmittedCredential = { username: usernameFor(scope, password), password: password.value };
  ipcRenderer.send(PageChannel.credentialSubmitted, credential);
  watchForSuccess(password);
}

interface LoginFields {
  username: HTMLInputElement | null;
  password: HTMLInputElement;
}

// Sign-up and change-password forms carry several password fields or a new-password hint, so only
// a form with a single current-password field is filled.
function loginFields(): LoginFields | null {
  const password = passwordInputs(document).find((input) => isFillable(input) && !hasToken(input, 'new-password'));
  if (!password) return null;
  const scope = password.form ?? document;
  if (passwordInputs(scope).filter(isShown).length !== 1) return null;
  const inputs = [...scope.querySelectorAll<HTMLInputElement>('input')].filter(isFillable);
  const username =
    inputs.find((input) => hasToken(input, 'username')) ??
    inputs
      .slice(0, inputs.indexOf(password))
      .filter((input) => USERNAME_TYPES.has(input.type))
      .at(-1) ??
    null;
  return { username, password };
}

function pickLogin(logins: SubmittedCredential[], { username }: LoginFields): SubmittedCredential | undefined {
  const typed = username?.value.trim();
  if (typed) return logins.find((login) => login.username === typed);
  return username || logins.length === 1 ? logins[0] : undefined;
}

function setValue(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

let savedLogins: Promise<SubmittedCredential[]> | null = null;
const filledPasswords = new WeakSet<HTMLInputElement>();

async function fillLogin(): Promise<void> {
  const before = loginFields();
  if (!before || before.password.value || filledPasswords.has(before.password)) return;
  savedLogins ??= (ipcRenderer.invoke(PageChannel.savedLogins) as Promise<SubmittedCredential[]>).catch(() => []);
  const logins = await savedLogins;
  if (logins.length === 0) return;
  const fields = loginFields();
  if (!fields || fields.password.value || filledPasswords.has(fields.password)) return;
  const login = pickLogin(logins, fields);
  if (!login) return;
  if (fields.username && !fields.username.value.trim()) setValue(fields.username, login.username);
  setValue(fields.password, login.password);
  filledPasswords.add(fields.password);
}

if (window === window.top && (location.protocol === 'https:' || location.protocol === 'http:')) {
  let fillTimer = 0;
  const scheduleFill = () => {
    if (fillTimer) return;
    fillTimer = window.setTimeout(() => {
      fillTimer = 0;
      void fillLogin();
    }, FILL_THROTTLE_MS);
  };
  window.addEventListener(
    'DOMContentLoaded',
    () => {
      void fillLogin();
      const observer = new MutationObserver(scheduleFill);
      observer.observe(document.documentElement, { childList: true, subtree: true });
      window.setTimeout(() => observer.disconnect(), FILL_WATCH_MS);
    },
    { once: true },
  );
  document.addEventListener(
    'focusin',
    (event) => {
      if (event.target instanceof HTMLInputElement) void fillLogin();
    },
    { capture: true },
  );
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
