import type { Session, WebContents } from 'electron';
import type { ExtensionBridgeEvent } from '../../shared/extension-bridge.js';
import { extensionPage, sidePanelPage, type Manifest } from './extension-manifest.js';

export interface SidePanelHost {
  openSidePanel(extensionId: string, url: string, windowId: number | null): WebContents | null;
  closeSidePanel(extensionId: string, windowId: number | null): void;
  sidePanelOpen(extensionId: string, windowId: number): boolean;
  refreshSidePanel(windowId: number): void;
  windowId(contents: WebContents): number;
  isActive(contents: WebContents): boolean;
}

type Deliver = (extensionId: string, name: ExtensionBridgeEvent, args: unknown[]) => void;

interface PanelOptions {
  path?: string;
  enabled?: boolean;
}

type Details = Record<string, unknown>;
const details = (value: unknown): Details => (typeof value === 'object' && value !== null ? (value as Details) : {});

export function ownPage(baseUrl: string, path: unknown): string | null {
  if (typeof path !== 'string' || !path) return null;
  const url = extensionPage(baseUrl, path);
  return url?.startsWith(baseUrl) ? url : null;
}

// Side panel options live here; the panel views live in each window and are opened through the host.
export class SidePanelApi {
  private readonly options = new Map<string, PanelOptions>();
  private readonly openOnAction = new Set<string>();
  private readonly panels = new Set<WebContents>();

  constructor(
    private readonly session: Session,
    private readonly host: SidePanelHost,
    private readonly deliver: Deliver,
    private readonly tabContents: (id: number) => WebContents | null,
  ) {}

  forget(extensionId: string): void {
    this.host.closeSidePanel(extensionId, null);
    for (const key of [...this.options.keys()]) if (key.split(':')[0] === extensionId) this.options.delete(key);
    this.openOnAction.delete(extensionId);
  }

  dropTab(tabId: number): void {
    for (const key of [...this.options.keys()]) if (key.endsWith(`:${tabId}`)) this.options.delete(key);
  }

  panelUrl(extensionId: string, tab: WebContents | null): string | null {
    const extension = this.session.extensions.getExtension(extensionId);
    if (!extension) return null;
    const global = this.options.get(extensionId);
    const own = tab ? this.options.get(`${extensionId}:${tab.id}`) : undefined;
    const enabled = own?.enabled ?? global?.enabled ?? true;
    const path = own?.path ?? global?.path ?? sidePanelPage(extension.manifest as Manifest);
    return enabled && path ? ownPage(extension.url, path) : null;
  }

  opensOnAction(extensionId: string): boolean {
    return this.openOnAction.has(extensionId);
  }

  toggle(extensionId: string, windowId: number, tab: WebContents | null): void {
    if (this.host.sidePanelOpen(extensionId, windowId)) this.host.closeSidePanel(extensionId, windowId);
    else this.open(extensionId, windowId, tab);
  }

  call(extensionId: string, method: string, args: unknown[]): unknown {
    const [first] = args;
    const { tabId, windowId, path, enabled, openPanelOnActionClick } = details(first);
    const tab = typeof tabId === 'number' ? this.tabContents(tabId) : null;
    if (typeof tabId === 'number' && !tab) throw new Error(`No tab with id: ${tabId}.`);
    const key = tab ? `${extensionId}:${tab.id}` : extensionId;
    switch (method) {
      case 'setOptions': {
        const next = { ...this.options.get(key) };
        if (path !== undefined) {
          if (!ownPage(this.extensionUrl(extensionId), path)) throw new Error('Invalid path.');
          next.path = path as string;
        }
        if (typeof enabled === 'boolean') next.enabled = enabled;
        this.options.set(key, next);
        if (next.enabled === false && !tab) this.host.closeSidePanel(extensionId, null);
        if (tab && this.host.isActive(tab)) {
          const window = this.host.windowId(tab);
          if (this.host.sidePanelOpen(extensionId, window)) this.host.refreshSidePanel(window);
        }
        return undefined;
      }
      case 'getOptions': {
        const manifest = (this.session.extensions.getExtension(extensionId)?.manifest ?? {}) as Manifest;
        const own = this.options.get(key);
        const global = this.options.get(extensionId);
        const current = own?.path ?? global?.path ?? sidePanelPage(manifest);
        return {
          enabled: own?.enabled ?? global?.enabled ?? true,
          ...(current ? { path: current } : {}),
          ...(tab ? { tabId } : {}),
        };
      }
      case 'setPanelBehavior':
        if (openPanelOnActionClick === true) this.openOnAction.add(extensionId);
        else if (openPanelOnActionClick === false) this.openOnAction.delete(extensionId);
        return undefined;
      case 'getPanelBehavior':
        return { openPanelOnActionClick: this.openOnAction.has(extensionId) };
      case 'open':
      case 'close': {
        const target = tab ? this.host.windowId(tab) : typeof windowId === 'number' ? windowId : null;
        if (target === null) throw new Error('No windowId or tabId given.');
        if (method === 'close') this.host.closeSidePanel(extensionId, target);
        else this.open(extensionId, target, tab);
        return undefined;
      }
    }
    throw new Error(`Unsupported sidePanel method: ${method}`);
  }

  private open(extensionId: string, windowId: number, tab: WebContents | null): void {
    const url = this.panelUrl(extensionId, tab);
    if (!url) throw new Error('No active side panel for this window or tab.');
    const contents = this.host.openSidePanel(extensionId, url, windowId);
    if (!contents) throw new Error(`No window with id: ${windowId}.`);
    const path = new URL(url).pathname.slice(1);
    if (!this.panels.has(contents)) {
      this.panels.add(contents);
      contents.once('destroyed', () => {
        this.panels.delete(contents);
        this.deliver(extensionId, 'sidePanel.onClosed', [{ windowId, path }]);
      });
    }
    this.deliver(extensionId, 'sidePanel.onOpened', [{ windowId, path }]);
  }

  private extensionUrl(extensionId: string): string {
    const extension = this.session.extensions.getExtension(extensionId);
    if (!extension) throw new Error('Unknown extension');
    return extension.url;
  }
}
