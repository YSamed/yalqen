import {
  app,
  dialog,
  ipcMain,
  type BaseWindow,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
} from 'electron';
import { t } from '../shared/i18n.js';
import {
  WEB_STORE_CALL,
  WEB_STORE_EVENT,
  WEB_STORE_ORIGIN,
  WebStoreInstallStatus,
  WebStoreMv2Status,
  WebStoreResult,
  WebStoreWebGl,
  type WebStoreEventKind,
} from '../shared/web-store.js';
import { parseStoreId } from './chrome-web-store.js';
import type { ExtensionManager } from './extensions.js';
import type { Manifest } from './extension-manifest.js';

const MIN_MANIFEST_VERSION = 3;
const MAX_LISTED_PERMISSIONS = 12;
const MAX_NAME_LENGTH = 100;
const REFERRER_CHAIN = 'EgIIAA==';

export interface WebStoreHost {
  daily: Session;
  extensions: ExtensionManager;
  parentWindow(contents: WebContents): BaseWindow | null;
}

interface BeginInstallOutcome {
  result: string;
  message?: string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function parseManifest(json: unknown): Manifest | null {
  if (typeof json !== 'string') return null;
  try {
    const manifest: unknown = JSON.parse(json);
    return typeof manifest === 'object' && manifest !== null && !Array.isArray(manifest)
      ? (manifest as Manifest)
      : null;
  } catch {
    return null;
  }
}

export function isSupportedManifest(manifest: Manifest): boolean {
  return typeof manifest.manifest_version === 'number' && manifest.manifest_version >= MIN_MANIFEST_VERSION;
}

export function permissionSummary(manifest: Manifest): string {
  const permissions = [...strings(manifest.permissions), ...strings(manifest.host_permissions)];
  if (permissions.length === 0) return t('webStoreApi.noPermissions');
  const shown = permissions.slice(0, MAX_LISTED_PERMISSIONS).join(', ');
  const more = permissions.length - MAX_LISTED_PERMISSIONS;
  return more > 0
    ? t('webStoreApi.permissionsMore', { list: shown, count: more })
    : t('webStoreApi.permissions', { list: shown });
}

export function installPrompt(
  details: Record<string, unknown>,
  manifest: Manifest,
  id: string,
): { name: string; detail: string } {
  const candidate = [details.localizedName, manifest.name].find(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );
  const name = (candidate ?? id).trim().slice(0, MAX_NAME_LENGTH);
  return { name, detail: permissionSummary(manifest) };
}

export function extensionInfo(extension: { id: string; manifest: unknown }, enabled: boolean): Record<string, unknown> {
  const manifest = record(extension.manifest);
  const name = typeof manifest.name === 'string' ? manifest.name : extension.id;
  return {
    description: typeof manifest.description === 'string' ? manifest.description : '',
    enabled,
    homepageUrl: typeof manifest.homepage_url === 'string' ? manifest.homepage_url : '',
    hostPermissions: strings(manifest.host_permissions),
    icons: [],
    id: extension.id,
    installType: 'normal',
    isApp: false,
    mayDisable: true,
    name,
    offlineEnabled: false,
    optionsUrl: '',
    permissions: strings(manifest.permissions),
    shortName: typeof manifest.short_name === 'string' ? manifest.short_name : name,
    type: 'extension',
    updateUrl: '',
    version: typeof manifest.version === 'string' ? manifest.version : '',
  };
}

function isStoreFrame(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame || frame !== event.sender.mainFrame) return false;
  try {
    return new URL(frame.url).origin === WEB_STORE_ORIGIN;
  } catch {
    return false;
  }
}

export function registerWebStoreApi(host: WebStoreHost): void {
  const emit = (event: IpcMainInvokeEvent, kind: WebStoreEventKind, value: unknown) => {
    const frame = event.senderFrame;
    if (frame && !frame.isDestroyed()) frame.send(WEB_STORE_EVENT, kind, value);
  };

  const installedInfo = (id: string) => {
    const loaded = host.extensions.storeExtensions().find((item) => item.id === id);
    return loaded ? extensionInfo({ id, manifest: loaded.extension.manifest }, host.extensions.storeEnabled(id)) : null;
  };

  const storeId = (value: unknown): string | null => (typeof value === 'string' ? parseStoreId(value) : null);

  const beginInstall = async (event: IpcMainInvokeEvent, input: unknown): Promise<BeginInstallOutcome> => {
    const details = record(input);
    const id = storeId(details.id);
    if (!id) return { result: WebStoreResult.INVALID_ID };
    if (event.sender.session !== host.daily) return { result: WebStoreResult.FEATURE_DISABLED };
    const manifest = parseManifest(details.manifest);
    if (!manifest) return { result: WebStoreResult.MANIFEST_ERROR };
    if (!isSupportedManifest(manifest)) {
      return { result: WebStoreResult.MANIFEST_ERROR, message: t('webStoreApi.oldManifest') };
    }
    const status = host.extensions.storeStatus(id);
    if (status === 'installing') return { result: WebStoreResult.INSTALL_IN_PROGRESS };
    if (status === 'installed') return { result: WebStoreResult.ALREADY_INSTALLED };

    const { name, detail } = installPrompt(details, manifest, id);
    const options: Electron.MessageBoxOptions = {
      type: 'question',
      message: t('webStoreApi.addPrompt', { name }),
      detail,
      buttons: [t('webStoreApi.addButton'), t('webStoreApi.cancel')],
      defaultId: 1,
      cancelId: 1,
    };
    const parent = host.parentWindow(event.sender);
    const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
    if (response !== 0) return { result: WebStoreResult.USER_CANCELLED };

    const error = await host.extensions.installFromStore(id);
    if (error) return { result: WebStoreResult.INSTALL_ERROR, message: error };
    emit(event, 'installed', installedInfo(id));
    return { result: WebStoreResult.SUCCESS };
  };

  const uninstall = async (event: IpcMainInvokeEvent, idInput: unknown, optionsInput: unknown): Promise<string> => {
    const id = storeId(idInput);
    if (!id || host.extensions.storeStatus(id) !== 'installed') return WebStoreResult.UNKNOWN_ERROR;
    if (record(optionsInput).showConfirmDialog === true) {
      const parent = host.parentWindow(event.sender);
      const options: Electron.MessageBoxOptions = {
        type: 'question',
        message: t('webStoreApi.removePrompt'),
        buttons: [t('webStoreApi.remove'), t('webStoreApi.cancel')],
        defaultId: 1,
        cancelId: 1,
      };
      const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      if (response !== 0) return WebStoreResult.USER_CANCELLED;
    }
    host.extensions.removeStore(id);
    emit(event, 'uninstalled', id);
    return WebStoreResult.SUCCESS;
  };

  const extensionStatus = (idInput: unknown, manifestInput: unknown): string => {
    const id = storeId(idInput);
    const manifest = parseManifest(manifestInput);
    if (manifest && !isSupportedManifest(manifest)) return WebStoreInstallStatus.DEPRECATED_MANIFEST_VERSION;
    if (!id || host.extensions.storeStatus(id) !== 'installed') return WebStoreInstallStatus.INSTALLABLE;
    return host.extensions.storeEnabled(id) ? WebStoreInstallStatus.ENABLED : WebStoreInstallStatus.DISABLED;
  };

  const webGlStatus = async (): Promise<string> => {
    await app.getGPUInfo('basic');
    return app.getGPUFeatureStatus().webgl.startsWith('enabled') ? WebStoreWebGl.ALLOWED : WebStoreWebGl.BLOCKED;
  };

  ipcMain.handle(WEB_STORE_CALL, async (event, method: unknown, rawArgs: unknown) => {
    if (!isStoreFrame(event) || typeof method !== 'string') return null;
    const args = Array.isArray(rawArgs) ? rawArgs : [];
    switch (method) {
      case 'beginInstall':
        return beginInstall(event, args[0]);
      case 'getExtensionStatus':
        return extensionStatus(args[0], args[1]);
      case 'getFullChromeVersion':
        return { version_number: process.versions.chrome };
      case 'getMV2DeprecationStatus':
        return WebStoreMv2Status.SOFT_DISABLE;
      case 'getWebGLStatus':
        return webGlStatus();
      case 'isInIncognitoMode':
        return event.sender.session !== host.daily;
      case 'getReferrerChain':
        return REFERRER_CHAIN;
      case 'getBrowserLogin':
      case 'getStoreLogin':
        return '';
      case 'completeInstall':
      case 'install':
        return WebStoreResult.SUCCESS;
      case 'enableAppLauncher':
      case 'getIsLauncherEnabled':
      case 'setStoreLogin':
        return true;
      case 'isPendingCustodianApproval':
        return false;
      case 'getAll':
        return host.extensions
          .storeExtensions()
          .map((item) =>
            extensionInfo({ id: item.id, manifest: item.extension.manifest }, host.extensions.storeEnabled(item.id)),
          );
      case 'setEnabled': {
        const id = storeId(args[0]);
        if (!id || typeof args[1] !== 'boolean') return false;
        await host.extensions.setStoreEnabled(id, args[1]);
        return true;
      }
      case 'uninstall':
        return uninstall(event, args[0], args[1]);
      default:
        return null;
    }
  });
}
