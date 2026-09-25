import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { SettingsApi, SettingsChannel, SettingsValues, SettingsView } from '../shared/types.js';

// Sandboxed preloads cannot require local modules, so channel names are
// repeated here and checked against the shared definition at compile time.
const channel: typeof SettingsChannel = {
  get: 'yalqen-settings:get',
  update: 'yalqen-settings:update',
  changed: 'yalqen-settings:changed',
};

const api: SettingsApi = {
  get: () => ipcRenderer.invoke(channel.get) as Promise<SettingsView>,
  update: (patch: Partial<SettingsValues>) =>
    ipcRenderer.invoke(channel.update, patch) as Promise<SettingsView>,
  onChange: (listener) => {
    const handler = (_event: IpcRendererEvent, view: SettingsView) => listener(view);
    ipcRenderer.on(channel.changed, handler);
    return () => ipcRenderer.off(channel.changed, handler);
  },
};

contextBridge.exposeInMainWorld('yalqenSettings', api);
