import { WebContentsView, type BaseWindow, type Rectangle, type WebContents } from 'electron';
import { getLocale } from '../../shared/i18n.js';
import { loadRenderer } from '../app/dev-renderer.js';
import { preloadPath, rendererPath } from '../app/paths.js';
import { raiseToTop } from '../window/overlay-view.js';

const WIDTH = 440;
const INSET = 12;
const MAX_HEIGHT = 760;
const RADIUS = 16;

export interface FloatingChatOffset {
  right: number;
  top: number;
}

const DEFAULT_OFFSET: FloatingChatOffset = { right: INSET, top: INSET };

// The card keeps its distance from the page's top right corner, so it stays put while the window resizes.
export function floatingChatBounds(page: Rectangle, offset: FloatingChatOffset = DEFAULT_OFFSET): Rectangle {
  const width = Math.max(0, Math.min(WIDTH, page.width - INSET * 2));
  const height = Math.max(0, Math.min(MAX_HEIGHT, page.height - INSET * 2));
  const right = Math.min(Math.max(0, offset.right), page.width - width);
  const top = Math.min(Math.max(0, offset.top), page.height - height);
  return { x: page.x + page.width - width - right, y: page.y + top, width, height };
}

// The page views sit above the window's own UI, so a chat card over the page needs a view of its own.
export class FloatingChat {
  private view: WebContentsView | null = null;
  private shown = false;
  private offset = DEFAULT_OFFSET;
  private page: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

  constructor(private readonly window: BaseWindow) {}

  get contents(): WebContents | null {
    return this.shown && this.view && !this.view.webContents.isDestroyed() ? this.view.webContents : null;
  }

  owns(contents: WebContents): boolean {
    return this.view?.webContents === contents;
  }

  show(page: Rectangle): void {
    const view = this.ensureView();
    this.page = page;
    view.setBounds(floatingChatBounds(page, this.offset));
    if (!this.shown) {
      this.shown = true;
      this.window.contentView.addChildView(view);
    }
  }

  moveBy(dx: number, dy: number): void {
    if (!this.shown || !this.view) return;
    const current = this.view.getBounds();
    const bounds = floatingChatBounds(this.page, {
      right: this.page.x + this.page.width - current.x - current.width - dx,
      top: current.y - this.page.y + dy,
    });
    this.offset = { right: this.page.x + this.page.width - bounds.x - bounds.width, top: bounds.y - this.page.y };
    this.view.setBounds(bounds);
  }

  hide(): void {
    if (!this.shown || !this.view) return;
    this.shown = false;
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.view);
  }

  keepOnTop(): void {
    if (this.shown && this.view) raiseToTop(this.window, this.view);
  }

  destroy(): void {
    this.hide();
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view;
    const view = new WebContentsView({
      webPreferences: {
        preload: preloadPath('preload'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    view.setBackgroundColor('#00000000');
    view.setBorderRadius(RADIUS);
    view.webContents.on('will-navigate', (event) => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    void loadRenderer(view.webContents, rendererPath('chat.html'), { lang: getLocale() });
    this.view = view;
    return view;
  }
}
