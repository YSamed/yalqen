import { webContents, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron';
import {
  ExtensionsChannel,
  PasswordsChannel,
  SETTINGS_URL,
  SettingsChannel,
  type ExtensionInfo,
  type PasswordsView,
  type SettingsView,
} from '../shared/types.js';

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

export function broadcastPasswords(view: PasswordsView): void {
  broadcast(PasswordsChannel.changed, view);
}
