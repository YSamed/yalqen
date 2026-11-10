import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { PeekChannel as channel, type PeekApi, type PeekState } from '../shared/types.js';

const api: PeekApi = {
  onUpdate: (listener) => {
    const handler = (_event: IpcRendererEvent, state: PeekState) => listener(state);
    ipcRenderer.on(channel.update, handler);
    return () => ipcRenderer.off(channel.update, handler);
  },
  send: (action) => ipcRenderer.send(channel.action, action),
};

contextBridge.exposeInMainWorld('yalqenPeek', api);
