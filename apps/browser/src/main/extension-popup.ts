import { WebContentsView, type BaseWindow, type Rectangle, type Session, type Size } from 'electron';
import type { AnchorRect } from '../shared/types.js';
import { raiseToTop } from './overlay-view.js';

// Chrome's own limits for extension popups.
const MIN_SIZE = 25;
const MAX_WIDTH = 800;
const MAX_HEIGHT = 600;
const EDGE = 8;
const GAP = 6;
const RADIUS = 12;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));

export function sanitizeAnchor(raw: unknown): AnchorRect {
  const value = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const number = (key: string) => (Number.isFinite(value[key]) ? Math.max(0, value[key] as number) : 0);
  return { x: number('x'), y: number('y'), width: number('width'), height: number('height') };
}

export function popupBounds(anchor: AnchorRect, preferred: Size, area: Size): Rectangle {
  const y = Math.round(anchor.y + anchor.height + GAP);
  const width = clamp(Math.ceil(preferred.width), MIN_SIZE, Math.min(MAX_WIDTH, area.width - 2 * EDGE));
  const height = clamp(Math.ceil(preferred.height), MIN_SIZE, Math.min(MAX_HEIGHT, area.height - y - EDGE));
  const x = Math.round(clamp(anchor.x + anchor.width - width, EDGE, area.width - width - EDGE));
  return { x, y, width, height };
}

export interface ExtensionPopupRequest {
  window: BaseWindow;
  session: Session;
  url: string;
  anchor: AnchorRect;
  onOpenUrl(url: string): void;
}

export class ExtensionPopup {
  private view: WebContentsView | null = null;
  private window: BaseWindow | null = null;

  open({ window, session, url, anchor, onOpenUrl }: ExtensionPopupRequest): void {
    this.close();
    const view = new WebContentsView({
      webPreferences: {
        session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        enablePreferredSizeMode: true,
      },
    });
    this.view = view;
    this.window = window;
    view.setBorderRadius(RADIUS);
    const contents = view.webContents;
    let size: Size = { width: MIN_SIZE, height: MIN_SIZE };
    const place = () => {
      if (this.view !== view || window.isDestroyed()) return;
      view.setBounds(popupBounds(anchor, size, window.getContentBounds()));
      raiseToTop(window, view);
    };
    contents.on('preferred-size-changed', (_event, preferred) => {
      size = preferred;
      if (!contents.isLoading()) place();
    });
    contents.once('did-finish-load', () => {
      place();
      contents.focus();
    });
    contents.on('blur', () => this.closeView(view));
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape') return;
      event.preventDefault();
      this.closeView(view);
    });
    contents.setWindowOpenHandler(({ url: target }) => {
      onOpenUrl(target);
      this.closeView(view);
      return { action: 'deny' };
    });
    contents.once('destroyed', () => this.detach(view));
    void contents.loadURL(url).catch((error: unknown) => {
      console.warn('[extensions] could not open the popup:', error);
      this.closeView(view);
    });
  }

  close(window?: BaseWindow): void {
    if (this.view && (!window || window === this.window)) this.closeView(this.view);
  }

  private closeView(view: WebContentsView): void {
    this.detach(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  private detach(view: WebContentsView): void {
    if (this.view !== view) return;
    if (this.window && !this.window.isDestroyed()) this.window.contentView.removeChildView(view);
    this.view = null;
    this.window = null;
  }
}
