import type { Event } from 'electron';
import { confirmWindowsClose, type ClosingWindow } from '../window/close-windows.js';

interface QuitOptions {
  windows: readonly ClosingWindow[];
  beforeClose(): Promise<void>;
  saveSession(resume: boolean): void;
  quit(): void;
}

export class QuitController {
  private pending = false;
  private closing = false;

  constructor(private readonly options: QuitOptions) {}

  get isQuitting(): boolean {
    return this.closing;
  }

  beforeQuit(event: Pick<Event, 'preventDefault'>): void {
    if (this.closing) return;
    event.preventDefault();
    void this.finish();
  }

  lastWindowClosing(): void {
    this.closing = true;
    this.options.saveSession(false);
  }

  prepareUpdate(): Promise<boolean> {
    return this.prepare(true);
  }

  relaunch(schedule: () => void): void {
    void this.finish(schedule);
  }

  private async finish(schedule?: () => void): Promise<void> {
    if (!(await this.prepare(false))) return;
    schedule?.();
    this.options.quit();
  }

  private async prepare(resume: boolean): Promise<boolean> {
    if (this.closing || this.pending) return false;
    this.pending = true;
    try {
      const approved = await confirmWindowsClose(
        this.options.windows,
        () => this.options.beforeClose(),
        () => {
          this.closing = false;
        },
      );
      if (!approved) return false;
      this.closing = true;
      this.options.saveSession(resume);
      return true;
    } finally {
      this.pending = false;
    }
  }
}
