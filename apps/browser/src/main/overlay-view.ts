import { WebContentsView, type BaseWindow } from 'electron';

export function createOverlayView(preload?: string): WebContentsView {
  const view = new WebContentsView({
    webPreferences: {
      preload,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  view.setBackgroundColor('#00000000');
  view.webContents.on('will-navigate', (event) => event.preventDefault());
  view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  return view;
}

export function raiseToTop(window: BaseWindow, view: WebContentsView): void {
  const children = window.contentView.children;
  if (children[children.length - 1] !== view) window.contentView.addChildView(view);
}
