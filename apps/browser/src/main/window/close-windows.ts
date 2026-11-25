import type { CloseApproval, TabManager } from '../tabs/tabs.js';

interface ClosingWindow {
  tabs: Pick<TabManager, 'confirmCloseAll'>;
  setCloseApproval(approval: CloseApproval | null): void;
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
