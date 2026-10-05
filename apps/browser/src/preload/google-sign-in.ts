import { webFrame } from 'electron';

// The tab presents a Firefox user agent here, so Chromium-only APIs would contradict it.
const PAGE_SCRIPT = `delete Navigator.prototype.userAgentData; delete window.chrome;`;

export function setupGoogleSignInPage(): void {
  void webFrame.executeJavaScript(PAGE_SCRIPT);
}
