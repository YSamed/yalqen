import { BaseWindow, type WebContentsView } from 'electron';
import { LinkPeek, type PeekedPage } from './link-peek.js';

const WIDTH = 480;
const HEIGHT = 680;

export interface MiniWindowHost {
  page: string;
  icon: string;
  createPageView: () => WebContentsView;
  createOverlay: () => WebContentsView;
  upgradeHttp: (url: string) => string | null;
  onPromote: (page: PeekedPage) => void;
}

export function openMiniWindow(url: string, host: MiniWindowHost): void {
  const window = new BaseWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: 320,
    minHeight: 400,
    title: 'Yalqen',
    icon: host.icon,
  });
  const peek = new LinkPeek({
    window,
    page: host.page,
    docked: true,
    area: () => {
      const { width, height } = window.getContentBounds();
      return { x: 0, y: 0, width, height };
    },
    createOverlay: host.createOverlay,
    createPageView: () => {
      const view = host.createPageView();
      // The menu's close-tab shortcut belongs to the main windows, so the mini window takes it before the menu does.
      view.webContents.on('before-input-event', (event, input) => {
        const modifier = process.platform === 'darwin' ? input.meta : input.control;
        if (window.isDestroyed() || input.type !== 'keyDown' || !modifier || input.key.toLowerCase() !== 'w') return;
        event.preventDefault();
        window.close();
      });
      return view;
    },
    upgradeHttp: host.upgradeHttp,
    onPromote: (page) => {
      host.onPromote(page);
      window.close();
    },
    onClosed: () => {
      if (!window.isDestroyed()) window.close();
    },
  });
  window.on('resize', () => peek.relayout());
  window.once('closed', () => peek.close());
  peek.open(url, false, { tabId: null, url });
}
