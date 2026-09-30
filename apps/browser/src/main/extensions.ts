import fs from 'node:fs';
import path from 'node:path';
import { nativeImage, net, type MenuItemConstructorOptions, type NativeImage, type Session } from 'electron';
import type { ExtensionInfo, StoreExtensionStatus } from '../shared/types.js';
import {
  actionTitle,
  extensionPage,
  iconFile,
  manifestText,
  optionsPage,
  parseMessages,
  popupPage,
  resolveInside,
  sanitizeSavedExtensions,
  type Manifest,
  type Messages,
  type SavedExtension,
} from './extension-manifest.js';
import { downloadCrx, parseStoreId } from './chrome-web-store.js';
import { JsonFile } from './json-file.js';
import { extractZip } from './zip.js';

const MENU_ICON_SIZE = 16;
const LIST_ICON_SIZE = 64;
const STORE_DIRECTORY = 'store-extensions';

export interface ExtensionAction {
  title: string;
  icon: NativeImage | null;
  popupUrl: string | null;
  optionsUrl: string | null;
}

export interface ExtensionsMenuHandlers {
  openPopup(url: string): void;
  openOptions(url: string): void;
  openStore(): void;
  manage(): void;
}

export function extensionsMenuTemplate(
  actions: readonly ExtensionAction[],
  handlers: ExtensionsMenuHandlers,
): MenuItemConstructorOptions[] {
  const items = [...actions]
    .sort((a, b) => a.title.localeCompare(b.title, 'tr'))
    .map((action): MenuItemConstructorOptions => ({
      label: action.title,
      icon: action.icon ?? undefined,
      enabled: action.popupUrl !== null || action.optionsUrl !== null,
      click: () => {
        if (action.popupUrl) handlers.openPopup(action.popupUrl);
        else if (action.optionsUrl) handlers.openOptions(action.optionsUrl);
      },
    }));
  return [
    ...items,
    ...(items.length > 0 ? [{ type: 'separator' as const }] : []),
    { label: 'Chrome Web Mağazası’nı aç', click: handlers.openStore },
    { label: 'Uzantıları yönet…', click: handlers.manage },
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
  private entries: SavedExtension[];
  private readonly ids = new Map<string, string>();
  private readonly errors = new Map<string, string>();
  private readonly installing = new Set<string>();

  constructor(
    directory: string,
    private readonly browsing: Session,
    private readonly onChange: () => void,
  ) {
    const file = path.join(directory, 'extensions.json');
    this.storeRoot = path.join(directory, STORE_DIRECTORY);
    this.json = new JsonFile(file, 'extensions');
    this.entries = sanitizeSavedExtensions((readJson(file) as { extensions?: unknown } | null)?.extensions);
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
    const installed = this.entries.some(
      (entry) => path.basename(entry.path) === id && path.basename(path.dirname(entry.path)) === STORE_DIRECTORY,
    );
    return installed ? 'installed' : 'available';
  }

  async installFromStore(input: string): Promise<string | null> {
    const id = parseStoreId(input);
    if (!id) return 'Geçerli bir Chrome Web Mağazası adresi veya uzantı kimliği girin';
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
      const zip = await downloadCrx(id, (url, init) => net.fetch(url, init), process.versions.chrome);
      fs.mkdirSync(this.storeRoot, { recursive: true });
      const target = path.join(fs.realpathSync(this.storeRoot), id);
      const staging = `${target}.tmp`;
      fs.rmSync(staging, { recursive: true, force: true });
      try {
        extractZip(zip, staging);
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
    if (!this.entries.some((entry) => entry.path === directory)) return;
    this.unload(directory);
    this.errors.delete(directory);
    this.entries = this.entries.filter((entry) => entry.path !== directory);
    this.deleteStoreFiles(directory);
    this.changed();
  }

  async setEnabled(directory: string, enabled: boolean): Promise<void> {
    const entry = this.entries.find((item) => item.path === directory);
    if (!entry || entry.enabled === enabled) return;
    entry.enabled = enabled;
    if (enabled) {
      await this.load(directory);
    } else {
      this.unload(directory);
      this.errors.delete(directory);
    }
    this.changed();
  }

  saveNow(): void {
    this.json.flush();
  }

  private async load(directory: string): Promise<string | null> {
    try {
      const extension = await this.browsing.extensions.loadExtension(directory);
      this.ids.set(directory, extension.id);
      this.errors.delete(directory);
      return null;
    } catch (error) {
      const message = errorMessage(error);
      this.errors.set(directory, message);
      console.warn(`[extensions] could not load ${directory}:`, message);
      return message;
    }
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
