import { BrowserWindow, type WebContents } from 'electron';
import { SettingsChannel, type SettingsView } from '../shared/types.js';

export interface SettingsWindowOptions {
  preload: string;
  page: string;
  icon: string;
}

/** A single settings window, created on demand and released when closed. */
export class SettingsWindow {
  private window: BrowserWindow | null = null;

  constructor(private readonly options: SettingsWindowOptions) {}

  get contents(): WebContents | null {
    return this.window?.webContents ?? null;
  }

  isFocused(): boolean {
    return this.window?.isFocused() ?? false;
  }

  open(): void {
    if (this.window) {
      this.window.show();
      this.window.focus();
      return;
    }

    const window = new BrowserWindow({
      width: 520,
      height: 400,
      useContentSize: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: 'Ayarlar',
      icon: this.options.icon,
      webPreferences: {
        preload: this.options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => {
      this.window = null;
    });
    this.window = window;
    void window.loadFile(this.options.page);
  }

  send(view: SettingsView): void {
    const contents = this.contents;
    if (contents && !contents.isDestroyed()) contents.send(SettingsChannel.changed, view);
  }

  close(): void {
    this.window?.close();
  }
}
