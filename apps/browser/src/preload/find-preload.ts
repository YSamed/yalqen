import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { FindBarChannel as channel, type FindBarAction, type FindBarApi, type FindResult } from '../shared/types.js';

const api: FindBarApi = {
  onOpen: (listener) => {
    const handler = (_event: IpcRendererEvent, tint: unknown) => listener(typeof tint === 'string' ? tint : null);
    ipcRenderer.on(channel.open, handler);
    return () => ipcRenderer.off(channel.open, handler);
  },
  onResult: (listener) => {
    const handler = (_event: IpcRendererEvent, result: FindResult) => listener(result);
    ipcRenderer.on(channel.result, handler);
    return () => ipcRenderer.off(channel.result, handler);
  },
  send: (action: FindBarAction) => ipcRenderer.send(channel.action, action),
};

contextBridge.exposeInMainWorld('yalqenFind', api);
