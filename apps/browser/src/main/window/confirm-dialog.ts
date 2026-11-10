import { dialog, ipcMain, type BaseWindow, type IpcMainEvent, type WebContents, type WebContentsView } from 'electron';
import { ConfirmChannel, type ConfirmRequest } from '../../shared/types.js';
import { getLocale } from '../../shared/i18n.js';
import { createOverlayView, raiseToTop } from './overlay-view.js';

interface ConfirmDialogOptions {
  preload: string;
  page: string;
  accent: () => string;
}

interface OpenDialog {
  window: BaseWindow;
  view: WebContentsView;
  returnFocus?: WebContents;
  resolve: (confirmed: boolean) => void;
}

async function nativeConfirm(request: ConfirmRequest): Promise<boolean> {
  const { response } = await dialog.showMessageBox({
    type: 'question',
    message: request.title,
    detail: [request.message, ...request.items].filter(Boolean).join('\n'),
    buttons: [request.confirmLabel, request.cancelLabel],
    defaultId: 1,
    cancelId: 1,
  });
  return response === 0;
}

export class ConfirmDialog {
  private current: OpenDialog | null = null;

  constructor(private readonly options: ConfirmDialogOptions) {
    ipcMain.on(ConfirmChannel.answer, this.onAnswer);
  }

  async confirm(
    window: BaseWindow | null | undefined,
    request: ConfirmRequest,
    returnFocus?: WebContents,
  ): Promise<boolean> {
    if (!window) return nativeConfirm(request);
    if (this.current || window.isDestroyed()) return false;
    return new Promise((resolve) => {
      const view = createOverlayView(this.options.preload);
      const contents = view.webContents;
      this.current = { window, view, returnFocus, resolve };
      window.contentView.addChildView(view);
      window.on('resize', this.fit);
      window.once('closed', this.cancel);
      this.fit();
      void contents
        .loadFile(this.options.page, { query: { lang: getLocale() } })
        .then(() => {
          if (this.current?.view !== view || contents.isDestroyed()) return;
          contents.send(ConfirmChannel.open, { ...request, accent: this.options.accent() });
          contents.focus();
        })
        .catch(this.cancel);
    });
  }

  keepOnTop(window: BaseWindow): void {
    if (this.current?.window === window) raiseToTop(window, this.current.view);
  }

  destroy(): void {
    ipcMain.off(ConfirmChannel.answer, this.onAnswer);
    this.cancel();
  }

  private finish(confirmed: boolean): void {
    const current = this.current;
    if (!current) return;
    this.current = null;
    const { window, view, returnFocus, resolve } = current;
    if (!window.isDestroyed()) {
      window.off('resize', this.fit);
      window.off('closed', this.cancel);
      window.contentView.removeChildView(view);
    }
    if (!view.webContents.isDestroyed()) view.webContents.close();
    if (returnFocus && !returnFocus.isDestroyed()) returnFocus.focus();
    resolve(confirmed);
  }

  private readonly cancel = (): void => this.finish(false);

  private readonly fit = (): void => {
    const current = this.current;
    if (!current || current.window.isDestroyed()) return;
    const { width, height } = current.window.getContentBounds();
    current.view.setBounds({ x: 0, y: 0, width, height });
  };

  private readonly onAnswer = (event: IpcMainEvent, confirmed: unknown): void => {
    if (this.current && event.sender === this.current.view.webContents) this.finish(confirmed === true);
  };
}
