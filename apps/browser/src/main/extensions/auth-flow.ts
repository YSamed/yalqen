import { WebContentsView, type Session } from 'electron';
import { authRedirectExtension } from '../../shared/extension-bridge.js';
import { signInUserAgent } from '../app/page-preferences.js';

export const SILENT_AUTH_MAX_MS = 60_000;
const INTERACTION_REQUIRED = 'User interaction required.';
const LOAD_FAILED = 'Authorization page could not be loaded.';
const ERR_ABORTED = -3;

export interface SilentAuthOptions {
  url: string;
  abortOnLoad: boolean;
  timeoutMs: number;
}

export function silentAuthOptions(details: unknown): SilentAuthOptions {
  const { url, abortOnLoadForNonInteractive, timeoutMsForNonInteractive } = (
    typeof details === 'object' && details !== null ? details : {}
  ) as Record<string, unknown>;
  let parsed: URL | null;
  try {
    parsed = typeof url === 'string' ? new URL(url) : null;
  } catch {
    parsed = null;
  }
  if (!parsed || !isWeb(parsed.href)) throw new Error('Authorization url must be http or https');
  const timeout =
    typeof timeoutMsForNonInteractive === 'number' && timeoutMsForNonInteractive > 0
      ? timeoutMsForNonInteractive
      : SILENT_AUTH_MAX_MS;
  return {
    url: parsed.href,
    abortOnLoad: abortOnLoadForNonInteractive !== false,
    timeoutMs: Math.min(timeout, SILENT_AUTH_MAX_MS),
  };
}

function isWeb(url: string): boolean {
  return url.startsWith('http:') || url.startsWith('https:');
}

// Chrome's non-interactive launchWebAuthFlow: a hidden page that must redirect to the extension without user input.
export class SilentAuthFlows {
  private readonly running = new Map<string, () => void>();

  constructor(private readonly session: Session) {}

  cancel(extensionId: string): void {
    this.running.get(extensionId)?.();
  }

  launch(extensionId: string, details: unknown): Promise<string> {
    const { url, abortOnLoad, timeoutMs } = silentAuthOptions(details);
    this.cancel(extensionId);
    return new Promise((resolve, reject) => {
      const view = new WebContentsView({ webPreferences: { session: this.session, sandbox: true } });
      const contents = view.webContents;
      const blockDownload = (event: Electron.Event, _item: Electron.DownloadItem, source: Electron.WebContents) => {
        if (source === contents) event.preventDefault();
      };
      const finish = (result: string | Error) => {
        if (this.running.get(extensionId) !== fail) return;
        this.running.delete(extensionId);
        clearTimeout(timer);
        this.session.off('will-download', blockDownload);
        if (!view.webContents.isDestroyed()) view.webContents.close();
        if (typeof result === 'string') resolve(result);
        else reject(result);
      };
      const fail = () => finish(new Error(INTERACTION_REQUIRED));
      this.running.set(extensionId, fail);
      const timer = setTimeout(fail, timeoutMs);
      const navigate = (event: Electron.Event<{ url: string; isMainFrame: boolean }>) => {
        const owner = authRedirectExtension(event.url);
        if (event.isMainFrame && owner === extensionId) {
          event.preventDefault();
          finish(event.url);
        } else if (owner || !isWeb(event.url)) {
          event.preventDefault();
          fail();
        }
      };
      // shortcut: permission prompts and subframe external-protocol prompts still reach the shared session handlers, deny them per view if a silent flow ever triggers one.
      this.session.on('will-download', blockDownload);
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.setAudioMuted(true);
      // shortcut: the Google sign-in user agent is set only when the flow starts there, follow tabs.ts if a redirect into Google needs it.
      contents.setUserAgent(signInUserAgent(url, process.platform) ?? this.session.getUserAgent());
      contents.on('will-navigate', navigate);
      contents.on('will-redirect', navigate);
      contents.on('did-fail-load', (_event, code, _description, _url, isMainFrame) => {
        if (isMainFrame && code !== ERR_ABORTED) finish(new Error(LOAD_FAILED));
      });
      if (abortOnLoad) contents.on('did-stop-loading', fail);
      contents.loadURL(url).catch(() => {});
    });
  }
}
