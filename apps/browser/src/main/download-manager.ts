import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  dialog,
  shell,
  type BaseWindow,
  type DownloadItem,
  type Event,
  type MessageBoxOptions,
  type Session,
  type WebContents,
} from 'electron';
import { hostOf } from '../shared/hosts.js';
import { ChangeFeed } from './change-feed.js';
import { formatBytes, uniquePath, type DownloadActions, type DownloadEntry, type DownloadStore } from './downloads.js';

const STATE_PUSH_MS = 250;
const PAGE_PUSH_MS = 500;
const ITEM_COMMANDS = new Set<string>(['open', 'show', 'pause', 'resume', 'cancel', 'retry', 'remove']);

export interface DownloadManagerOptions {
  store: DownloadStore;
  daily: Session;
  privateBrowsing: Session;
  developer: Session;
  directory: () => string;
  askBeforeDownload: () => boolean;
  parentOf: (contents: WebContents) => BaseWindow | undefined;
  onStateChange: () => void;
}

export class DownloadManager {
  readonly changes = new ChangeFeed();
  private readonly items = new Map<string, DownloadItem>();
  private readonly reservedPaths = new Set<string>();
  private readonly approvedUrls = new Set<string>();
  private prompts: Promise<unknown> = Promise.resolve();
  private stateTimer: NodeJS.Timeout | null = null;
  private pageTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: DownloadManagerOptions) {
    options.daily.on('will-download', this.onWillDownload(false));
    options.privateBrowsing.on('will-download', this.onWillDownload(true));
    options.developer.on('will-download', this.onWillDownload(true));
  }

  changed(): void {
    this.stateTimer ??= setTimeout(() => {
      this.stateTimer = null;
      this.options.onStateChange();
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
          void shell.openPath(entry.savePath).then((error) => {
            if (error) console.warn(`[downloads] could not open ${entry.filename}: ${error}`);
          });
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
          this.approvedUrls.add(entry.url);
          (entry.private ? this.options.privateBrowsing : this.options.daily).downloadURL(entry.url);
        }),
      remove: (id) =>
        this.withEntry(id, (entry) => {
          if (entry.state !== 'progressing' && entry.state !== 'paused') store.remove(id);
        }),
      showAll,
      openFolder: () => {
        void shell.openPath(this.options.directory()).then((error) => {
          if (error) console.warn(`[downloads] could not open folder: ${error}`);
        });
      },
    };
  }

  runCommand(command: string, params: URLSearchParams): void {
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

  private withEntry(id: string, run: (entry: DownloadEntry) => void): void {
    const entry = this.options.store.get(id);
    if (entry) run(entry);
    this.changed();
  }

  private onWillDownload(isPrivate: boolean) {
    return (_event: Event, item: DownloadItem, contents?: WebContents): void => {
      const savePath = uniquePath(
        this.options.directory(),
        item.getFilename(),
        (file) => this.reservedPaths.has(file) || fs.existsSync(file),
      );
      item.setSavePath(savePath);
      this.reservedPaths.add(savePath);
      const chain = item.getURLChain();
      const retried = chain.some((url) => this.approvedUrls.delete(url));
      if (retried || !this.options.askBeforeDownload()) {
        this.track(item, savePath, isPrivate);
        return;
      }
      item.pause();
      void this.confirm(item, savePath, contents).then((accepted) => {
        if (accepted && item.getState() === 'progressing') {
          this.track(item, savePath, isPrivate);
          item.resume();
          return;
        }
        this.reservedPaths.delete(savePath);
        if (item.getState() === 'progressing') item.cancel();
      });
    };
  }

  private confirm(item: DownloadItem, savePath: string, contents?: WebContents): Promise<boolean> {
    const answer = this.prompts.then(async () => {
      if (item.getState() !== 'progressing') return false;
      const size = item.getTotalBytes() > 0 ? ` · ${formatBytes(item.getTotalBytes())}` : '';
      const options: MessageBoxOptions = {
        type: 'question',
        message: `“${path.basename(savePath)}” indirilsin mi?`,
        detail: `Kaynak: ${hostOf(item.getURL()) ?? item.getURL()}${size}`,
        buttons: ['İndir', 'İptal'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      };
      const parent = contents && this.options.parentOf(contents);
      const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      return response === 0;
    });
    this.prompts = answer.catch(() => {});
    return answer.catch(() => false);
  }

  private track(item: DownloadItem, savePath: string, isPrivate: boolean): void {
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
      this.reservedPaths.delete(savePath);
      store.update(id, {
        state: state === 'completed' ? 'completed' : state === 'cancelled' ? 'cancelled' : 'interrupted',
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
      });
      this.changed();
    });
    this.changed();
  }
}
