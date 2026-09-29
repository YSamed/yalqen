import type { AppUpdater } from 'electron-updater';
import type { UpdateStatus } from '../shared/types.js';

export const FIRST_CHECK_DELAY_MS = 30_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdaterBackend = Pick<
  AppUpdater,
  'autoDownload' | 'autoInstallOnAppQuit' | 'logger' | 'on' | 'checkForUpdates' | 'quitAndInstall'
>;

export interface UpdaterOptions {
  load: (() => UpdaterBackend) | null;
  automatic(): boolean;
  onChange(): void;
  beforeInstall(): void;
}

// electron-updater loads every platform's updater up front, so it is only required once the first check runs.
export function loadAutoUpdater(): UpdaterBackend {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- deferred to keep it off the startup path
  return (require('electron-updater') as { autoUpdater: AppUpdater }).autoUpdater;
}

export class Updater {
  private current: UpdateStatus;
  private backend: UpdaterBackend | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly options: UpdaterOptions) {
    this.current = options.load ? { state: 'idle' } : { state: 'unavailable' };
    this.schedule();
  }

  status(): UpdateStatus {
    return this.current;
  }

  readyVersion(): string | null {
    return this.current.state === 'ready' ? this.current.version : null;
  }

  check(): void {
    const { state } = this.current;
    if (state === 'unavailable' || state === 'checking' || state === 'downloading' || state === 'ready') return;
    const backend = this.connect();
    void backend
      .checkForUpdates()
      .then((result) => result?.downloadPromise?.catch(() => {}))
      .catch(() => {});
  }

  install(): void {
    if (!this.backend || this.current.state !== 'ready') return;
    this.options.beforeInstall();
    this.backend.quitAndInstall();
  }

  schedule(): void {
    this.stop();
    if (this.options.load && this.options.automatic()) this.checkAfter(FIRST_CHECK_DELAY_MS);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private checkAfter(delay: number): void {
    this.timer = setTimeout(() => {
      this.check();
      this.checkAfter(CHECK_INTERVAL_MS);
    }, delay);
  }

  private connect(): UpdaterBackend {
    if (this.backend) return this.backend;
    const backend = this.options.load!();
    backend.autoDownload = true;
    backend.autoInstallOnAppQuit = true;
    backend.logger = null;
    backend.on('checking-for-update', () => this.set({ state: 'checking' }));
    backend.on('update-not-available', () => this.set({ state: 'up-to-date' }));
    backend.on('update-available', (info) => this.set({ state: 'downloading', version: info.version, percent: 0 }));
    backend.on('download-progress', (progress) => {
      if (this.current.state === 'downloading') this.set({ ...this.current, percent: Math.floor(progress.percent) });
    });
    backend.on('update-downloaded', (info) => this.set({ state: 'ready', version: info.version }));
    backend.on('error', (error) => {
      console.warn('[updater]', error.message);
      this.set({ state: 'failed' });
    });
    this.backend = backend;
    return backend;
  }

  private set(next: UpdateStatus): void {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.current = next;
    this.options.onChange();
  }
}
