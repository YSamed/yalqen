import { randomUUID } from 'node:crypto';
import { WebContentsView, type BaseWindow, type Rectangle, type Session } from 'electron';
import type { BrowserState, TabId, TabSnapshot } from '../shared/types.js';
import type { SavedHistory, SavedSession, SavedTab } from './persistence.js';

const MAX_CLOSED_TABS = 20;
const NEW_TAB_TITLE = 'Yeni sekme';

interface Tab {
  id: TabId;
  /** Null while the tab is discarded: listed, but no page in memory. */
  view: WebContentsView | null;
  url: string;
  title: string;
  faviconUrl: string | null;
  keepAlive: boolean;
  loading: boolean;
  /** Navigation history kept while the tab is discarded. */
  history: SavedHistory | null;
}

export interface RestoreTiming {
  tabId: TabId;
  url: string;
  ms: number;
}

export interface TabManagerOptions {
  window: BaseWindow;
  session: Session;
  onChange: () => void;
  onRestore: (timing: RestoreTiming) => void;
}

/** Owns tab records and their page views. Only the active tab's view is attached to the window. */
export class TabManager {
  private readonly tabs: Tab[] = [];
  private readonly closed: SavedTab[] = [];
  private activeId: TabId | null = null;
  private pageBounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };

  constructor(private readonly options: TabManagerOptions) {}

  get activeTabId(): TabId | null {
    return this.activeId;
  }

  get liveCount(): number {
    return this.tabs.filter((tab) => tab.view).length;
  }

  get count(): number {
    return this.tabs.length;
  }

  state(): Pick<BrowserState, 'tabs' | 'activeTabId'> {
    return {
      tabs: this.tabs.map((tab) => this.snapshot(tab)),
      activeTabId: this.activeId,
    };
  }

  setPageBounds(bounds: Rectangle): void {
    this.pageBounds = bounds;
    this.active()?.view?.setBounds(bounds);
  }

  open(url = 'about:blank', { activate = true } = {}): TabId {
    const tab = this.createRecord({ url });
    const index = this.activeId ? this.indexOf(this.activeId) + 1 : this.tabs.length;
    this.tabs.splice(index, 0, tab);
    if (activate) {
      this.activate(tab.id);
    } else {
      this.ensureLive(tab);
      this.changed();
    }
    return tab.id;
  }

  activate(id: TabId): void {
    const next = this.find(id);
    if (!next) return;

    const previous = this.active();
    if (previous?.view && previous.id !== id) {
      this.options.window.contentView.removeChildView(previous.view);
    }

    this.activeId = id;
    const view = this.ensureLive(next);
    view.setBounds(this.pageBounds);
    this.options.window.contentView.addChildView(view);
    if (next.url !== 'about:blank') view.webContents.focus();
    this.changed();
  }

  close(id: TabId): void {
    const index = this.indexOf(id);
    if (index < 0) return;
    const [tab] = this.tabs.splice(index, 1);

    this.closed.push(this.toSaved(tab));
    if (this.closed.length > MAX_CLOSED_TABS) this.closed.shift();
    this.destroyView(tab);

    if (this.activeId === id) {
      this.activeId = null;
      const neighbor = this.tabs[Math.min(index, this.tabs.length - 1)];
      if (neighbor) {
        this.activate(neighbor.id);
      } else {
        this.open();
      }
      return;
    }
    this.changed();
  }

  reopenClosed(): void {
    const saved = this.closed.pop();
    if (!saved) return;
    const tab = this.createRecord(saved);
    const index = this.activeId ? this.indexOf(this.activeId) + 1 : this.tabs.length;
    this.tabs.splice(index, 0, tab);
    this.activate(tab.id);
  }

  move(id: TabId, toIndex: number): void {
    const from = this.indexOf(id);
    if (from < 0) return;
    const [tab] = this.tabs.splice(from, 1);
    const target = Math.max(0, Math.min(toIndex, this.tabs.length));
    this.tabs.splice(target, 0, tab);
    this.changed();
  }

  /** Releases the page but keeps the tab and its history. The active tab is never discarded. */
  discard(id: TabId): boolean {
    const tab = this.find(id);
    if (!tab?.view || id === this.activeId) return false;
    tab.history = this.captureHistory(tab);
    this.destroyView(tab);
    this.changed();
    return true;
  }

  discardBackground(): number {
    let count = 0;
    for (const tab of this.tabs) {
      if (!tab.keepAlive && this.discard(tab.id)) count++;
    }
    return count;
  }

  toggleKeepAlive(id: TabId): void {
    const tab = this.find(id);
    if (!tab) return;
    tab.keepAlive = !tab.keepAlive;
    this.changed();
  }

  navigate(url: string): void {
    const tab = this.active();
    if (!tab) return;
    void this.ensureLive(tab).webContents.loadURL(url);
  }

  goBack(): void {
    const history = this.active()?.view?.webContents.navigationHistory;
    if (history?.canGoBack()) history.goBack();
  }

  goForward(): void {
    const history = this.active()?.view?.webContents.navigationHistory;
    if (history?.canGoForward()) history.goForward();
  }

  reload(): void {
    this.active()?.view?.webContents.reload();
  }

  toggleDevTools(): void {
    this.active()?.view?.webContents.toggleDevTools();
  }

  selectByIndex(index: number): void {
    const tab = index < 0 ? this.tabs.at(-1) : this.tabs[index];
    if (tab) this.activate(tab.id);
  }

  /** Restores a saved session with every tab discarded, then loads only the active one. */
  restore(session: SavedSession): void {
    for (const saved of session.tabs) {
      this.tabs.push(this.createRecord(saved));
    }
    const active = session.activeTabId ? this.find(session.activeTabId) : this.tabs[0];
    if (active) {
      this.activate(active.id);
    } else {
      this.open();
    }
  }

  toSession(): SavedSession {
    return {
      version: 1,
      activeTabId: this.activeId,
      tabs: this.tabs.map((tab) => this.toSaved(tab)),
    };
  }

  destroyAll(): void {
    for (const tab of this.tabs) this.destroyView(tab);
  }

  private createRecord(saved: Partial<SavedTab> & { url: string }): Tab {
    return {
      id: saved.id ?? randomUUID(),
      view: null,
      url: saved.url,
      title: saved.title ?? NEW_TAB_TITLE,
      faviconUrl: saved.faviconUrl ?? null,
      keepAlive: saved.keepAlive ?? false,
      loading: false,
      history: saved.history ?? null,
    };
  }

  private ensureLive(tab: Tab): WebContentsView {
    if (tab.view) return tab.view;

    const view = new WebContentsView({
      webPreferences: {
        session: this.options.session,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    tab.view = view;
    // Background tabs get real bounds too, so they lay out like visible pages.
    view.setBounds(this.pageBounds);
    this.attachListeners(tab, view);

    const history = tab.history;
    tab.history = null;
    if (history && history.entries.length > 0) {
      const startedAt = performance.now();
      view.webContents.navigationHistory
        .restore({ entries: history.entries, index: history.index })
        .then(() => {
          const ms = Math.round(performance.now() - startedAt);
          this.options.onRestore({ tabId: tab.id, url: history.entries[history.index]?.url ?? tab.url, ms });
        })
        .catch(() => {
          // The promise also rejects when a later navigation (e.g. going back
          // right after restore) aborts the load; fall back only if nothing was restored.
          const contents = view.webContents;
          if (!contents.isDestroyed() && contents.navigationHistory.length() === 0) {
            void contents.loadURL(tab.url);
          }
        });
    } else {
      void view.webContents.loadURL(tab.url);
    }
    return view;
  }

  private attachListeners(tab: Tab, view: WebContentsView): void {
    const contents = view.webContents;

    contents.setWindowOpenHandler(({ url }) => {
      this.open(url);
      return { action: 'deny' };
    });
    contents.on('page-title-updated', (_event, title) => {
      tab.title = title;
      this.changed();
    });
    contents.on('page-favicon-updated', (_event, favicons) => {
      tab.faviconUrl = favicons[0] ?? null;
      this.changed();
    });
    contents.on('did-start-loading', () => {
      tab.loading = true;
      this.changed();
    });
    contents.on('did-stop-loading', () => {
      tab.loading = false;
      this.changed();
    });
    const updateUrl = () => {
      tab.url = contents.getURL();
      this.changed();
    };
    contents.on('did-navigate', updateUrl);
    contents.on('did-navigate-in-page', updateUrl);
    contents.on('render-process-gone', () => {
      // Keep the tab discarded instead of reloading, so a crashing page cannot
      // cause a reload loop. Selecting it again recreates it from history.
      tab.history = this.captureHistory(tab);
      setImmediate(() => {
        this.destroyView(tab);
        this.changed();
      });
    });
  }

  private captureHistory(tab: Tab): SavedHistory | null {
    const history = tab.view?.webContents.navigationHistory;
    if (!history) return tab.history;
    const entries = history.getAllEntries();
    return entries.length > 0 ? { entries, index: history.getActiveIndex() } : tab.history;
  }

  private destroyView(tab: Tab): void {
    const view = tab.view;
    if (!view) return;
    tab.view = null;
    tab.loading = false;
    this.options.window.contentView.removeChildView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  }

  private toSaved(tab: Tab): SavedTab {
    return {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      faviconUrl: tab.faviconUrl,
      keepAlive: tab.keepAlive,
      history: this.captureHistory(tab),
    };
  }

  private snapshot(tab: Tab): TabSnapshot {
    const history = tab.view?.webContents.navigationHistory;
    return {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      faviconUrl: tab.faviconUrl,
      live: tab.view !== null,
      loading: tab.loading,
      keepAlive: tab.keepAlive,
      canGoBack: history?.canGoBack() ?? false,
      canGoForward: history?.canGoForward() ?? false,
    };
  }

  private active(): Tab | undefined {
    return this.activeId ? this.find(this.activeId) : undefined;
  }

  private find(id: TabId): Tab | undefined {
    return this.tabs.find((tab) => tab.id === id);
  }

  private indexOf(id: TabId): number {
    return this.tabs.findIndex((tab) => tab.id === id);
  }

  private changed(): void {
    this.options.onChange();
  }
}
