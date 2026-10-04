import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IpcChannel as channel,
  type BrowserState,
  type AgentSessionState,
  type AgentTerminalSnapshot,
  type AgentChatSnapshot,
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
  removeAgentElement: (id) => ipcRenderer.invoke(channel.agentElementRemove, id) as Promise<void>,
  highlightAgentElement: (id) => ipcRenderer.invoke(channel.agentElementHighlight, id) as Promise<boolean>,
  startProjectRun: () => ipcRenderer.invoke(channel.projectRunStart) as Promise<boolean>,
  stopProjectRun: () => ipcRenderer.invoke(channel.projectRunStop) as Promise<void>,
  getAgentChat: () => ipcRenderer.invoke(channel.agentChatSnapshot) as Promise<AgentChatSnapshot | null>,
  sendAgentChat: (id, text, tabId) => ipcRenderer.invoke(channel.agentChatSend, id, text, tabId) as Promise<boolean>,
  interruptAgentChat: (id) => ipcRenderer.invoke(channel.agentChatInterrupt, id) as Promise<void>,
  resetAgentChat: (id) => ipcRenderer.invoke(channel.agentChatReset, id) as Promise<void>,
  respondAgentChat: (id, requestId, allow, answers, always) =>
    ipcRenderer.invoke(channel.agentChatPermission, id, requestId, allow, answers, always) as Promise<void>,
  configureAgentChat: (id, settings) => ipcRenderer.invoke(channel.agentChatConfigure, id, settings) as Promise<void>,
  cancelQueuedAgentChat: (id, messageId) =>
    ipcRenderer.invoke(channel.agentChatCancelQueued, id, messageId) as Promise<void>,
  onAgentChat: (listener) => subscribe<string>(channel.agentChatUpdate, listener),
};

contextBridge.exposeInMainWorld('yalqen', api);
