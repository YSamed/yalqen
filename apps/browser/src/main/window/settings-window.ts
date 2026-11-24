import { BrowserWindow, nativeTheme, type Session } from 'electron';
import { SETTINGS_URL } from '../../shared/types.js';

const IS_MAC = process.platform === 'darwin';

export interface SettingsWindowHost {
  preload: string;
  session: Session;
  icon: string;
  openTab: (url: string) => void;
}

export class SettingsWindow {
  private window: BrowserWindow | null = null;

  constructor(private readonly host: SettingsWindowHost) {}

  get browserWindow(): BrowserWindow | null {
    return this.window && !this.window.isDestroyed() ? this.window : null;
  }

  owns(contents: Electron.WebContents): boolean {
    return this.browserWindow?.webContents === contents;
  }

  open(pane?: string): void {
    const target = new URL(pane ?? '', SETTINGS_URL);
    target.searchParams.set('window', '');
    const url = target.toString();
    const existing = this.browserWindow;
    if (existing) {
      if (pane) void existing.loadURL(url);
      existing.show();
      existing.focus();
      return;
    }
    const window = new BrowserWindow({
      width: 820,
      height: 640,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: 'Yalqen',
      icon: this.host.icon,
      titleBarStyle: IS_MAC ? 'hiddenInset' : 'default',
      trafficLightPosition: { x: 18, y: 20 },
      fullscreenable: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#1e1f21' : '#f5f5f7',
      webPreferences: {
        preload: this.host.preload,
        session: this.host.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    window.setMenuBarVisibility(false);
    window.webContents.on('before-input-event', (event, input) => {
      const modifier = IS_MAC ? input.meta : input.control;
      if (input.type !== 'keyDown' || !modifier || input.key.toLowerCase() !== 'w') return;
      event.preventDefault();
      window.close();
    });
    window.webContents.on('will-navigate', (event, target) => {
      if (!target.startsWith(SETTINGS_URL)) event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(({ url: target }) => {
      if (/^https?:/i.test(target)) this.host.openTab(target);
      return { action: 'deny' };
    });
    window.once('ready-to-show', () => window.show());
    window.once('closed', () => {
      if (this.window === window) this.window = null;
    });
    this.window = window;
    void window.loadURL(url);
  }

  close(): void {
    this.browserWindow?.close();
  }
}
