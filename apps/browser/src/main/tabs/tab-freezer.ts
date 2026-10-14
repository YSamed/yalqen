import { attachDebugger, detachDebugger } from '../devtools/page-debugger.js';
import type { Tab } from './tab.js';

interface FreezeHost {
  enabled(): boolean;
  isActive(tab: Tab): boolean;
  hasLiveChild(tab: Tab): boolean;
  needsDebugger(tab: Tab): boolean;
  changed(): void;
}

// Players fall quiet between tracks and ads, so a tab that made sound is kept running a while after it stops.
const MEDIA_GAP_MS = 30_000;

// Chromium reports a playing tab as silent during a quiet passage; a muted autoplay that never made sound can still freeze.
export function keepsPlaying(tab: Tab): boolean {
  return tab.soundAt > 0 && (tab.playingMedia > 0 || Date.now() - tab.soundAt < MEDIA_GAP_MS);
}

export class TabFreezer {
  constructor(private readonly host: FreezeHost) {}

  maybeFreeze(tab: Tab): void {
    const contents = tab.view?.webContents;
    if (!contents || contents.isDestroyed() || tab.frozen || tab.loading) return;
    if (!this.host.enabled() || this.host.isActive(tab) || tab.pinnedUrl || tab.autoReload) return;
    if (contents.isCurrentlyAudible() || keepsPlaying(tab) || contents.isDevToolsOpened()) return;
    // A frozen opener misses the messages its sign-in popup posts back.
    if (this.host.hasLiveChild(tab)) return;
    tab.frozen = true;
    this.setLifecycleState(tab, 'frozen');
    this.host.changed();
  }

  freezeAfterGap(tab: Tab): void {
    setTimeout(() => this.maybeFreeze(tab), MEDIA_GAP_MS + 1_000);
  }

  // Resolves once the page runs again, for callers that must execute script in it right away.
  unfreeze(tab: Tab): Promise<void> {
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
