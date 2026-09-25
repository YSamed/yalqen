import { WebContentsView, ipcMain, type BaseWindow, type IpcMainEvent } from 'electron';
import { CommandBarChannel, type CommandBarAction, type CommandBarOpen } from '../shared/types.js';

export interface CommandBarOptions {
  window: BaseWindow;
  preload: string;
  page: string;
  /** Called with the text the user submitted; the bar is already closed. */
  onSubmit: (input: string, mode: CommandBarOpen['mode']) => void;
  /** Called after the bar is closed without a submit. */
  onDismiss: () => void;
  /** Called with the current text each time the user edits it. */
  onInput: (input: string) => void;
}

/**
 * Centered search box drawn over the whole window, including the page view.
 * The view is created and loaded up front so it opens without delay; it is
 * attached to the window only while open.
 */
export class CommandBar {
  private readonly view: WebContentsView;
  private opened = false;
  private mode: CommandBarOpen['mode'] = 'navigate';

  constructor(private readonly options: CommandBarOptions) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    this.view.setBackgroundColor('#00000000');
    const contents = this.view.webContents;
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    ipcMain.on(CommandBarChannel.action, this.onAction);
    void contents.loadFile(options.page);
  }

  get isOpen(): boolean {
    return this.opened;
  }

  open(open: CommandBarOpen): void {
    this.fitWindow();
    this.mode = open.mode;
    if (!this.opened) {
      this.opened = true;
      this.options.window.contentView.addChildView(this.view);
    } else {
      this.keepOnTop();
    }
    this.options.window.focus();
    this.view.webContents.focus();
    this.view.webContents.send(CommandBarChannel.open, open);
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.options.window.contentView.removeChildView(this.view);
  }

  fitWindow(): void {
    const { width, height } = this.options.window.getContentBounds();
    this.view.setBounds({ x: 0, y: 0, width, height });
  }

  /** Page views added while the bar is open would cover it; move it back on top. */
  keepOnTop(): void {
    if (!this.opened) return;
    const children = this.options.window.contentView.children;
    if (children[children.length - 1] !== this.view) {
      this.options.window.contentView.addChildView(this.view);
    }
  }

  destroy(): void {
    ipcMain.off(CommandBarChannel.action, this.onAction);
    this.close();
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }

  private readonly onAction = (event: IpcMainEvent, action: CommandBarAction): void => {
    if (event.sender !== this.view.webContents || !this.opened) return;
    if (action.type === 'input') {
      if (typeof action.input === 'string') this.options.onInput(action.input);
      return;
    }
    this.close();
    if (action.type === 'submit' && typeof action.input === 'string' && action.input.trim() !== '') {
      this.options.onSubmit(action.input, this.mode);
    } else {
      this.options.onDismiss();
    }
  };
}
