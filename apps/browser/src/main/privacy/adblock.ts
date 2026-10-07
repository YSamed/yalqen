import type { ElectronBlocker } from '@ghostery/adblocker-electron';
import { ipcMain, powerMonitor, type Session } from 'electron';
import { applyAdBlockExceptions } from './adblock-exceptions.js';

const CACHE_REFRESH_DELAY_MS = 30_000;
const MIN_IDLE_SECONDS = 10;
const COSMETIC_FILTERS_CHANNEL = '@ghostery/adblocker/inject-cosmetic-filters';
const MUTATION_OBSERVER_CHANNEL = '@ghostery/adblocker/is-mutation-observer-enabled';

// Keep Ghostery's module graph out of disabled startup. A synchronous require starts enabled
// loading before the first cache I/O await, preserving the existing initialization order.
function engineModule(): typeof import('./adblock-engine.js') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- load only when blocking is requested
  return require('./adblock-engine.js') as typeof import('./adblock-engine.js');
}

export class AdBlocker {
  private blocker: ElectronBlocker | null = null;
  private loading: Promise<void> | null = null;
  private refreshTimer: NodeJS.Timeout | null = null;
  private refreshing = false;
  private stale = false;
  private wanted = false;
  private destroyed = false;

  constructor(
    private readonly sessions: readonly Session[],
    private readonly cacheFile: string,
    private readonly allowed: (session: Session, url: string) => boolean = () => false,
  ) {}

  setEnabled(enabled: boolean): void {
    if (this.destroyed) return;
    this.wanted = enabled;
    if (!enabled && this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.blocker) this.apply(this.blocker);
    else if (enabled) this.loading ??= this.load();
    if (enabled && this.stale) this.scheduleRefresh();
  }

  whenReady(): Promise<void> {
    return this.loading ?? Promise.resolve();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }

  private async load(): Promise<void> {
    try {
      const { blocker, stale } = await loadEngine(this.cacheFile);
      if (this.destroyed) return;
      applyAdBlockExceptions(blocker, this.allowed);
      this.blocker = blocker;
      this.stale = stale;
      this.apply(this.blocker);
      if (this.wanted && stale) this.scheduleRefresh();
    } catch (error) {
      console.warn('[adblock] filters could not be loaded:', error);
    } finally {
      this.loading = null;
    }
  }

  private scheduleRefresh(): void {
    if (this.refreshTimer || this.refreshing || this.destroyed) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null;
      if (!this.wanted || this.destroyed) return;
      if (powerMonitor.getSystemIdleTime() < MIN_IDLE_SECONDS) {
        this.scheduleRefresh();
        return;
      }
      void this.refresh();
    }, CACHE_REFRESH_DELAY_MS);
  }

  private async refresh(): Promise<void> {
    this.refreshing = true;
    try {
      const next = await engineModule().fetchEngine(this.cacheFile);
      if (this.destroyed) return;
      for (const session of this.sessions) {
        if (this.blocker?.isBlockingEnabled(session)) this.blocker.disableBlockingInSession(session);
      }
      applyAdBlockExceptions(next, this.allowed);
      this.blocker = next;
      this.stale = false;
      this.apply(next);
    } catch (error) {
      console.warn('[adblock] filter refresh failed:', error);
    } finally {
      this.refreshing = false;
    }
  }

  private apply(blocker: ElectronBlocker): void {
    const changing = this.sessions.filter((session) => blocker.isBlockingEnabled(session) !== this.wanted);
    if (changing.length === 0) return;
    for (const session of changing) {
      if (this.wanted) {
        ipcMain.removeHandler(COSMETIC_FILTERS_CHANNEL);
        ipcMain.removeHandler(MUTATION_OBSERVER_CHANNEL);
        blocker.enableBlockingInSession(session);
      } else {
        blocker.disableBlockingInSession(session);
      }
    }
    if (!this.wanted) {
      ipcMain.removeHandler(COSMETIC_FILTERS_CHANNEL);
      ipcMain.removeHandler(MUTATION_OBSERVER_CHANNEL);
      ipcMain.handle(COSMETIC_FILTERS_CHANNEL, () => undefined);
      ipcMain.handle(MUTATION_OBSERVER_CHANNEL, () => false);
    }
  }
}

export function loadEngine(cacheFile: string): Promise<{ blocker: ElectronBlocker; stale: boolean }> {
  return engineModule().loadEngine(cacheFile);
}
