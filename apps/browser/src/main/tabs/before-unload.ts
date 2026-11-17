import type { EventEmitter } from 'node:events';
import type { Event, WebContents } from 'electron';

const CHECK_TIMEOUT_MS = 15_000;
const checks = new WeakMap<WebContents, Promise<boolean>>();
const NOOP_LISTENER = "window.addEventListener('beforeunload', () => {}, { once: true }); true";

export function checkBeforeUnload(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed() || contents.getURL() === '') return Promise.resolve(true);
  const pending = checks.get(contents);
  if (pending) return pending;
  const events = contents as unknown as EventEmitter;
  const check = new Promise<boolean>((resolve) => {
    let finished = false;
    const finish = (allowed: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      events.off('-before-unload-fired', fired);
      events.off('destroyed', destroyed);
      resolve(allowed);
    };
    const fired = (event: Event, proceed: boolean) => {
      event.preventDefault();
      finish(proceed);
    };
    const destroyed = () => finish(true);
    const timer = setTimeout(() => finish(false), CHECK_TIMEOUT_MS);
    events.once('-before-unload-fired', fired);
    events.once('destroyed', destroyed);
    void addNoopListener(contents)
      .then(() => {
        if (finished) return;
        if (contents.isDestroyed()) finish(true);
        else contents.close({ waitForBeforeUnload: true });
      })
      .catch(() => finish(contents.isDestroyed()));
  });
  checks.set(contents, check);
  void check.finally(() => checks.delete(contents));
  return check;
}

async function addNoopListener(contents: WebContents): Promise<unknown> {
  if (!contents.isLoadingMainFrame()) {
    return contents.executeJavaScriptInIsolatedWorld(1010, [{ code: NOOP_LISTENER }]);
  }
  return contents.mainFrame
    .executeJavaScript(NOOP_LISTENER)
    .catch(() => contents.mainFrame.executeJavaScript(NOOP_LISTENER));
}
