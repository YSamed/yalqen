import fs from 'node:fs';
import path from 'node:path';
import { nativeImage, net, type MenuItemConstructorOptions, type NativeImage, type Session } from 'electron';
import { t } from '../../shared/i18n.js';
import type { ExtensionInfo, ExtensionSiteAccess } from '../../shared/types.js';
import { extensionSite, parseExtensionAccess } from '../../shared/extension-sites.js';
import {
  extensionIdentity,
  prepareRestrictedExtension,
  restrictedManifest,
  runtimeExtensionPath,
} from './extension-access.js';
import {
  actionTitle,
  extensionPage,
  iconFile,
  manifestText,
  optionsPage,
  parseMessages,
  popupPage,
  resolveInside,
  withManifestKey,
  sanitizeSavedExtensions,
  type Manifest,
  type Messages,
  type SavedExtension,
} from './extension-manifest.js';
import { downloadCrx, parseStoreId } from './chrome-web-store.js';
import { JsonFile } from '../storage/json-file.js';
import { extractZip } from './zip.js';
import {
  addedPermissions,
  EXTENSION_FIRST_CHECK_MS,
  EXTENSION_CHECK_INTERVAL_MS,
  parseStoreUpdate,
  readUpdateManifest,
  updateManifestUrl,
} from './extension-updates.js';

const MENU_ICON_SIZE = 16;
const LIST_ICON_SIZE = 64;
const STORE_DIRECTORY = 'store-extensions';

type StoreExtensionStatus = 'available' | 'installing' | 'installed';

interface ExtensionUpdateOptions {
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  automatic?: () => boolean;
}
type ConfirmUpdatePermissions = (name: string, permissions: string[]) => Promise<boolean>;

interface ExtensionAction {
  path?: string;
  requestAccess?: boolean;
  title: string;
  icon: NativeImage | null;
  popupUrl: string | null;
  optionsUrl: string | null;
}

interface ExtensionsMenuHandlers {
  openPopup(url: string): void;
  openOptions(url: string): void;
  openStore(): void;
  manage(): void;
  requestAccess?(directory: string): void;
  canRequestAccess?: boolean;
}

export function extensionsMenuTemplate(
  actions: readonly ExtensionAction[],
  handlers: ExtensionsMenuHandlers,
): MenuItemConstructorOptions[] {
  const items = [...actions]
    .sort((a, b) => a.title.localeCompare(b.title, 'tr'))
    .flatMap((action): MenuItemConstructorOptions[] => [
      {
        label: action.title,
        icon: action.icon ?? undefined,
        enabled: action.popupUrl !== null || action.optionsUrl !== null,
        click: () => {
          if (action.popupUrl) handlers.openPopup(action.popupUrl);
          else if (action.optionsUrl) handlers.openOptions(action.optionsUrl);
        },
      },
      ...(action.requestAccess && action.path && handlers.requestAccess
        ? [
            {
              label: t('extensions.allowCurrentSite', { name: action.title }),
              enabled: handlers.canRequestAccess === true,
              click: () => handlers.requestAccess!(action.path!),
            },
          ]
        : []),
    ]);
  return [
    ...items,
    ...(items.length > 0 ? [{ type: 'separator' as const }] : []),
    { label: t('extensions.openStore'), click: handlers.openStore },
    { label: t('extensions.manage'), click: handlers.manage },
  ];
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

export function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Loading extension at .+? failed with: /s, '');
}

export class ExtensionManager {
  private readonly json: JsonFile;
  private readonly storeRoot: string;
  private readonly runtimeRoot: string;
  private entries: SavedExtension[];
  private readonly ids = new Map<string, string>();
  private readonly errors = new Map<string, string>();
  private readonly installing = new Set<string>();
  private readonly updateErrors = new Map<string, string>();
  private checking: Promise<string | null> | null = null;
  private updateTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly updateRequests = new Set<AbortController>();
  private readonly changingAccess = new Set<string>();
  private readonly sessionSites = new Map<string, Set<string>>();
  private readonly loadingIds = new Set<string>();

  constructor(
    directory: string,
    private readonly browsing: Session,
    private readonly onChange: () => void,
    private readonly updateOptions: ExtensionUpdateOptions = {},
  ) {
    const file = path.join(directory, 'extensions.json');
    this.storeRoot = path.join(directory, STORE_DIRECTORY);
    this.runtimeRoot = path.join(directory, 'extension-runtime');
    this.json = new JsonFile(file, 'extensions');
    this.entries = sanitizeSavedExtensions((readJson(file) as { extensions?: unknown } | null)?.extensions);
    this.recoverUpdates();
  }

  async loadAll(): Promise<void> {
    await Promise.all(this.entries.filter((entry) => entry.enabled).map((entry) => this.load(entry.path)));
  }

  actions(): ExtensionAction[] {
    return this.entries.flatMap((entry) => {
      const extension = this.loadedAt(entry.path);
      if (!extension) return [];
      const manifest = extension.manifest as Manifest;
      return [
        {
          path: entry.path,
          requestAccess: this.accessFor(entry.path).mode === 'click',
          title: actionTitle(manifest, extension.name),
          icon: this.icon(entry.path, manifest, MENU_ICON_SIZE),
          popupUrl: extensionPage(extension.url, popupPage(manifest)),
          optionsUrl: extensionPage(extension.url, optionsPage(manifest)),
        },
      ];
    });
  }

  list(): ExtensionInfo[] {
    return this.entries.map((entry) => {
      const extension = this.loadedAt(entry.path);
      const manifest = (extension?.manifest ?? readJson(path.join(entry.path, 'manifest.json')) ?? {}) as Manifest;
      const messages = this.messages(entry.path, manifest);
      return {
        path: entry.path,
        id: extension?.id ?? null,
        name: extension?.name || manifestText(manifest, 'name', messages) || path.basename(entry.path),
        version: extension?.version ?? manifestText(manifest, 'version', messages),
        description: manifestText(manifest, 'description', messages),
        enabled: entry.enabled,
        error: this.errors.get(entry.path) ?? null,
        icon: this.icon(entry.path, manifest, LIST_ICON_SIZE)?.toDataURL() ?? null,
        hasOptions: extension !== null && optionsPage(manifest) !== null,
        fromStore: this.isStorePath(entry.path),
        updating: this.installing.has(path.basename(entry.path)) || this.changingAccess.has(entry.path),
        updateError: this.updateErrors.get(entry.path) ?? null,
        access: this.accessFor(entry.path),
        sessionSites: [...(this.sessionSites.get(entry.path) ?? [])].sort(),
      };
    });
  }

  optionsUrl(directory: string): string | null {
    const extension = this.loadedAt(directory);
    return extension ? extensionPage(extension.url, optionsPage(extension.manifest as Manifest)) : null;
  }

  async install(chosen: string): Promise<string | null> {
    let directory: string;
    try {
      directory = fs.realpathSync(chosen);
    } catch (error) {
      return errorMessage(error);
    }
    if (this.changingAccess.has(directory)) return t('extensions.accessBusy');
    this.unload(directory);
    const error = await this.load(directory);
    const saved = this.entries.find((entry) => entry.path === directory);
    if (error && !saved) {
      this.errors.delete(directory);
      return error;
    }
    if (saved) saved.enabled = true;
    else this.entries.push({ path: directory, enabled: true });
    this.changed();
    return error;
  }

  storeStatus(id: string): StoreExtensionStatus {
    if (this.installing.has(id)) return 'installing';
    return this.storeEntry(id) ? 'installed' : 'available';
  }

  storeEnabled(id: string): boolean {
    return this.storeEntry(id)?.enabled ?? false;
  }

  storeExtensions(): { id: string; extension: Electron.Extension }[] {
    return this.entries.flatMap((entry) => {
      const extension = this.isStorePath(entry.path) ? this.loadedAt(entry.path) : null;
      return extension ? [{ id: path.basename(entry.path), extension }] : [];
    });
  }

  async setStoreEnabled(id: string, enabled: boolean): Promise<void> {
    const entry = this.storeEntry(id);
    if (entry) await this.setEnabled(entry.path, enabled);
  }

  removeStore(id: string): void {
    const entry = this.storeEntry(id);
    if (entry) this.remove(entry.path);
  }

  async installFromStore(input: string): Promise<string | null> {
    const id = parseStoreId(input);
    if (!id) return t('extensions.invalidStoreId');
    if (this.installing.has(id)) return null;
    this.installing.add(id);
    this.onChange();
    try {
      return await this.downloadAndInstall(id);
    } finally {
      this.installing.delete(id);
      this.onChange();
    }
  }

  private async downloadAndInstall(id: string): Promise<string | null> {
    try {
      const { zip, key } = await downloadCrx(id, (url, init) => net.fetch(url, init), process.versions.chrome);
      fs.mkdirSync(this.storeRoot, { recursive: true });
      const target = path.join(fs.realpathSync(this.storeRoot), id);
      const staging = `${target}.tmp`;
      fs.rmSync(staging, { recursive: true, force: true });
      try {
        extractZip(zip, staging);
        if (key) this.pinExtensionId(staging, key);
        this.unload(target);
        fs.rmSync(target, { recursive: true, force: true });
        fs.renameSync(staging, target);
      } finally {
        fs.rmSync(staging, { recursive: true, force: true });
      }
      const known = this.entries.some((entry) => entry.path === target);
      const error = await this.install(target);
      if (error && !known) fs.rmSync(target, { recursive: true, force: true });
      return error;
    } catch (error) {
      return errorMessage(error);
    }
  }

  remove(directory: string): void {
    if (
      this.changingAccess.has(directory) ||
      this.installing.has(path.basename(directory)) ||
      !this.entries.some((entry) => entry.path === directory)
    )
      return;
    this.unload(directory);
    this.errors.delete(directory);
    this.updateErrors.delete(directory);
    this.entries = this.entries.filter((entry) => entry.path !== directory);
    this.deleteStoreFiles(directory);
    this.sessionSites.delete(directory);
    fs.rmSync(runtimeExtensionPath(this.runtimeRoot, directory), { recursive: true, force: true });
    this.changed();
  }

  async setEnabled(directory: string, enabled: boolean): Promise<void> {
    const entry = this.entries.find((item) => item.path === directory);
    if (
      !entry ||
      entry.enabled === enabled ||
      this.changingAccess.has(directory) ||
      this.installing.has(path.basename(directory))
    )
      return;
    entry.enabled = enabled;
    if (enabled) {
      await this.load(directory);
    } else {
      this.unload(directory);
      this.errors.delete(directory);
    }
    this.changed();
  }

  accessFor(directory: string): ExtensionSiteAccess {
    const access = this.entries.find((entry) => entry.path === directory)?.access ?? {
      mode: 'all' as const,
      sites: [],
    };
    return { mode: access.mode, sites: [...access.sites] };
  }

  hasEntry(directory: string): boolean {
    return this.entries.some((entry) => entry.path === directory);
  }

  accessWillChange(directory: string, access: ExtensionSiteAccess): boolean {
    return (
      JSON.stringify(this.accessFor(directory)) !== JSON.stringify(access) || !!this.sessionSites.get(directory)?.size
    );
  }

  async setAccess(directory: string, value: unknown): Promise<string | null> {
    const access = parseExtensionAccess(value);
    if (!access) return t('extensions.accessInvalid');
    return this.changeAccess(directory, (entry) => {
      entry.access = access;
      this.sessionSites.delete(directory);
    });
  }

  async grantSite(directory: string, url: string): Promise<string | null> {
    const site = extensionSite(url);
    if (!site || this.accessFor(directory).mode !== 'click') return t('extensions.accessInvalid');
    return this.changeAccess(directory, () => {
      const sites = this.sessionSites.get(directory) ?? new Set<string>();
      if (sites.size >= 100 && !sites.has(site)) throw new Error(t('extensions.accessInvalid'));
      sites.add(site);
      this.sessionSites.set(directory, sites);
    });
  }

  private async changeAccess(directory: string, change: (entry: SavedExtension) => void): Promise<string | null> {
    const entry = this.entries.find((item) => item.path === directory);
    if (!entry) return t('extensions.accessInvalid');
    if (this.changingAccess.has(directory) || this.installing.has(path.basename(directory)))
      return t('extensions.accessBusy');
    this.changingAccess.add(directory);
    this.onChange();
    try {
      change(entry);
      this.unload(directory);
      if (entry.enabled) {
        const error = await this.load(directory);
        if (error) {
          entry.enabled = false;
          return error;
        }
      }
      return null;
    } catch (error) {
      return errorMessage(error);
    } finally {
      this.changingAccess.delete(directory);
      this.changed();
      this.saveNow();
    }
  }

  scheduleUpdates(): void {
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = null;
    if (!this.stopped && (this.updateOptions.automatic?.() ?? true)) this.checkAfter(EXTENSION_FIRST_CHECK_MS);
  }

  stopUpdates(): void {
    this.stopped = true;
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = null;
    for (const controller of this.updateRequests) controller.abort();
  }

  checkForUpdates(confirm?: ConfirmUpdatePermissions): Promise<string | null> {
    if (this.checking) return this.checking;
    if (this.stopped) return Promise.resolve(null);
    this.checking = this.updateAll(confirm).finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private checkAfter(delay: number): void {
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      void this.checkForUpdates().finally(() => {
        if (!this.stopped && !this.updateTimer && (this.updateOptions.automatic?.() ?? true))
          this.checkAfter(EXTENSION_CHECK_INTERVAL_MS);
      });
    }, delay);
    this.updateTimer.unref();
  }

  private async updateAll(confirm?: ConfirmUpdatePermissions): Promise<string | null> {
    let firstError: string | null = null;
    for (const entry of [...this.entries]) {
      if (this.stopped) break;
      const id = path.basename(entry.path);
      if (!this.isStorePath(entry.path) || this.installing.has(id) || this.changingAccess.has(entry.path)) continue;
      this.installing.add(id);
      this.updateErrors.delete(entry.path);
      this.onChange();
      try {
        const error = await this.updateStoreEntry(entry, id, confirm);
        if (error) {
          this.updateErrors.set(entry.path, error);
          firstError ??= error;
        }
      } catch (error) {
        const message = errorMessage(error);
        this.updateErrors.set(entry.path, message);
        firstError ??= message;
      } finally {
        this.installing.delete(id);
        this.onChange();
      }
    }
    return firstError;
  }

  private async updateStoreEntry(
    entry: SavedExtension,
    id: string,
    confirm?: ConfirmUpdatePermissions,
  ): Promise<string | null> {
    const controller = new AbortController();
    this.updateRequests.add(controller);
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const staging = `${entry.path}.update`;
    const backup = `${entry.path}.previous`;
    const fetchFile = this.updateOptions.fetch ?? ((url: string, init: RequestInit) => net.fetch(url, init));
    let swapping = false;
    try {
      const previous = readJson(path.join(entry.path, 'manifest.json')) as Manifest | null;
      if (!previous || typeof previous.version !== 'string') throw new Error(t('extensions.updatePackageMismatch'));
      const response = await fetchFile(updateManifestUrl(id, previous.version, process.versions.chrome), {
        credentials: 'omit',
        signal: controller.signal,
      });
      const update = parseStoreUpdate(await readUpdateManifest(response), id, previous.version);
      if (!update) return null;
      const { zip, key } = await downloadCrx(id, fetchFile, process.versions.chrome, {
        ...update,
        signal: controller.signal,
      });
      if (!key) throw new Error(t('extensions.updatePackageMismatch'));
      fs.rmSync(staging, { recursive: true, force: true });
      extractZip(zip, staging);
      const manifest = readJson(path.join(staging, 'manifest.json')) as Manifest | null;
      if (
        !manifest ||
        manifest.version !== update.version ||
        typeof manifest.manifest_version !== 'number' ||
        manifest.manifest_version < 3
      )
        throw new Error(t('extensions.updatePackageMismatch'));
      // The downloaded CRX's verified store identity overrides any declared manifest key.
      fs.writeFileSync(path.join(staging, 'manifest.json'), JSON.stringify({ ...manifest, key }, null, 2));
      clearTimeout(timeout);
      const permissions = addedPermissions(previous, manifest);
      if (permissions.length > 0 && (!confirm || !(await confirm(String(previous.name ?? id), permissions))))
        return t('extensions.updateNeedsPermission');
      if (
        this.stopped ||
        controller.signal.aborted ||
        !this.entries.includes(entry) ||
        (!confirm && !(this.updateOptions.automatic?.() ?? true))
      )
        return null;
      swapping = true;
      this.unload(entry.path);
      fs.renameSync(entry.path, backup);
      fs.renameSync(staging, entry.path);
      if (entry.enabled) {
        const error = await this.load(entry.path);
        if (error) throw new Error(error);
        if (this.loadedAt(entry.path)?.id !== id) throw new Error(t('extensions.updatePackageMismatch'));
      }
      fs.rmSync(backup, { recursive: true, force: true });
      return null;
    } catch (error) {
      if (swapping) {
        this.unload(entry.path);
        if (fs.existsSync(backup)) {
          fs.rmSync(entry.path, { recursive: true, force: true });
          fs.renameSync(backup, entry.path);
        }
        if (entry.enabled) await this.load(entry.path);
      }
      return errorMessage(error);
    } finally {
      clearTimeout(timeout);
      this.updateRequests.delete(controller);
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }

  private recoverUpdates(): void {
    for (const entry of this.entries) {
      if (!this.isStorePath(entry.path)) continue;
      const backup = `${entry.path}.previous`;
      if (fs.existsSync(backup)) {
        // A remaining backup means validation never committed, including after a crash.
        fs.rmSync(entry.path, { recursive: true, force: true });
        fs.renameSync(backup, entry.path);
      }
      fs.rmSync(`${entry.path}.update`, { recursive: true, force: true });
    }
  }

  saveNow(): void {
    this.json.flush();
  }

  private async load(directory: string): Promise<string | null> {
    let reserved: string | null = null;
    try {
      const manifest = readJson(path.join(directory, 'manifest.json')) as Manifest | null;
      if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
        throw new Error(t('extensions.accessPackageFailed'));
      const identity = extensionIdentity(directory, manifest);
      if (
        this.loadingIds.has(identity.id) ||
        [...this.ids].some(([other, id]) => other !== directory && id === identity.id)
      )
        throw new Error(t('extensions.accessDuplicate'));
      reserved = identity.id;
      this.loadingIds.add(reserved);
      const access = this.accessFor(directory);
      const source =
        access.mode === 'all'
          ? directory
          : prepareRestrictedExtension(this.runtimeRoot, directory, {
              ...restrictedManifest(manifest, access, [...(this.sessionSites.get(directory) ?? [])]),
              key: identity.key,
            });
      const extension = await this.browsing.extensions.loadExtension(source);
      if (extension.id !== identity.id) {
        this.browsing.extensions.removeExtension(extension.id);
        throw new Error(t('extensions.accessPackageFailed'));
      }
      this.ids.set(directory, extension.id);
      this.errors.delete(directory);
      return null;
    } catch (error) {
      const message = errorMessage(error);
      this.errors.set(directory, message);
      console.warn(`[extensions] could not load ${directory}:`, message);
      return message;
    } finally {
      if (reserved) this.loadingIds.delete(reserved);
    }
  }

  private pinExtensionId(directory: string, key: string): void {
    const file = path.join(directory, 'manifest.json');
    const pinned = withManifestKey(fs.readFileSync(file, 'utf8'), key);
    if (pinned) fs.writeFileSync(file, pinned);
  }

  private isStorePath(directory: string): boolean {
    let root = path.resolve(this.storeRoot);
    try {
      root = fs.realpathSync(root);
    } catch {}
    let parent = path.dirname(directory);
    try {
      parent = fs.realpathSync(parent);
    } catch {}
    return parent === root && parseStoreId(path.basename(directory)) !== null;
  }

  private storeEntry(id: string): SavedExtension | undefined {
    return this.entries.find((entry) => path.basename(entry.path) === id && this.isStorePath(entry.path));
  }

  private deleteStoreFiles(directory: string): void {
    try {
      if (path.dirname(directory) === fs.realpathSync(this.storeRoot)) {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    } catch {
      return;
    }
  }

  private unload(directory: string): void {
    const id = this.ids.get(directory);
    if (!id) return;
    this.ids.delete(directory);
    if (this.browsing.extensions.getExtension(id)) this.browsing.extensions.removeExtension(id);
  }

  private loadedAt(directory: string): Electron.Extension | null {
    const id = this.ids.get(directory);
    return id ? this.browsing.extensions.getExtension(id) : null;
  }

  private messages(directory: string, manifest: Manifest): Messages {
    const locale = typeof manifest.default_locale === 'string' ? manifest.default_locale : null;
    const file = locale ? resolveInside(directory, path.join('_locales', locale, 'messages.json')) : null;
    return file ? parseMessages(readJson(file)) : {};
  }

  private icon(directory: string, manifest: Manifest, size: number): NativeImage | null {
    const relative = iconFile(manifest, size);
    const file = relative ? resolveInside(directory, relative) : null;
    if (!file) return null;
    const image = nativeImage.createFromPath(file);
    return image.isEmpty() ? null : image.resize({ width: size, height: size, quality: 'best' });
  }

  private changed(): void {
    this.json.schedule(() => ({ version: 1, extensions: this.entries }));
    this.onChange();
  }
}
