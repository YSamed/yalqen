import type { BaseWindow, Rectangle, WebContents, WebContentsView } from 'electron';
import { getLocale } from '../../shared/i18n.js';
import { peekLayout } from '../../shared/link-peek.js';
import { PeekChannel, type PeekAction, type TabId } from '../../shared/types.js';
import { isActivation, isPeekable } from '../tabs/popups.js';
import { raiseToTop } from './overlay-view.js';

const PAGE_RADIUS = 12;

export interface PeekedPage {
  view: WebContentsView;
  url: string;
  title: string;
  isPrivate: boolean;
  interacted: boolean;
  edited: boolean;
}

export interface PeekOwner {
  tabId: TabId | null;
  url: string;
}

export interface LinkPeekHost {
  window: BaseWindow;
  page: string;
  area: () => Rectangle;
  createOverlay: () => WebContentsView;
  createPageView: (isPrivate: boolean) => WebContentsView;
  upgradeHttp: (url: string) => string | null;
  onPromote: (page: PeekedPage) => void;
  onClosed: () => void;
}

interface OpenPeek {
  owner: PeekOwner;
  url: string;
  isPrivate: boolean;
  interacted: boolean;
  edited: boolean;
  page: WebContentsView;
  overlay: WebContentsView;
  title: string;
  ready: boolean;
  dispose: () => void;
}

export class LinkPeek {
  private current: OpenPeek | null = null;

  constructor(private readonly host: LinkPeekHost) {}

  get isOpen(): boolean {
    return this.current !== null;
  }

  open(url: string, isPrivate: boolean, owner: PeekOwner): void {
    if (!isPeekable(url) || this.host.window.isDestroyed()) return;
    this.close();
    const page = this.host.createPageView(isPrivate);
    const overlay = this.host.createOverlay();
    const current: OpenPeek = {
      owner,
      url,
      isPrivate,
      interacted: false,
      edited: false,
      page,
      overlay,
      title: '',
      ready: false,
      dispose: () => {},
    };
    this.current = current;
    current.dispose = this.listen(current);
    const contents = page.webContents;
    this.go(current, url);
    void overlay.webContents
      .loadFile(this.host.page, { query: { lang: getLocale() } })
      .then(() => {
        if (this.current !== current || this.host.window.isDestroyed()) return;
        current.ready = true;
        this.host.window.contentView.addChildView(overlay);
        this.host.window.contentView.addChildView(page);
        this.layout();
        this.push(current);
        contents.focus();
      })
      .catch(() => {
        if (this.current === current) this.close();
      });
  }

  close(): void {
    const current = this.current;
    if (!current) return;
    this.release(current);
    for (const { webContents } of [current.page, current.overlay]) if (!webContents.isDestroyed()) webContents.close();
    this.host.onClosed();
  }

  promote(): void {
    const current = this.current;
    if (!current) return;
    this.release(current);
    const { webContents } = current.page;
    if (!current.overlay.webContents.isDestroyed()) current.overlay.webContents.close();
    this.host.onPromote({
      view: current.page,
      url: webContents.getURL() || current.url,
      title: webContents.getTitle() || current.title,
      isPrivate: current.isPrivate,
      interacted: current.interacted,
      edited: current.edited,
    });
  }

  closeUnless(owner: PeekOwner): void {
    if (this.current && (this.current.owner.tabId !== owner.tabId || this.current.owner.url !== owner.url))
      this.close();
  }

  relayout(): void {
    this.layout();
  }

  keepOnTop(): void {
    const current = this.current;
    if (!current?.ready || this.host.window.isDestroyed()) return;
    raiseToTop(this.host.window, current.overlay);
    raiseToTop(this.host.window, current.page);
  }

  private release(current: OpenPeek): void {
    this.current = null;
    current.dispose();
    const { window } = this.host;
    if (window.isDestroyed()) return;
    window.contentView.removeChildView(current.page);
    window.contentView.removeChildView(current.overlay);
  }

  private go(current: OpenPeek, url: string): void {
    void current.page.webContents.loadURL(this.host.upgradeHttp(url) ?? url).catch(() => {});
  }

  private listen(current: OpenPeek): () => void {
    const disposers: (() => void)[] = [];
    const listenOn = (contents: WebContents) =>
      ((event: string, listener: (...args: never[]) => void) => {
        contents.on(event as never, listener);
        disposers.push(() => contents.off(event as never, listener));
        return contents;
      }) as unknown as WebContents['on'];
    const page = current.page.webContents;
    const onPage = listenOn(page);
    const onOverlay = listenOn(current.overlay.webContents);

    onPage('before-input-event', (event, input) => {
      if (input.type !== 'keyDown' || input.key !== 'Escape') return;
      event.preventDefault();
      this.close();
    });
    onPage('input-event', (_event, input) => {
      if (isActivation(input.type)) current.interacted = true;
      if (input.type === 'char') current.edited = true;
    });
    onPage('will-navigate', (event) => {
      const upgraded = this.host.upgradeHttp(event.url);
      if (isPeekable(event.url) && !upgraded) return;
      event.preventDefault();
      if (upgraded) this.go(current, upgraded);
    });
    onPage('will-redirect', (event) => {
      if (event.isMainFrame && (!isPeekable(event.url) || this.host.upgradeHttp(event.url))) event.preventDefault();
    });
    onPage('page-title-updated', (_event, title) => {
      current.title = title;
      this.push(current);
    });
    onPage('did-navigate', () => this.push(current));
    onPage('did-navigate-in-page', () => this.push(current));
    onPage('destroyed', () => this.close());
    onPage('render-process-gone', () => this.close());
    onOverlay('ipc-message', (_event, channel, action: PeekAction) => {
      if (channel !== PeekChannel.action) return;
      if (action === 'close') this.close();
      else if (action === 'promote') this.promote();
    });
    page.setWindowOpenHandler(({ url }) => {
      if (isPeekable(url)) this.go(current, url);
      return { action: 'deny' };
    });
    return () => {
      for (const dispose of disposers) dispose();
    };
  }

  private layout(): void {
    const current = this.current;
    if (!current?.ready) return;
    const area = this.host.area();
    const { body } = peekLayout(area.width, area.height);
    current.overlay.setBounds(area);
    current.page.setBorderRadius(PAGE_RADIUS);
    current.page.setBounds({ x: area.x + body.x, y: area.y + body.y, width: body.width, height: body.height });
  }

  private push(current: OpenPeek): void {
    const { webContents } = current.overlay;
    if (!current.ready || webContents.isDestroyed()) return;
    const url = current.page.webContents.getURL();
    webContents.send(PeekChannel.update, { title: current.title || url, url });
  }
}
