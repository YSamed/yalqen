import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IpcChannel as channel,
  type BrowserState,
  type ChromeLayout,
  type UiAction,
  type Wallpaper,
  type YalqenApi,
} from '../shared/types.js';

function subscribe<T>(name: string, listener: (value: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(name, handler);
  return () => ipcRenderer.off(name, handler);
}

const api: YalqenApi = {
  getState: () => ipcRenderer.invoke(channel.getState) as Promise<BrowserState>,
  onState: (listener) => subscribe<string>(channel.state, listener),
  onWallpaper: (listener) => subscribe<Wallpaper | null>(channel.wallpaper, listener),
  setLayout: (layout: ChromeLayout) => ipcRenderer.send(channel.setLayout, layout),
  send: (action: UiAction) => ipcRenderer.send(channel.action, action),
};

contextBridge.exposeInMainWorld('yalqen', api);
