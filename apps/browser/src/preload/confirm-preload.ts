import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { ConfirmChannel as channel, type ConfirmApi, type ConfirmOpen } from '../shared/types.js';

const api: ConfirmApi = {
  onOpen: (listener) => {
    const handler = (_event: IpcRendererEvent, open: ConfirmOpen) => listener(open);
    ipcRenderer.on(channel.open, handler);
    return () => ipcRenderer.off(channel.open, handler);
  },
  answer: (confirmed) => ipcRenderer.send(channel.answer, confirmed === true),
};

contextBridge.exposeInMainWorld('yalqenConfirm', api);
