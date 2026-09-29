import fs from 'node:fs/promises';
import path from 'node:path';
import { ElectronBlocker, adsLists } from '@ghostery/adblocker-electron';
import { ipcMain, powerMonitor, type Session } from 'electron';

const FILTER_LISTS = adsLists.filter((url) => !url.includes('/peter-lowe/'));
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CACHE_REFRESH_DELAY_MS = 30_000;
const MIN_IDLE_SECONDS = 10;
const COSMETIC_FILTERS_CHANNEL = '@ghostery/adblocker/inject-cosmetic-filters';
const MUTATION_OBSERVER_CHANNEL = '@ghostery/adblocker/is-mutation-observer-enabled';

// Scriptlets declare shared helpers (e.g. `proxyApplyFn`) as globals. Injected one by one, a later
// scriptlet redeclares them and wraps the earlier Function.prototype.toString proxy, which then
// recurses forever (seen on chatgpt.com). A function scope per scriptlet keeps their state apart.
class ScopedScriptletBlocker extends ElectronBlocker {
  override getCosmeticsFilters(...args: Parameters<ElectronBlocker['getCosmeticsFilters']>) {
    const filters = super.getCosmeticsFilters(...args);
    return { ...filters, scripts: filters.scripts.map((script) => `(function () {\n${script}\n})();`) };
  }
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
      const next = await fetchEngine(this.cacheFile);
      if (this.destroyed) return;
      for (const session of this.sessions) {
        if (this.blocker?.isBlockingEnabled(session)) this.blocker.disableBlockingInSession(session);
      }
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

export async function loadEngine(cacheFile: string): Promise<{ blocker: ElectronBlocker; stale: boolean }> {
  try {
    const { mtimeMs } = await fs.stat(cacheFile);
    const blocker = ScopedScriptletBlocker.deserialize(await fs.readFile(cacheFile));
    return { blocker, stale: Date.now() - mtimeMs > CACHE_MAX_AGE_MS };
  } catch {
    return { blocker: await fetchEngine(cacheFile), stale: false };
  }
}

async function fetchEngine(cacheFile: string): Promise<ElectronBlocker> {
  const blocker = await ScopedScriptletBlocker.fromLists(fetch, FILTER_LISTS);
  const temp = `${cacheFile}.tmp`;
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  await fs.writeFile(temp, blocker.serialize());
  await fs.rename(temp, cacheFile);
  return blocker;
}
