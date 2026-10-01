import { ipcMain, type BaseWindow, type IpcMainEvent, type WebContentsView, type Rectangle } from 'electron';
import { FindBarChannel, type FindBarAction, type FindResult } from '../shared/types.js';
import { getLocale } from '../shared/i18n.js';
import { createOverlayView, raiseToTop } from './overlay-view.js';

const WIDTH = 380;
const HEIGHT = 60;
const INSET = 4;

export interface FindBarOptions {
  preload: string;
  page: string;
}

export interface FindBarHost {
  window: BaseWindow;
  area: () => Rectangle;
  onFind: (text: string, forward: boolean, next: boolean) => void;
  onClose: () => void;
}

export class FindBar {
  private view: WebContentsView | null = null;
  private loaded: Promise<void> = Promise.resolve();
  private host: FindBarHost | null = null;
  private opened = false;
  private text = '';

  constructor(private readonly options: FindBarOptions) {
    ipcMain.on(FindBarChannel.action, this.onAction);
  }

  open(host: FindBarHost): void {
    const view = this.ensureView();
    if (this.host && this.host.window !== host.window) this.close();
    this.host = host;
    if (!this.opened) {
      this.opened = true;
      this.layout();
      host.window.contentView.addChildView(view);
    } else {
      this.keepOnTop(host.window);
    }
    host.window.focus();
    view.webContents.focus();
    void this.loaded.then(() => {
      if (this.opened && this.view === view) view.webContents.send(FindBarChannel.open);
    });
  }

  findNext(host: FindBarHost, forward: boolean): void {
    if (!this.isOpenIn(host.window) || this.text === '') {
      this.open(host);
      return;
    }
    host.onFind(this.text, forward, true);
  }

  close(window?: BaseWindow): void {
    if (!this.opened || !this.view || !this.host) return;
    if (window && this.host.window !== window) return;
    this.opened = false;
    if (!this.host.window.isDestroyed()) this.host.window.contentView.removeChildView(this.view);
  }

  release(window: BaseWindow): void {
    if (this.host?.window !== window) return;
    this.close();
    this.host = null;
  }

  showResult(window: BaseWindow, result: FindResult): void {
    if (this.isOpenIn(window)) this.view?.webContents.send(FindBarChannel.result, result);
  }

  relayout(window: BaseWindow): void {
    if (this.isOpenIn(window)) this.layout();
  }

  keepOnTop(window: BaseWindow): void {
    if (!this.view || !this.isOpenIn(window)) return;
    raiseToTop(window, this.view);
  }

  destroy(): void {
    ipcMain.off(FindBarChannel.action, this.onAction);
    this.close();
    this.host = null;
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
  }

  private isOpenIn(window: BaseWindow): boolean {
    return this.opened && this.host?.window === window;
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view;
    const view = createOverlayView(this.options.preload);
    const contents = view.webContents;
    this.view = view;
    this.loaded = contents.loadFile(this.options.page, { query: { lang: getLocale() } }).catch((error: unknown) => {
      console.warn('[find] could not load the find bar:', error);
    });
    return view;
  }

  private layout(): void {
    if (!this.view || !this.host) return;
    const area = this.host.area();
    const width = Math.max(0, Math.min(WIDTH, area.width - 2 * INSET));
    this.view.setBounds({
      x: area.x + area.width - width - INSET,
      y: area.y + INSET,
      width,
      height: HEIGHT,
    });
  }

  private readonly onAction = (event: IpcMainEvent, action: FindBarAction): void => {
    const host = this.host;
    if (!this.view || event.sender !== this.view.webContents || !this.opened || !host) return;
    if (action.type === 'close') {
      this.close();
      host.onClose();
      return;
    }
    if (typeof action.text !== 'string') return;
    this.text = action.text;
    host.onFind(action.text, action.forward !== false, action.next === true);
  };
}
