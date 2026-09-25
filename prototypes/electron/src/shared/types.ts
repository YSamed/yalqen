export type TabId = string;

/** Tab data exposed to the UI. A tab can exist without a live page. */
export interface TabSnapshot {
  id: TabId;
  title: string;
  url: string;
  faviconUrl: string | null;
  live: boolean;
  loading: boolean;
  keepAlive: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserState {
  tabs: TabSnapshot[];
  activeTabId: TabId | null;
  totalMemoryMB: number | null;
  addressPlaceholder: string;
}

/** Regions of the window reserved for the UI; the page view fills the rest. */
export interface ChromeLayout {
  toolbarHeight: number;
  panelWidth: number;
}

export type UiCommand =
  | { type: 'toggle-panel' }
  | { type: 'focus-address' };

/** Requests the UI sends to the main process. */
export type UiAction =
  | { type: 'new-tab'; url?: string }
  | { type: 'activate-tab'; id: TabId }
  | { type: 'close-tab'; id: TabId }
  | { type: 'discard-tab'; id: TabId }
  | { type: 'toggle-keep-alive'; id: TabId }
  | { type: 'move-tab'; id: TabId; toIndex: number }
  | { type: 'navigate'; input: string }
  | { type: 'go-back' }
  | { type: 'go-forward' }
  | { type: 'reload' };

export const IpcChannel = {
  getState: 'yalqen:get-state',
  state: 'yalqen:state',
  command: 'yalqen:command',
  setLayout: 'yalqen:set-layout',
  action: 'yalqen:action',
} as const;

/** API exposed to the UI renderer by the preload script. */
export interface YalqenApi {
  getState(): Promise<BrowserState>;
  onState(listener: (state: BrowserState) => void): () => void;
  onCommand(listener: (command: UiCommand) => void): () => void;
  setLayout(layout: ChromeLayout): void;
  send(action: UiAction): void;
}
