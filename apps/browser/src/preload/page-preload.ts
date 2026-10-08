import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  AgentBridgeChannel,
  ExtensionsChannel,
  NEW_TAB_URL,
  PageChannel,
  PasswordsChannel,
  RequestRulesChannel,
  SETTINGS_URL,
  SettingsChannel as settingsChannel,
  SitePermissionsChannel,
  type AgentBridgeView,
  type AgentSetupKind,
  type AgentClientId,
  type AgentConnections,
  type AgentSetupResult,
  type ClearDataRequest,
  type ExtensionInfo,
  type NewTabCenter,
  type PasswordsView,
  type ManualPassword,
  type PasswordTransferResult,
  type SavedLoginsView,
  type ProcessUsage,
  type ProfilesView,
  type ProfilesResult,
  type RequestRule,
  type SettingsApi,
  type SettingsValues,
  type SettingsView,
  type SitePermissionsView,
  type SubmittedCredential,
} from '../shared/types.js';
import { WEB_STORE_ORIGIN } from '../shared/web-store.js';
import { selectLogin } from '../shared/login-selection.js';
import { setupGoogleSignInPage } from './google-sign-in.js';
import { setupWebStorePage } from './web-store.js';

const THRESHOLD = 90;
const GAP_MS = 350;
const COOLDOWN_MS = 650;
const PENDING_CENTER_MS = 250;

let distance = 0;
let lastAt = 0;
let navigatedAt = 0;
let gestureAt = -Infinity;
let gestureInScroller = false;

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
    if (Math.abs(event.deltaX) < Math.abs(event.deltaY) * 1.25) {
      distance = 0;
      return;
    }

    const now = performance.now();
    // Chromium keeps a wheel gesture on one scroller, so its target is checked once per gesture
    // instead of forcing style and layout on every event.
    if (now - gestureAt > GAP_MS) gestureInScroller = hasHorizontalScroller(event);
    gestureAt = now;
    if (gestureInScroller) {
      distance = 0;
      return;
    }
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
if (location.hostname === 'accounts.google.com') setupGoogleSignInPage();

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
    relaunch: () => ipcRenderer.invoke(settingsChannel.relaunch) as Promise<void>,
    processUsage: () => ipcRenderer.invoke(settingsChannel.processUsage) as Promise<ProcessUsage>,
    checkForUpdates: () => ipcRenderer.invoke(settingsChannel.checkForUpdates) as Promise<void>,
    installUpdate: () => ipcRenderer.invoke(settingsChannel.installUpdate) as Promise<void>,
    chooseDownloadDirectory: () => ipcRenderer.invoke(settingsChannel.chooseDownloadDirectory) as Promise<SettingsView>,
    updateThreatLists: () => ipcRenderer.invoke(settingsChannel.updateThreatLists) as Promise<SettingsView>,
    profiles: () => ipcRenderer.invoke(settingsChannel.profiles) as Promise<ProfilesView>,
    profileAction: (action, id, name) =>
      ipcRenderer.invoke(settingsChannel.profileAction, action, id, name) as Promise<ProfilesResult>,
    requestRules: () => ipcRenderer.invoke(RequestRulesChannel.list) as Promise<RequestRule[]>,
    saveRequestRules: (rules: RequestRule[]) =>
      ipcRenderer.invoke(RequestRulesChannel.save, rules) as Promise<RequestRule[]>,
    sitePermissions: () => ipcRenderer.invoke(SitePermissionsChannel.list) as Promise<SitePermissionsView>,
    setSitePermission: (origin, kind, decision) =>
      ipcRenderer.invoke(SitePermissionsChannel.set, origin, kind, decision) as Promise<SitePermissionsView>,
    forgetSitePermissions: (origin: string) =>
      ipcRenderer.invoke(SitePermissionsChannel.forget, origin) as Promise<SitePermissionsView>,
    openSystemSettings: (device) =>
      ipcRenderer.invoke(SitePermissionsChannel.openSystemSettings, device) as Promise<void>,
    extensions: () => ipcRenderer.invoke(ExtensionsChannel.list) as Promise<ExtensionInfo[]>,
    checkExtensionUpdates: () => ipcRenderer.invoke(ExtensionsChannel.checkUpdates) as Promise<string | null>,
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
    savePassword: (value: ManualPassword) => ipcRenderer.invoke(PasswordsChannel.save, value) as Promise<boolean>,
    generatePassword: () => ipcRenderer.invoke(PasswordsChannel.generate) as Promise<string | null>,
    transferPasswords: (mode: 'import' | 'export') =>
      ipcRenderer.invoke(PasswordsChannel.transfer, mode) as Promise<PasswordTransferResult>,
    passwords: () => ipcRenderer.invoke(PasswordsChannel.list) as Promise<PasswordsView>,
    revealPassword: (id: string) => ipcRenderer.invoke(PasswordsChannel.reveal, id) as Promise<string | null>,
    copyPassword: (id: string) => ipcRenderer.invoke(PasswordsChannel.copy, id) as Promise<boolean>,
    removePassword: (id: string) => ipcRenderer.invoke(PasswordsChannel.remove, id) as Promise<void>,
    allowSaving: (origin: string) => ipcRenderer.invoke(PasswordsChannel.allowSaving, origin) as Promise<void>,
    onPasswordsChange: (listener) => subscribe<PasswordsView>(PasswordsChannel.changed, listener),
    agentBridge: () => ipcRenderer.invoke(AgentBridgeChannel.status) as Promise<AgentBridgeView>,
    copyAgentSetup: (kind: AgentSetupKind) => ipcRenderer.invoke(AgentBridgeChannel.copy, kind) as Promise<boolean>,
    regenerateAgentToken: () => ipcRenderer.invoke(AgentBridgeChannel.regenerate) as Promise<AgentBridgeView>,
    agentConnections: () => ipcRenderer.invoke(AgentBridgeChannel.connections) as Promise<AgentConnections | null>,
    connectAgent: (id: AgentClientId) =>
      ipcRenderer.invoke(AgentBridgeChannel.connect, id) as Promise<AgentSetupResult>,
    disconnectAgent: (id: AgentClientId) =>
      ipcRenderer.invoke(AgentBridgeChannel.disconnect, id) as Promise<AgentSetupResult>,
    onAgentBridgeChange: (listener) => subscribe<AgentBridgeView>(AgentBridgeChannel.changed, listener),
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
  return input.isConnected && !input.disabled && !input.readOnly && isShown(input);
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
function loginFields(target?: HTMLInputElement): LoginFields | null {
  const scope = target?.form ?? document;
  const password =
    target?.type === 'password'
      ? target
      : passwordInputs(scope).find((input) => isFillable(input) && !hasToken(input, 'new-password'));
  if (!password || !isFillable(password) || hasToken(password, 'new-password')) return null;
  const form = password.form ?? document;
  if (passwordInputs(form).filter(isShown).length !== 1) return null;
  const inputs = [...form.querySelectorAll<HTMLInputElement>('input')].filter(
    (input) => input.isConnected && !input.disabled && isShown(input),
  );
  const username =
    inputs.find((input) => hasToken(input, 'username')) ??
    inputs
      .slice(0, inputs.indexOf(password))
      .filter((input) => USERNAME_TYPES.has(input.type))
      .at(-1) ??
    null;
  return { username, password };
}

function setValue(input: HTMLInputElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

let savedLogins: Promise<SavedLoginsView> | null = null;
const filledPasswords = new WeakSet<HTMLInputElement>();
let pickerHost: HTMLElement | null = null;
let pickerButton: HTMLButtonElement | null = null;
let pickerFields: LoginFields | null = null;
let pickerMode: 'login' | 'generate' = 'login';
let picking = false;
let pickerObserver: ResizeObserver | null = null;

function positionPicker(): void {
  if (!pickerHost || !pickerFields) return;
  const input = pickerFields.password;
  const rect = input.getBoundingClientRect();
  pickerHost.hidden =
    !isFillable(input) || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth;
  pickerHost.style.setProperty('display', pickerHost.hidden ? 'none' : 'block', 'important');
  pickerHost.style.setProperty('left', `${Math.max(0, Math.min(rect.right + 6, innerWidth - 32))}px`, 'important');
  pickerHost.style.setProperty(
    'top',
    `${Math.max(0, Math.min(rect.top + (rect.height - 28) / 2, innerHeight - 28))}px`,
    'important',
  );
}

function showPicker(fields: LoginFields, label: string, mode: 'login' | 'generate' = 'login'): void {
  pickerMode = mode;
  if (pickerFields?.password !== fields.password) {
    pickerObserver?.disconnect();
    pickerObserver = new ResizeObserver(positionPicker);
    pickerObserver.observe(fields.password);
  }
  pickerFields = fields;
  if (!pickerHost) {
    pickerHost = document.createElement('div');
    pickerHost.dataset.yalqenLoginPicker = '';
    pickerHost.style.cssText =
      'all: initial !important; position: fixed !important; z-index: 2147483647 !important; width: 28px !important; height: 28px !important;';
    const shadow = pickerHost.attachShadow({ mode: 'closed' });
    pickerButton = document.createElement('button');
    pickerButton.style.cssText =
      'all: initial; box-sizing: border-box; width: 28px; height: 28px; border: 1px solid GrayText; border-radius: 6px; background: Canvas; color: CanvasText; font: 16px system-ui; text-align: center; cursor: pointer; outline: revert;';
    pickerButton.type = 'button';
    pickerButton.textContent = '⌄';
    pickerButton.addEventListener('click', async (event) => {
      if (!event.isTrusted || picking || !pickerFields) return;
      const fields = pickerFields;
      const mode = pickerMode;
      const generation = mode === 'generate' ? generationFields(fields.password) : null;
      const values = generation?.inputs.map((input) => input.value);
      const username = fields.username?.value;
      const password = fields.password.value;
      picking = true;
      pickerButton!.disabled = true;
      try {
        if (mode === 'generate') {
          if (!generation) return;
          const generated = (await ipcRenderer.invoke(PageChannel.generatePassword, generation.length)) as
            string | null;
          const current = generationFields(fields.password);
          if (
            !generated ||
            !current ||
            current.password !== fields.password ||
            current.length !== generation.length ||
            current.inputs.length !== generation.inputs.length ||
            current.inputs.some((input, index) => input !== generation.inputs[index] || input.value !== values?.[index])
          )
            return;
          for (const input of current.inputs) setValue(input, generated);
          return;
        }
        const login = (await ipcRenderer.invoke(PageChannel.chooseSavedLogin)) as SubmittedCredential | null;
        if (
          !login ||
          !isFillable(fields.password) ||
          (fields.username &&
            (!fields.username.isConnected ||
              fields.username.disabled ||
              !isShown(fields.username) ||
              (fields.username.readOnly && fields.username.value.trim() !== login.username))) ||
          fields.username?.value !== username ||
          fields.password.value !== password
        )
          return;
        if (fields.username && !fields.username.readOnly) setValue(fields.username, login.username);
        setValue(fields.password, login.password);
        filledPasswords.add(fields.password);
      } catch {
        /* A closed page or dismissed picker leaves the current form intact. */
      } finally {
        picking = false;
        if (pickerButton) pickerButton.disabled = false;
      }
    });
    shadow.append(pickerButton);
    document.documentElement.append(pickerHost);
    document.addEventListener('scroll', positionPicker, { capture: true, passive: true });
    window.addEventListener('resize', positionPicker, { passive: true });
  }
  delete pickerHost!.dataset.yalqenLoginPicker;
  delete pickerHost!.dataset.yalqenPasswordGenerator;
  if (mode === 'login') pickerHost!.dataset.yalqenLoginPicker = '';
  else pickerHost!.dataset.yalqenPasswordGenerator = '';
  pickerButton!.textContent = mode === 'generate' ? '✦' : '⌄';
  pickerButton!.ariaLabel = label;
  pickerButton!.title = label;
  positionPicker();
}

function generationFields(
  target?: HTMLInputElement,
): { password: HTMLInputElement; inputs: HTMLInputElement[]; length: number } | null {
  const scope = target?.form ?? document;
  const password =
    target?.type === 'password' && hasToken(target, 'new-password')
      ? target
      : passwordInputs(scope).find((input) => hasToken(input, 'new-password') && isFillable(input));
  if (!password || !isFillable(password)) return null;
  const inputs = passwordInputs(password.form ?? document).filter(
    (input) => hasToken(input, 'new-password') && isFillable(input),
  );
  const minimum = Math.max(12, ...inputs.map((input) => input.minLength));
  const maximum = Math.min(128, ...inputs.map((input) => (input.maxLength < 0 ? 128 : input.maxLength)));
  if (minimum > maximum || maximum < 12) return null;
  return { password, inputs, length: Math.max(minimum, Math.min(20, maximum)) };
}

async function fillLogin(target?: HTMLInputElement): Promise<void> {
  target ??= document.activeElement instanceof HTMLInputElement ? document.activeElement : undefined;
  const generation = generationFields(target);
  if (generation) {
    savedLogins ??= (ipcRenderer.invoke(PageChannel.savedLogins) as Promise<SavedLoginsView>).catch(() => ({
      choices: [],
      chooseLabel: '',
    }));
    const { generateLabel } = await savedLogins;
    const current = generationFields(generation.password);
    if (generateLabel && current?.password === generation.password)
      showPicker({ username: null, password: generation.password }, generateLabel, 'generate');
    return;
  }
  const before = loginFields(target);
  if (!before) {
    if (pickerHost) {
      pickerHost.hidden = true;
      pickerHost.style.setProperty('display', 'none', 'important');
    }
    return;
  }
  savedLogins ??= (ipcRenderer.invoke(PageChannel.savedLogins) as Promise<SavedLoginsView>).catch(() => ({
    choices: [],
    chooseLabel: '',
  }));
  const { choices, chooseLabel } = await savedLogins;
  const fields = loginFields(before.password);
  if (!fields || fields.password !== before.password || choices.length === 0) return;
  showPicker(fields, chooseLabel);
  if (fields.password.value || filledPasswords.has(fields.password)) return;
  const choice = selectLogin(choices, fields.username?.value ?? '');
  if (!choice) return;
  const typed = fields.username?.value;
  const login = (await ipcRenderer
    .invoke(PageChannel.fillSavedLogin, choice.id)
    .catch(() => null)) as SubmittedCredential | null;
  if (
    !login ||
    !isFillable(fields.password) ||
    fields.password.value ||
    filledPasswords.has(fields.password) ||
    fields.username?.value !== typed
  )
    return;
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
      if (event.target instanceof HTMLInputElement) void fillLogin(event.target);
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
