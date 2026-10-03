import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IpcChannel as channel,
  type BrowserState,
  type AgentSessionState,
  type AgentTerminalSnapshot,
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
  getAgentTerminal: () => ipcRenderer.invoke(channel.agentSnapshot) as Promise<AgentTerminalSnapshot | null>,
  selectAgentDirectory: () => ipcRenderer.invoke(channel.agentSelectDirectory) as Promise<AgentSessionState | null>,
  startAgentSession: (size) => ipcRenderer.invoke(channel.agentStart, size) as Promise<AgentSessionState | null>,
  stopAgentSession: (sessionId) => ipcRenderer.invoke(channel.agentStop, sessionId) as Promise<void>,
  writeAgentTerminal: (sessionId, data) => ipcRenderer.send(channel.agentInput, sessionId, data),
  resizeAgentTerminal: (sessionId, size) => ipcRenderer.send(channel.agentResize, sessionId, size),
  onAgentOutput: (listener) => subscribe(channel.agentOutput, listener),
};

contextBridge.exposeInMainWorld('yalqen', api);
