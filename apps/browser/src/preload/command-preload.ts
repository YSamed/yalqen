import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  CommandBarChannel as channel,
  type CommandBarAction,
  type CommandBarApi,
  type CommandBarArea,
  type CommandBarOpen,
  type CommandBarSuggestions,
} from '../shared/types.js';

const api: CommandBarApi = {
  onOpen: (listener) => {
    const handler = (_event: IpcRendererEvent, open: CommandBarOpen) => listener(open);
    ipcRenderer.on(channel.open, handler);
    return () => ipcRenderer.off(channel.open, handler);
  },
  onSuggestions: (listener) => {
    const handler = (_event: IpcRendererEvent, suggestions: CommandBarSuggestions) => listener(suggestions);
    ipcRenderer.on(channel.suggestions, handler);
    return () => ipcRenderer.off(channel.suggestions, handler);
  },
  onArea: (listener) => {
    const handler = (_event: IpcRendererEvent, area: CommandBarArea) => listener(area);
    ipcRenderer.on(channel.area, handler);
    return () => ipcRenderer.off(channel.area, handler);
  },
  send: (action: CommandBarAction) => ipcRenderer.send(channel.action, action),
};

contextBridge.exposeInMainWorld('yalqenCommand', api);
