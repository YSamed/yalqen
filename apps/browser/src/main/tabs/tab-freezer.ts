import { attachDebugger, detachDebugger } from '../devtools/page-debugger.js';
import type { Tab } from './tab.js';

export interface FreezeHost {
  enabled(): boolean;
  isActive(tab: Tab): boolean;
  hasLiveChild(tab: Tab): boolean;
  needsDebugger(tab: Tab): boolean;
  changed(): void;
}

export class TabFreezer {
  constructor(private readonly host: FreezeHost) {}

  maybeFreeze(tab: Tab): void {
    const contents = tab.view?.webContents;
    if (!contents || contents.isDestroyed() || tab.frozen || tab.loading) return;
    if (!this.host.enabled() || this.host.isActive(tab) || tab.pinnedUrl || tab.autoReload) return;
    if (contents.isCurrentlyAudible() || contents.isDevToolsOpened()) return;
    // A frozen opener misses the messages its sign-in popup posts back.
    if (this.host.hasLiveChild(tab)) return;
    tab.frozen = true;
    this.setLifecycleState(tab, 'frozen');
    this.host.changed();
  }

  unfreeze(tab: Tab): void {
    if (!tab.frozen) return;
    tab.frozen = false;
    this.setLifecycleState(tab, 'active');
  }

  private setLifecycleState(tab: Tab, state: 'frozen' | 'active'): void {
    const contents = tab.view?.webContents;
    if (!contents || contents.isDestroyed()) return;
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
      return;
    }
    contents.debugger
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
