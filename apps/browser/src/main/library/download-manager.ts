import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  app,
  dialog,
  shell,
  type BaseWindow,
  type DownloadItem,
  type Event,
  type MessageBoxOptions,
  type SaveDialogOptions,
  type Session,
  type WebContents,
} from 'electron';
import { hostOf } from '../../shared/hosts.js';
import { ChangeFeed } from './change-feed.js';
import { formatBytes, uniquePath, type DownloadActions, type DownloadEntry, type DownloadStore } from './downloads.js';
import { t } from '../../shared/i18n.js';

const STATE_PUSH_MS = 250;
const PAGE_PUSH_MS = 500;
const DOWNLOAD_START_TIMEOUT_MS = 30_000;
const ITEM_COMMANDS = new Set<string>(['open', 'show', 'pause', 'resume', 'cancel', 'retry', 'remove']);

interface DownloadManagerOptions {
  store: DownloadStore;
  daily: Session;
  privateBrowsing: Session;
  developer: Session;
  directory: () => string;
  askBeforeDownload: () => boolean;
  parentOf: (contents: WebContents) => BaseWindow | undefined;
  onStateChange: () => void;
  checkFile?: (file: string) => Promise<string | null>;
}

export class DownloadManager {
  onChange: (() => void) | null = null;
  readonly changes = new ChangeFeed();
  private readonly items = new Map<string, DownloadItem>();
  private readonly reservedPaths = new Set<string>();
  private readonly approvedUrls = new Map<string, string>();
  private readonly waiters = new Map<string, (id: string | null) => void>();
  private readonly suggestedNames = new Map<string, string>();
  private prompts: Promise<unknown> = Promise.resolve();
  private stateTimer: NodeJS.Timeout | null = null;
  private pageTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: DownloadManagerOptions,
    private readonly dialogs: Pick<typeof dialog, 'showMessageBox' | 'showSaveDialog'> = dialog,
  ) {
    this.watch(options.daily, false);
    this.watch(options.privateBrowsing, true);
    this.watch(options.developer, true);
  }

  watch(browsing: Session, isPrivate: boolean): void {
    browsing.on('will-download', this.onWillDownload(isPrivate));
  }

  changed(): void {
    this.stateTimer ??= setTimeout(() => {
      this.stateTimer = null;
      this.options.onStateChange();
      this.onChange?.();
    }, STATE_PUSH_MS);
    this.pageTimer ??= setTimeout(() => {
      this.pageTimer = null;
      this.changes.notify();
    }, PAGE_PUSH_MS);
  }

  actions(showAll: () => void): DownloadActions {
    const { store } = this.options;
    return {
      open: (id) =>
        this.withEntry(id, (entry) => {
          if (entry.state !== 'completed') return;
          void this.openChecked(entry);
        }),
      show: (id) => this.withEntry(id, (entry) => shell.showItemInFolder(entry.savePath)),
      pause: (id) =>
        this.withEntry(id, () => {
          const item = this.items.get(id);
          item?.pause();
          if (item?.isPaused()) store.update(id, { state: 'paused' });
        }),
      resume: (id) =>
        this.withEntry(id, () => {
          const item = this.items.get(id);
          if (!item?.canResume()) return;
          item.resume();
          store.update(id, { state: 'progressing' });
        }),
      cancel: (id) => this.withEntry(id, () => this.items.get(id)?.cancel()),
      retry: (id) =>
        this.withEntry(id, (entry) => {
          if (entry.state !== 'cancelled' && entry.state !== 'interrupted') return;
          const item = this.items.get(id);
          if (item?.canResume()) {
            item.resume();
            return;
          }
          store.remove(id);
          this.approvedUrls.set(entry.url, entry.savePath);
          (entry.private ? this.options.privateBrowsing : this.options.daily).downloadURL(entry.url);
        }),
      remove: (id) =>
        this.withEntry(id, (entry) => {
          if (entry.state !== 'progressing' && entry.state !== 'paused' && entry.state !== 'checking') store.remove(id);
        }),
      showAll,
      openFolder: () => {
        void shell.openPath(this.options.directory()).then((error) => {
          if (error) console.warn(`[downloads] could not open folder: ${error}`);
        });
      },
    };
  }

  // Extension downloads still follow the ask-before-download setting; a filename only names the file.
  download(url: string, filename: string | null, headers?: Record<string, string>): Promise<string | null> {
    return new Promise((resolve) => {
      this.waiters.get(url)?.(null);
      const timer = setTimeout(() => {
        if (this.waiters.get(url) !== settle) return;
        this.waiters.delete(url);
        this.suggestedNames.delete(url);
        resolve(null);
      }, DOWNLOAD_START_TIMEOUT_MS);
      const settle = (id: string | null) => {
        clearTimeout(timer);
        resolve(id);
      };
      this.waiters.set(url, settle);
      if (filename) this.suggestedNames.set(url, path.basename(filename));
      this.options.daily.downloadURL(url, headers ? { headers } : undefined);
    });
  }

  runCommand(command: string, params: URLSearchParams, contents?: WebContents): void {
    if (command === 'drag') {
      if (contents) void this.dragFile(params.get('id') ?? '', contents);
      return;
    }
    if (command === 'clear') {
      this.options.store.clearFinished();
      this.changed();
      return;
    }
    if (!ITEM_COMMANDS.has(command)) return;
    const actions = this.actions(() => {});
    (actions[command as keyof DownloadActions] as (id: string) => void)(params.get('id') ?? '');
  }

  destroy(): void {
    if (this.stateTimer) clearTimeout(this.stateTimer);
    if (this.pageTimer) clearTimeout(this.pageTimer);
    this.stateTimer = null;
    this.pageTimer = null;
  }

  private async dragFile(id: string, contents: WebContents): Promise<void> {
    const entry = this.options.store.get(id);
    if (entry?.state !== 'completed' || !fs.existsSync(entry.savePath)) return;
    const icon = await app.getFileIcon(entry.savePath, { size: 'normal' });
    if (!contents.isDestroyed()) contents.startDrag({ file: entry.savePath, icon });
  }

  private withEntry(id: string, run: (entry: DownloadEntry) => void): void {
    const entry = this.options.store.get(id);
    if (entry) run(entry);
    this.changed();
  }

  private async openChecked(entry: DownloadEntry): Promise<void> {
    if (this.options.checkFile && !(await this.checkCompleted(entry.id, entry.savePath))) return;
    if (this.options.store.get(entry.id)?.state !== 'completed') return;
    const error = await shell.openPath(entry.savePath);
    if (error) console.warn(`[downloads] could not open ${entry.filename}: ${error}`);
  }

  private async checkCompleted(id: string, file: string): Promise<boolean> {
    this.options.store.update(id, { state: 'checking' });
    this.changed();
    try {
      const source = await this.options.checkFile!(file);
      this.options.store.update(id, { state: source ? 'blocked' : 'completed' });
      if (source) {
        await this.dialogs.showMessageBox({
          type: 'warning',
          message: t('threats.blockedFile'),
          detail: t('threats.fileMessage', { name: path.basename(file), source }),
          buttons: [t('downloadManager.cancel')],
          defaultId: 0,
          cancelId: 0,
        });
      }
      return !source;
    } catch (error) {
      console.warn('[downloads] file check failed:', error);
      this.options.store.update(id, { state: 'interrupted' });
      return false;
    } finally {
      this.changed();
    }
  }

  private onWillDownload(isPrivate: boolean) {
    return (_event: Event, item: DownloadItem, contents?: WebContents): void => {
      const chain = item.getURLChain();
      const retryUrl = chain.find((url) => this.approvedUrls.has(url));
      const retryPath = retryUrl ? this.approvedUrls.get(retryUrl) : undefined;
      if (retryUrl) this.approvedUrls.delete(retryUrl);
      const waited = isPrivate ? undefined : chain.find((url) => this.waiters.has(url));
      const waiter = waited ? this.waiters.get(waited) : undefined;
      if (waited) this.waiters.delete(waited);
      const named = isPrivate ? undefined : chain.find((url) => this.suggestedNames.has(url));
      const suggested = named ? this.suggestedNames.get(named) : undefined;
      if (named) this.suggestedNames.delete(named);
      const savePath = uniquePath(
        retryPath ? path.dirname(retryPath) : this.options.directory(),
        retryPath ? path.basename(retryPath) : (suggested ?? item.getFilename()),
        (file) => this.reservedPaths.has(file) || fs.existsSync(file),
      );
      item.setSavePath(savePath);
      this.reservedPaths.add(savePath);
      if (retryPath || !this.options.askBeforeDownload()) {
        const id = this.track(item, savePath, isPrivate);
        waiter?.(id);
        return;
      }
      item.pause();
      void this.confirm(item, savePath, contents).then((chosen) => {
        this.reservedPaths.delete(savePath);
        if (chosen && item.getState() === 'progressing') {
          item.setSavePath(chosen);
          this.reservedPaths.add(chosen);
          const id = this.track(item, chosen, isPrivate);
          waiter?.(id);
          item.resume();
          return;
        }
        waiter?.(null);
        if (chosen) this.reservedPaths.delete(chosen);
        if (item.getState() === 'progressing') item.cancel();
      });
    };
  }

  private confirm(item: DownloadItem, savePath: string, contents?: WebContents): Promise<string | null> {
    const answer = this.prompts.then(async () => {
      if (item.getState() !== 'progressing') return null;
      const size = item.getTotalBytes() > 0 ? ` · ${formatBytes(item.getTotalBytes())}` : '';
      const parent = contents && this.options.parentOf(contents);
      const detail = t('downloadManager.source', { source: hostOf(item.getURL()) ?? item.getURL(), size });
      const options: MessageBoxOptions = {
        type: 'question',
        message: t('downloadManager.confirm', { name: path.basename(savePath) }),
        detail,
        buttons: [t('downloadManager.download'), t('downloadManager.saveAs'), t('downloadManager.cancel')],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      };
      const { response } = parent
        ? await this.dialogs.showMessageBox(parent, options)
        : await this.dialogs.showMessageBox(options);
      if (response === 0) return savePath;
      return response === 1 ? this.choosePath(item, savePath, detail, parent) : null;
    });
    this.prompts = answer.catch(() => {});
    return answer.catch(() => null);
  }

  private async choosePath(
    item: DownloadItem,
    savePath: string,
    detail: string,
    parent?: BaseWindow,
  ): Promise<string | null> {
    const options: SaveDialogOptions = {
      title: t('downloadManager.saveTitle'),
      defaultPath: savePath,
      message: detail,
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    };
    while (item.getState() === 'progressing') {
      const { canceled, filePath } = parent
        ? await this.dialogs.showSaveDialog(parent, options)
        : await this.dialogs.showSaveDialog(options);
      if (canceled || !filePath) return null;
      if (filePath === savePath || !this.reservedPaths.has(filePath)) {
        this.reservedPaths.add(filePath);
        return filePath;
      }
      const warning: MessageBoxOptions = {
        type: 'warning',
        message: t('downloadManager.pathBusy'),
        buttons: [t('downloadManager.saveAs'), t('downloadManager.cancel')],
        cancelId: 1,
      };
      const { response } = parent
        ? await this.dialogs.showMessageBox(parent, warning)
        : await this.dialogs.showMessageBox(warning);
      if (response !== 0) return null;
    }
    return null;
  }

  private track(item: DownloadItem, savePath: string, isPrivate: boolean): string {
    const { store } = this.options;
    const id = randomUUID();
    this.items.set(id, item);
    store.add({
      id,
      url: item.getURL(),
      filename: path.basename(savePath),
      savePath,
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      startedAt: Date.now(),
      ...(isPrivate ? { private: true } : {}),
    });
    item.on('updated', (_updated, state) => {
      store.update(id, {
        state: state === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : 'progressing',
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
      });
      this.changed();
    });
    item.once('done', (_done, state) => {
      this.items.delete(id);
      if (state !== 'completed' || !this.options.checkFile) this.reservedPaths.delete(savePath);
      store.update(id, {
        state:
          state === 'completed'
            ? this.options.checkFile
              ? 'checking'
              : 'completed'
            : state === 'cancelled'
              ? 'cancelled'
              : 'interrupted',
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
      });
      if (state === 'completed' && this.options.checkFile)
        void this.checkCompleted(id, savePath).finally(() => this.reservedPaths.delete(savePath));
      this.changed();
    });
    this.changed();
    return id;
  }
}
