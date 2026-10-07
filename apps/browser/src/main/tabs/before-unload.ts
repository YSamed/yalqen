import type { EventEmitter } from 'node:events';
import type { Event, WebContents } from 'electron';

const CHECK_TIMEOUT_MS = 15_000;
const checks = new WeakMap<WebContents, Promise<boolean>>();

// Electron 44 emits this after Chromium runs every frame's beforeunload handlers.
// Vetoing it checks consent without destroying tabs, preserving all pages when
// a window/quit request is cancelled. Keep the Electron runtime test on upgrades.
export function checkBeforeUnload(contents: WebContents): Promise<boolean> {
  if (contents.isDestroyed()) return Promise.resolve(true);
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
    // An unresponsive page must never implicitly lose its unsaved work.
    const timer = setTimeout(() => finish(false), CHECK_TIMEOUT_MS);
    events.once('-before-unload-fired', fired);
    events.once('destroyed', destroyed);
    // Without any unload listener Electron skips the vetoable event and closes
    // immediately. A one-shot noop in an isolated world keeps clean pages alive too.
    void contents
      .executeJavaScriptInIsolatedWorld(1010, [
        {
          code: "window.addEventListener('beforeunload', () => {}, { once: true }); true",
        },
      ])
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
