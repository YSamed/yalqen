import { BrowserWindow, screen, type Session, type WebContents } from 'electron';
import type { ExtensionWindowState } from '../../shared/extension-bridge.js';

const DEFAULT_SIZE = { width: 400, height: 600 };
const MIN_SIZE = 200;

export interface PopupWindowOptions {
  width?: unknown;
  height?: unknown;
  left?: unknown;
  top?: unknown;
  focused?: unknown;
}

const size = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(MIN_SIZE, Math.round(value)) : fallback;

export function popupWindowBounds(options: PopupWindowOptions, area: Electron.Rectangle): Electron.Rectangle {
  const width = Math.min(size(options.width, DEFAULT_SIZE.width), area.width);
  const height = Math.min(size(options.height, DEFAULT_SIZE.height), area.height);
  const place = (value: unknown, start: number, span: number, length: number) =>
    typeof value === 'number' && Number.isFinite(value)
      ? Math.min(Math.max(Math.round(value), start), start + span - length)
      : Math.round(start + (span - length) / 2);
  return {
    x: place(options.left, area.x, area.width, width),
    y: place(options.top, area.y, area.height, height),
    width,
    height,
  };
}

// The small windows extensions open with chrome.windows.create({ type: 'popup' }), such as Bitwarden's pop out.
export class ExtensionPopupWindows {
  private readonly open = new Map<number, BrowserWindow>();

  constructor(
    private readonly session: Session,
    private readonly events: { created(state: ExtensionWindowState): void; removed(id: number): void },
  ) {}

  create(url: string, options: PopupWindowOptions): ExtensionWindowState {
    const window = new BrowserWindow({
      ...popupWindowBounds(options, screen.getPrimaryDisplay().workArea),
      show: false,
      minimizable: false,
      fullscreenable: false,
      webPreferences: { session: this.session, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const id = window.id;
    this.open.set(id, window);
    window.setMenuBarVisibility(false);
    window.once('ready-to-show', () => (options.focused === false ? window.showInactive() : window.show()));
    window.once('closed', () => {
      this.open.delete(id);
      this.events.removed(id);
    });
    void window.loadURL(url).catch((error: unknown) => console.warn('[extensions] popup window failed:', error));
    const state = { id, focused: options.focused !== false, type: 'popup' as const };
    this.events.created(state);
    return state;
  }

  states(): ExtensionWindowState[] {
    return [...this.open].map(([id, window]) => ({ id, focused: window.isFocused(), type: 'popup' as const }));
  }

  windowId(contents: WebContents): number | undefined {
    for (const [id, window] of this.open) if (window.webContents === contents) return id;
  }

  focus(id: number): boolean {
    const window = this.open.get(id);
    if (!window) return false;
    window.focus();
    return true;
  }

  remove(id: number): boolean {
    const window = this.open.get(id);
    if (!window) return false;
    window.close();
    return true;
  }
}
