import { attachDebugger, detachDebugger } from '../devtools/page-debugger.js';
import type { Tab } from './tab.js';

interface FreezeHost {
  enabled(): boolean;
  isActive(tab: Tab): boolean;
  hasLiveChild(tab: Tab): boolean;
  needsDebugger(tab: Tab): boolean;
  changed(): void;
}

const MEDIA_GAP_MS = 30_000;
export const FREEZE_IDLE_MS = 10_000;

export function keepsPlaying(tab: Tab): boolean {
  return tab.pip || (tab.soundAt > 0 && (tab.playingMedia > 0 || Date.now() - tab.soundAt < MEDIA_GAP_MS));
}

export class TabFreezer {
  private readonly pending = new Map<Tab, NodeJS.Timeout>();

  constructor(private readonly host: FreezeHost) {}

  maybeFreeze(tab: Tab): void {
    const contents = tab.view?.webContents;
    if (!contents || contents.isDestroyed() || tab.frozen || tab.loading) return;
    if (!this.host.enabled() || this.host.isActive(tab) || tab.pinnedUrl || tab.autoReload) return;
    if (contents.isCurrentlyAudible() || keepsPlaying(tab) || tab.devToolsShown) return;
    if (this.host.hasLiveChild(tab)) return;
    const remaining = FREEZE_IDLE_MS - (Date.now() - tab.inactiveSince);
    if (remaining > 0) {
      if (!this.pending.has(tab)) {
        const timer = setTimeout(() => {
          this.pending.delete(tab);
          this.maybeFreeze(tab);
        }, remaining);
        timer.unref();
        this.pending.set(tab, timer);
      }
      return;
    }
    this.cancel(tab);
    tab.frozen = true;
    this.setLifecycleState(tab, 'frozen');
    this.host.changed();
  }

  freezeAfterGap(tab: Tab): void {
    setTimeout(() => this.maybeFreeze(tab), MEDIA_GAP_MS + 1_000);
  }

  cancel(tab: Tab): void {
    const timer = this.pending.get(tab);
    if (timer) clearTimeout(timer);
    this.pending.delete(tab);
  }

  unfreeze(tab: Tab): Promise<void> {
    this.cancel(tab);
    if (!tab.frozen) return Promise.resolve();
    tab.frozen = false;
    return this.setLifecycleState(tab, 'active');
  }

  private setLifecycleState(tab: Tab, state: 'frozen' | 'active'): Promise<void> {
    const contents = tab.view?.webContents;
    if (!contents || contents.isDestroyed()) return Promise.resolve();
    const failed = (error: unknown) => {
      console.warn(`[freeze] ${state} failed for ${tab.url}: ${(error as Error).message}`);
      if (state === 'frozen' && tab.frozen && tab.view?.webContents === contents) {
        tab.frozen = false;
        this.host.changed();
      }
    };
    try {
      attachDebugger(contents);
    } catch (error) {
      failed(error);
      return Promise.resolve();
    }
    return contents.debugger
      .sendCommand('Page.setWebLifecycleState', { state })
      .then(() => {
        const settled = tab.frozen === (state === 'frozen');
        if (settled && !this.host.needsDebugger(tab)) detachDebugger(contents);
      })
      .catch((error: unknown) => {
        if (!contents.isDestroyed()) failed(error);
      });
  }
}
