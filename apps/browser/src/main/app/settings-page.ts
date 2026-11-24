import { ipcMain, webContents, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  AutofillChannel,
  ExtensionsChannel,
  PasswordsChannel,
  SETTINGS_URL,
  SettingsChannel,
  type ExtensionInfo,
  type PasswordsView,
  type SettingsView,
} from '../../shared/types.js';
import { AgentBridgeChannel, type AgentBridgeView } from '../../shared/agent.js';

const settings = new URL(SETTINGS_URL);

function isSettingsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === settings.protocol && parsed.host === settings.host;
  } catch {
    return false;
  }
}

export function isSettingsFrame(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  return !!frame && frame === event.sender.mainFrame && isSettingsUrl(frame.url);
}

export function handleSettingsCall(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => (isSettingsFrame(event) ? listener(event, ...args) : null));
}

// Settings pages opened for one profile carry ?space=<id>; the Passwords, Autofill and Sites panes act on that profile.
export function settingsSpace(contents: WebContents): string | null {
  const url = contents.mainFrame.url;
  return isSettingsUrl(url) ? (new URL(url).searchParams.get('space') ?? '') : null;
}

function broadcastEach(channel: string, valueFor: (contents: WebContents) => unknown): void {
  for (const contents of webContents.getAllWebContents()) {
    if (contents.isDestroyed() || !isSettingsUrl(contents.mainFrame.url)) continue;
    const value = valueFor(contents);
    if (value !== null) contents.send(channel, value);
  }
}

function broadcast(channel: string, value: unknown): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!contents.isDestroyed() && isSettingsUrl(contents.mainFrame.url)) contents.send(channel, value);
  }
}

export function broadcastSettings(view: SettingsView): void {
  broadcast(SettingsChannel.changed, view);
}

export function broadcastExtensions(extensions: ExtensionInfo[]): void {
  broadcast(ExtensionsChannel.changed, extensions);
}

export function broadcastAgentBridge(view: AgentBridgeView): void {
  broadcast(AgentBridgeChannel.changed, view);
}

export function broadcastPasswords(viewFor: (contents: WebContents) => PasswordsView | null): void {
  broadcastEach(PasswordsChannel.changed, viewFor);
}

export function broadcastAutofill(
  viewFor: (contents: WebContents) => import('../../shared/autofill.js').AutofillView | null,
): void {
  broadcastEach(AutofillChannel.changed, viewFor);
}
