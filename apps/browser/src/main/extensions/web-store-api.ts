import { app, ipcMain, net, type BaseWindow, type IpcMainInvokeEvent, type Session, type WebContents } from 'electron';
import { t } from '../../shared/i18n.js';
import {
  WEB_STORE_CALL,
  WEB_STORE_EVENT,
  WEB_STORE_ORIGIN,
  WebStoreInstallStatus,
  WebStoreMv2Status,
  WebStoreResult,
  WebStoreWebGl,
  type WebStoreEventKind,
} from '../../shared/web-store.js';
import { parseStoreId } from './chrome-web-store.js';
import type { ExtensionManager } from './extensions.js';
import type { Manifest } from './extension-manifest.js';
import { permissionLines } from './permission-text.js';
import type { ConfirmRequest } from '../../shared/types.js';

const MIN_MANIFEST_VERSION = 3;
const MAX_NAME_LENGTH = 100;
const REFERRER_CHAIN = 'EgIIAA==';

interface WebStoreHost {
  daily: Session;
  extensions: ExtensionManager;
  parentWindow(contents: WebContents): BaseWindow | null;
  confirm(window: BaseWindow | null, request: ConfirmRequest, returnFocus: WebContents): Promise<boolean>;
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

export function permissionSummary(manifest: Manifest): string[] {
  const contentScriptSites = (Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []).flatMap(
    (script) => strings(record(script).matches),
  );
  return permissionLines([
    ...strings(manifest.permissions),
    ...strings(manifest.host_permissions),
    ...contentScriptSites,
  ]);
}

const ICON_HOSTS = /(^|\.)(googleusercontent\.com|ggpht\.com|gstatic\.com)$/;
const ICON_TYPE = /^image\/(png|jpeg|webp|gif)$/;
const MAX_ICON_BYTES = 256 * 1024;
const ICON_TIMEOUT_MS = 3000;

// The store sends the icon it shows next to "Add to Chrome"; only Google's image hosts or an inline image are taken.
export async function storeIcon(
  raw: unknown,
  fetchImage: (url: string, init: RequestInit) => Promise<Response> = (url, init) => net.fetch(url, init),
): Promise<string | null> {
  if (typeof raw !== 'string') return null;
  const inline = /^data:(image\/[a-z]+);base64,[A-Za-z0-9+/=]+$/.exec(raw);
  if (inline) return ICON_TYPE.test(inline[1]!) && raw.length <= (MAX_ICON_BYTES * 4) / 3 + 64 ? raw : null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !ICON_HOSTS.test(url.hostname)) return null;
  try {
    const response = await fetchImage(url.href, { signal: AbortSignal.timeout(ICON_TIMEOUT_MS) });
    const type = (response.headers.get('content-type') ?? '').split(';')[0]!.trim();
    if (!response.ok || !ICON_TYPE.test(type)) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length <= MAX_ICON_BYTES ? `data:${type};base64,${bytes.toString('base64')}` : null;
  } catch {
    return null;
  }
}

export function installPrompt(
  details: Record<string, unknown>,
  manifest: Manifest,
  id: string,
): { name: string; message: string; items: string[] } {
  const candidate = [details.localizedName, manifest.name].find(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );
  const name = (candidate ?? id).trim().slice(0, MAX_NAME_LENGTH);
  const items = permissionSummary(manifest);
  return { name, message: t(items.length > 0 ? 'webStoreApi.canDo' : 'webStoreApi.noPermissions'), items };
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

  const ask = (sender: WebContents, request: ConfirmRequest) =>
    host.confirm(host.parentWindow(sender), request, sender);

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

    const { name, message, items } = installPrompt(details, manifest, id);
    const image = await storeIcon(details.iconUrl);
    const confirmed = await ask(event.sender, {
      icon: 'extensions',
      ...(image ? { image } : {}),
      title: t('webStoreApi.addPrompt', { name }),
      message,
      items,
      confirmLabel: t('webStoreApi.addButton'),
      cancelLabel: t('webStoreApi.cancel'),
    });
    if (!confirmed) return { result: WebStoreResult.USER_CANCELLED };

    const error = await host.extensions.installFromStore(id);
    if (error) return { result: WebStoreResult.INSTALL_ERROR, message: error };
    emit(event, 'installed', installedInfo(id));
    return { result: WebStoreResult.SUCCESS };
  };

  const uninstall = async (event: IpcMainInvokeEvent, idInput: unknown, optionsInput: unknown): Promise<string> => {
    const id = storeId(idInput);
    if (!id || host.extensions.storeStatus(id) !== 'installed') return WebStoreResult.UNKNOWN_ERROR;
    if (record(optionsInput).showConfirmDialog === true) {
      const confirmed = await ask(event.sender, {
        icon: 'trash',
        title: t('webStoreApi.removePrompt'),
        message: t('webStoreApi.removeDetail'),
        items: [],
        confirmLabel: t('webStoreApi.remove'),
        cancelLabel: t('webStoreApi.cancel'),
        danger: true,
      });
      if (!confirmed) return WebStoreResult.USER_CANCELLED;
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
