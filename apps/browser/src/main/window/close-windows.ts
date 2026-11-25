import type { BaseWindow, Event } from 'electron';
import type { CloseApproval, TabManager } from '../tabs/tabs.js';

export interface ClosingWindow {
  tabs: Pick<TabManager, 'confirmCloseAll'>;
  setCloseApproval(approval: CloseApproval | null): void;
}

export class WindowClose {
  private approval: CloseApproval | null = null;
  private pending = false;

  constructor(
    private readonly window: Pick<BaseWindow, 'close' | 'isDestroyed'>,
    private readonly tabs: ClosingWindow['tabs'],
  ) {}

  setApproval(approval: CloseApproval | null): void {
    this.approval = approval;
  }

  handle(event: Pick<Event, 'preventDefault'>): boolean {
    const approval = this.approval;
    this.approval = null;
    if (approval?.()) return true;

    event.preventDefault();
    if (approval || this.pending) return false;
    this.pending = true;
    void this.tabs.confirmCloseAll().then((approved) => {
      this.pending = false;
      if (!approved || this.window.isDestroyed()) return;
      this.approval ??= approved;
      this.window.close();
    });
    return false;
  }
}

export async function confirmWindowsClose(
  windows: readonly ClosingWindow[],
  beforeClose: () => Promise<void>,
  onInvalidated: () => void,
): Promise<boolean> {
  const open = [...windows];
  const approvals: CloseApproval[] = [];
  for (const window of open) {
    const approved = await window.tabs.confirmCloseAll();
    if (!approved) return false;
    approvals.push(approved);
  }

  const allApproved = () =>
    open.length === windows.length && open.every((window, index) => windows[index] === window && approvals[index]());
  if (!allApproved()) return false;
  await beforeClose();
  if (!allApproved()) return false;

  let closing = false;
  for (const [index, window] of open.entries()) {
    window.setCloseApproval(() => {
      // The first close checks every window. Later closes can validate only the ones still open.
      if (closing ? approvals[index]() : allApproved()) {
        closing = true;
        return true;
      }
      for (const openWindow of open) openWindow.setCloseApproval(null);
      onInvalidated();
      return false;
    });
  }
  return true;
}
