import type { WebContents } from 'electron';

// Browser checks and agent actions share the page. Keep a viewport sweep from
// changing the layout underneath a click or a flow assertion.
const busy = new WeakSet<WebContents>();

export function pageWorkBusy(contents: WebContents): boolean {
  return busy.has(contents);
}

export function acquirePageWork(contents: WebContents): (() => void) | null {
  if (busy.has(contents)) return null;
  busy.add(contents);
  return () => busy.delete(contents);
}
