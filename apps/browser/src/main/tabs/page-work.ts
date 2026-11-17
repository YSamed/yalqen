import type { WebContents } from 'electron';

const busy = new WeakSet<WebContents>();

export function pageWorkBusy(contents: WebContents): boolean {
  return busy.has(contents);
}

export function acquirePageWork(contents: WebContents): (() => void) | null {
  if (busy.has(contents)) return null;
  busy.add(contents);
  return () => busy.delete(contents);
}
