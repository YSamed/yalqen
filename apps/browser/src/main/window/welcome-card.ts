import { ipcMain, type BaseWindow, type IpcMainEvent, type IpcMainInvokeEvent, type WebContentsView } from 'electron';
import {
  WelcomeChannel,
  type WelcomeAction,
  type WelcomeImportRequest,
  type WelcomeImportResult,
  type WelcomeOpen,
} from '../../shared/types.js';
import { getLocale } from '../../shared/i18n.js';
import { createOverlayView, raiseToTop } from './overlay-view.js';

interface WelcomeCardOptions {
  preload: string;
  page: string;
}

export interface WelcomeHost {
  window: BaseWindow;
  open: WelcomeOpen;
  onAction: (action: WelcomeAction) => void;
  importFrom: (request: WelcomeImportRequest) => Promise<WelcomeImportResult>;
  onFinish: () => void;
}

const FAILED_IMPORT: WelcomeImportResult = { ok: false, bookmarks: 0, visits: 0 };

// The thank-you invitation floats over one window as a card; the window stays visible behind it so
// appearance choices show up live.
export class WelcomeCard {
  private view: WebContentsView | null = null;
  private host: WelcomeHost | null = null;

  constructor(private readonly options: WelcomeCardOptions) {
    ipcMain.on(WelcomeChannel.action, this.onAction);
    ipcMain.handle(WelcomeChannel.import, this.onImport);
  }

  get isOpen(): boolean {
    return this.host !== null;
  }

  show(host: WelcomeHost): void {
    if (this.host || host.window.isDestroyed()) return;
    const view = createOverlayView(this.options.preload);
    const contents = view.webContents;
    this.view = view;
    this.host = host;
    host.window.contentView.addChildView(view);
    host.window.on('resize', this.fit);
    host.window.once('closed', this.onWindowClosed);
    this.fit();
    void contents.loadFile(this.options.page, { query: { lang: getLocale() } }).then(() => {
      if (this.view !== view || contents.isDestroyed()) return;
      contents.send(WelcomeChannel.open, host.open);
      contents.focus();
    });
  }

  keepOnTop(window: BaseWindow): void {
    if (this.view && this.host?.window === window) raiseToTop(window, this.view);
  }

  close(): void {
    const { view, host } = this;
    this.view = null;
    this.host = null;
    if (host && !host.window.isDestroyed()) {
      host.window.off('resize', this.fit);
      host.window.off('closed', this.onWindowClosed);
      if (view) host.window.contentView.removeChildView(view);
    }
    if (view && !view.webContents.isDestroyed()) view.webContents.close();
  }

  destroy(): void {
    ipcMain.off(WelcomeChannel.action, this.onAction);
    ipcMain.removeHandler(WelcomeChannel.import);
    this.close();
  }

  private readonly fit = (): void => {
    if (!this.view || !this.host || this.host.window.isDestroyed()) return;
    const { width, height } = this.host.window.getContentBounds();
    this.view.setBounds({ x: 0, y: 0, width, height });
  };

  private readonly onWindowClosed = (): void => {
    this.view = null;
    this.host = null;
  };

  private fromCard(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return this.view !== null && event.sender === this.view.webContents;
  }

  private readonly onAction = (event: IpcMainEvent, action: WelcomeAction): void => {
    const host = this.host;
    if (!host || !this.fromCard(event) || typeof action !== 'object' || action === null) return;
    if (action.type === 'finish') {
      this.close();
      host.onFinish();
    } else {
      host.onAction(action);
    }
  };

  private readonly onImport = async (
    event: IpcMainInvokeEvent,
    request: WelcomeImportRequest,
  ): Promise<WelcomeImportResult> => {
    const host = this.host;
    if (!host || !this.fromCard(event) || typeof request !== 'object' || request === null) return FAILED_IMPORT;
    return host.importFrom(request);
  };
}
