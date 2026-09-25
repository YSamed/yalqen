import fs from 'node:fs/promises';
import path from 'node:path';
import { net, type Session } from 'electron';
import { ElectronBlocker } from '@ghostery/adblocker-electron';

const ENGINE_FILE = 'adblock-engine.bin';
/** Filter lists older than this are downloaded again. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Blocks ads and trackers in one session with the Ghostery engine. The engine is
 * built from the prebuilt ads and tracking lists and kept on disk, so later
 * launches only deserialize it. Pages that load before it is ready are not blocked.
 */
export class AdBlocker {
  private blocker: ElectronBlocker | null = null;
  private loading = false;
  private wanted = false;

  constructor(
    private readonly session: Session,
    private readonly directory: string,
  ) {}

  setEnabled(enabled: boolean): void {
    this.wanted = enabled;
    if (this.blocker) {
      this.apply(this.blocker);
    } else if (enabled && !this.loading) {
      this.loading = true;
      void this.load().then((blocker) => {
        this.loading = false;
        this.blocker = blocker;
        if (blocker) this.apply(blocker);
      });
    }
  }

  private apply(blocker: ElectronBlocker): void {
    const active = blocker.isBlockingEnabled(this.session);
    if (this.wanted && !active) blocker.enableBlockingInSession(this.session);
    else if (!this.wanted && active) blocker.disableBlockingInSession(this.session);
  }

  private async load(): Promise<ElectronBlocker | null> {
    const file = path.join(this.directory, ENGINE_FILE);
    const cached = await this.readCached(file);
    if (cached?.fresh) return cached.blocker;
    try {
      const blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetchOk);
      await fs.mkdir(this.directory, { recursive: true });
      const temp = `${file}.tmp`;
      await fs.writeFile(temp, blocker.serialize());
      await fs.rename(temp, file);
      return blocker;
    } catch (error) {
      // Offline or a list failed to download: outdated lists still block most ads.
      console.warn(`[adblock] filter lists not updated: ${(error as Error).message}`);
      return cached?.blocker ?? null;
    }
  }

  /** The cached engine, or null when it is missing or was written by another library version. */
  private async readCached(file: string): Promise<{ blocker: ElectronBlocker; fresh: boolean } | null> {
    try {
      const stat = await fs.stat(file);
      const blocker = ElectronBlocker.deserialize(await fs.readFile(file));
      return { blocker, fresh: Date.now() - stat.mtimeMs < MAX_AGE_MS };
    } catch {
      return null;
    }
  }
}

/** Uses Chromium's network stack (system proxy included); error pages are not parsed as filters. */
async function fetchOk(url: string): Promise<Response> {
  const response = await net.fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}
