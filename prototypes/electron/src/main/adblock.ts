import fs from 'node:fs/promises';
import { ElectronBlocker, adsLists } from '@ghostery/adblocker-electron';
import type { Session } from 'electron';

// Peter Lowe's list forbids commercial use; the rest are GPL3 or CC BY-SA.
const FILTER_LISTS = adsLists.filter((url) => !url.includes('/peter-lowe/'));
// The parsed engine is cached on disk; lists are fetched again once it is older than this.
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Blocks ads in one session. The engine is loaded the first time blocking is enabled. */
export class AdBlocker {
  private blocker: ElectronBlocker | null = null;
  private loading: Promise<void> | null = null;
  private wanted = false;

  constructor(
    private readonly session: Session,
    private readonly cacheFile: string,
  ) {}

  /** Applies to requests and pages loaded from now on. */
  setEnabled(enabled: boolean): void {
    this.wanted = enabled;
    if (this.blocker) this.apply(this.blocker);
    else if (enabled) this.loading ??= this.load();
  }

  private async load(): Promise<void> {
    try {
      this.blocker = await loadEngine(this.cacheFile);
      this.apply(this.blocker);
    } catch (error) {
      console.warn('[adblock] filters could not be loaded:', error);
    } finally {
      this.loading = null;
    }
  }

  private apply(blocker: ElectronBlocker): void {
    if (this.wanted === blocker.isBlockingEnabled(this.session)) return;
    if (this.wanted) blocker.enableBlockingInSession(this.session);
    else blocker.disableBlockingInSession(this.session);
  }
}

async function loadEngine(cacheFile: string): Promise<ElectronBlocker> {
  try {
    return await ElectronBlocker.fromLists(fetch, FILTER_LISTS, {}, {
      path: cacheFile,
      read: async (file) => {
        const { mtimeMs } = await fs.stat(file);
        if (Date.now() - mtimeMs > CACHE_MAX_AGE_MS) throw new Error('filter cache is stale');
        return fs.readFile(file);
      },
      write: (file, buffer) => fs.writeFile(file, buffer),
    });
  } catch (error) {
    // Offline with an old cache: keep blocking with the filters we have.
    try {
      return ElectronBlocker.deserialize(await fs.readFile(cacheFile));
    } catch {
      throw error;
    }
  }
}
