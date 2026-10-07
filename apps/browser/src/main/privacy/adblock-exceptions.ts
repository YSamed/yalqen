import type { ElectronBlocker } from '@ghostery/adblocker-electron';
import type { Session, WebContents } from 'electron';

// Inspect the actual top-level page, not a frame's claimed URL or a request's referrer.
// This bypass covers network blocking, CSP, cosmetic CSS and scriptlets together.
export function applyAdBlockExceptions(
  blocker: ElectronBlocker,
  allowed: (session: Session, url: string) => boolean,
): void {
  const exempt = (contents: WebContents | null | undefined): boolean =>
    !!contents && !contents.isDestroyed() && allowed(contents.session, contents.getURL());
  const beforeRequest = blocker.onBeforeRequest;
  blocker.onBeforeRequest = (details, callback) => {
    if (exempt(details.webContents)) callback({});
    else beforeRequest(details, callback);
  };
  const headersReceived = blocker.onHeadersReceived;
  blocker.onHeadersReceived = (details, callback) => {
    if (exempt(details.webContents)) callback({});
    else headersReceived(details, callback);
  };
  const inject = blocker.onInjectCosmeticFilters;
  blocker.onInjectCosmeticFilters = (event, url, message) =>
    exempt(event.sender) ? Promise.resolve() : inject(event, url, message);
  const observe = blocker.onIsMutationObserverEnabled;
  blocker.onIsMutationObserverEnabled = (event) => (exempt(event.sender) ? Promise.resolve(false) : observe(event));
}
