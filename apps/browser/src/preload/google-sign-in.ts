import { contextBridge } from 'electron';

// The tab presents a Firefox user agent here, so Chromium-only APIs would contradict it. This must run
// synchronously, before the page's own scripts read them.
function hideChromiumApis(): void {
  if (!navigator.userAgent.includes(' Firefox/')) return;
  delete (Navigator.prototype as { userAgentData?: unknown }).userAgentData;
  delete (window as { chrome?: unknown }).chrome;
}

export function setupGoogleSignInPage(): void {
  contextBridge.executeInMainWorld({ func: hideChromiumApis });
}
