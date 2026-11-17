import { contextBridge } from 'electron';

function hideChromiumApis(): void {
  if (!navigator.userAgent.includes(' Firefox/')) return;
  delete (Navigator.prototype as { userAgentData?: unknown }).userAgentData;
  delete (window as { chrome?: unknown }).chrome;
}

export function setupGoogleSignInPage(): void {
  contextBridge.executeInMainWorld({ func: hideChromiumApis });
}
