import { webFrame } from 'electron';
import { MediaSessionEvent } from '../shared/sidebar-widgets.js';

// Runs in the page's own world before its scripts: remembers the track handlers the page gives its
// Media Session, reports which exist, and calls one when the sidebar player asks.
const PAGE_SCRIPT = `(() => {
  if (!('mediaSession' in navigator)) return;
  const handlers = new Map();
  const setActionHandler = MediaSession.prototype.setActionHandler;
  MediaSession.prototype.setActionHandler = function (action, handler) {
    setActionHandler.call(this, action, handler);
    if (action !== 'previoustrack' && action !== 'nexttrack') return;
    if (typeof handler === 'function') handlers.set(action, handler);
    else handlers.delete(action);
  };
  window.addEventListener('${MediaSessionEvent.query}', () => {
    window.dispatchEvent(new CustomEvent('${MediaSessionEvent.actions}', { detail: [...handlers.keys()].join(',') }));
  });
  window.addEventListener('${MediaSessionEvent.run}', (event) => {
    handlers.get(event.detail)?.({ action: event.detail });
  });
})()`;

export function setupMediaSession(): void {
  void webFrame.executeJavaScript(PAGE_SCRIPT);
}
