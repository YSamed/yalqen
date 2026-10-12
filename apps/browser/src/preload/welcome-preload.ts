import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  WelcomeChannel as channel,
  type WelcomeAction,
  type WelcomeApi,
  type WelcomeImportRequest,
  type WelcomeImportResult,
  type WelcomeOpen,
} from '../shared/types.js';

const api: WelcomeApi = {
  onOpen: (listener) => {
    const handler = (_event: IpcRendererEvent, open: WelcomeOpen) => listener(open);
    ipcRenderer.on(channel.open, handler);
    return () => ipcRenderer.off(channel.open, handler);
  },
  send: (action: WelcomeAction) => ipcRenderer.send(channel.action, action),
  importFrom: (request: WelcomeImportRequest) =>
    ipcRenderer.invoke(channel.import, request) as Promise<WelcomeImportResult>,
};

contextBridge.exposeInMainWorld('yalqenWelcome', api);
