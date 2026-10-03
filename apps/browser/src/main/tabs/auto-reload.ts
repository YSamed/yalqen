import type { Tab } from './tab.js';

const CHECK_MS = 1000;

export class AutoReloader {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly tabs: () => readonly Tab[]) {}

  sync(): void {
    const needed = this.tabs().some((tab) => tab.autoReload);
    if (needed && !this.timer) {
      this.timer = setInterval(() => this.run(), CHECK_MS);
    } else if (!needed && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private run(): void {
    const now = Date.now();
    for (const tab of this.tabs()) {
      const contents = tab.view?.webContents;
      if (!tab.autoReload || now < tab.autoReload.dueAt || !contents || contents.isDestroyed()) continue;
      tab.autoReload.dueAt = now + tab.autoReload.seconds * 1000;
      // Typed but unsent form input would be lost, so the page waits until it is submitted.
      if (!tab.loading && !tab.edited) contents.reload();
    }
  }
}
