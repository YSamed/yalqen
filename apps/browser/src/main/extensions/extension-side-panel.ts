import { WebContentsView, type BaseWindow, type Rectangle, type Session, type WebContents } from 'electron';

export const SIDE_PANEL_WIDTH = 360;
const GAP = 8;
const RADIUS = 12;

interface SidePanelOptions {
  window: BaseWindow;
  session: Session;
  onOpenUrl(url: string): void;
  onResize(): void;
}

export function sidePanelBounds(page: Rectangle): Rectangle {
  return { x: page.x + page.width + GAP, y: page.y, width: SIDE_PANEL_WIDTH - GAP, height: page.height };
}

// One extension side panel per window, docked right of the page.
export class ExtensionSidePanel {
  private view: WebContentsView | null = null;
  private owner: string | null = null;
  private url: string | null = null;
  private hidden = false;

  constructor(private readonly options: SidePanelOptions) {}

  get extensionId(): string | null {
    return this.owner;
  }

  get reserved(): number {
    return this.view && !this.hidden ? SIDE_PANEL_WIDTH : 0;
  }

  owns(contents: WebContents): boolean {
    return this.view?.webContents === contents;
  }

  open(extensionId: string, url: string): WebContents {
    if (this.view && this.owner === extensionId) {
      if (this.url !== url) void this.view.webContents.loadURL(url).catch(() => {});
      this.url = url;
      this.setHidden(false);
      return this.view.webContents;
    }
    this.close();
    const view = new WebContentsView({
      webPreferences: { session: this.options.session, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    view.setBorderRadius(RADIUS);
    const contents = view.webContents;
    contents.setWindowOpenHandler(({ url: target }) => {
      this.options.onOpenUrl(target);
      return { action: 'deny' };
    });
    contents.once('destroyed', () => this.detach(view));
    this.view = view;
    this.owner = extensionId;
    this.url = url;
    this.options.window.contentView.addChildView(view);
    this.options.onResize();
    void contents
      .loadURL(url)
      .catch((error: unknown) => console.warn('[extensions] could not open the side panel:', error));
    return contents;
  }

  close(): void {
    const view = this.view;
    if (!view) return;
    this.detach(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  hide(): void {
    this.setHidden(true);
  }

  place(page: Rectangle | null): void {
    if (!this.view) return;
    this.view.setVisible(page !== null);
    if (page) this.view.setBounds(sidePanelBounds(page));
  }

  private setHidden(hidden: boolean): void {
    if (!this.view || this.hidden === hidden) return;
    this.hidden = hidden;
    this.options.onResize();
  }

  private detach(view: WebContentsView): void {
    if (this.view !== view) return;
    this.view = null;
    this.owner = null;
    this.url = null;
    this.hidden = false;
    if (!this.options.window.isDestroyed()) {
      this.options.window.contentView.removeChildView(view);
      this.options.onResize();
    }
  }
}
