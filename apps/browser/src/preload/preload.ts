import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import {
  IpcChannel as channel,
  type BrowserState,
  type AgentSessionState,
  type AgentTerminalSnapshot,
  type AgentChatSession,
  type AgentChatSnapshot,
  type AgentRewindPreview,
  type ChromeLayout,
  type UiAction,
  type Wallpaper,
  type YalqenApi,
} from '../shared/types.js';
import type { VisualComparisonPreview, VisualComparisonReview } from '../shared/visual-comparison.js';
import type { ResponsiveScanPreview, ResponsiveScanReview } from '../shared/responsive-scan.js';

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
  sendAgentChat: (id, text, tabIds, images) =>
    ipcRenderer.invoke(channel.agentChatSend, id, text, tabIds, images) as Promise<boolean>,
  getVisualComparison: () => ipcRenderer.invoke(channel.visualComparisonGet) as Promise<VisualComparisonPreview | null>,
  captureVisualComparison: (stage, tabId) =>
    ipcRenderer.invoke(channel.visualComparisonCapture, stage, tabId) as Promise<VisualComparisonPreview>,
  clearVisualComparison: () => ipcRenderer.invoke(channel.visualComparisonClear) as Promise<void>,
  getVisualComparisonReview: () =>
    ipcRenderer.invoke(channel.visualComparisonReview) as Promise<VisualComparisonReview | null>,
  getResponsiveScan: () => ipcRenderer.invoke(channel.responsiveScanGet) as Promise<ResponsiveScanPreview | null>,
  runResponsiveScan: (tabId) => ipcRenderer.invoke(channel.responsiveScanRun, tabId) as Promise<ResponsiveScanPreview>,
  cancelResponsiveScan: () => ipcRenderer.invoke(channel.responsiveScanCancel) as Promise<void>,
  clearResponsiveScan: () => ipcRenderer.invoke(channel.responsiveScanClear) as Promise<void>,
  getResponsiveScanReview: () =>
    ipcRenderer.invoke(channel.responsiveScanReview) as Promise<ResponsiveScanReview | null>,
  fixAgentEpisode: (tabId) => ipcRenderer.invoke(channel.agentChatFix, tabId) as Promise<boolean>,
  interruptAgentChat: (id) => ipcRenderer.invoke(channel.agentChatInterrupt, id) as Promise<void>,
  resetAgentChat: (id) => ipcRenderer.invoke(channel.agentChatReset, id) as Promise<void>,
  respondAgentChat: (id, requestId, allow, answers, always) =>
    ipcRenderer.invoke(channel.agentChatPermission, id, requestId, allow, answers, always) as Promise<void>,
  configureAgentChat: (id, settings) => ipcRenderer.invoke(channel.agentChatConfigure, id, settings) as Promise<void>,
  rewindAgentChat: (id, messageId, dryRun) =>
    ipcRenderer.invoke(channel.agentChatRewind, id, messageId, dryRun) as Promise<AgentRewindPreview | null>,
  openAgentFile: (path) => ipcRenderer.invoke(channel.agentChatOpenFile, path) as Promise<boolean>,
  listAgentChats: () => ipcRenderer.invoke(channel.agentChatHistory) as Promise<AgentChatSession[]>,
  openAgentChat: (sessionId, fork) => ipcRenderer.invoke(channel.agentChatOpen, sessionId, fork) as Promise<boolean>,
  deleteAgentChat: (sessionId) => ipcRenderer.invoke(channel.agentChatDelete, sessionId) as Promise<boolean>,
  searchAgentFiles: (query) => ipcRenderer.invoke(channel.agentChatFiles, query) as Promise<string[]>,
  selectAgentProvider: (provider) => ipcRenderer.invoke(channel.agentChatProvider, provider) as Promise<boolean>,
  newAgentProject: () => ipcRenderer.invoke(channel.agentProjectAdd) as Promise<boolean>,
  selectAgentProject: (id) => ipcRenderer.invoke(channel.agentProjectSelect, id) as Promise<boolean>,
  closeAgentProject: (id) => ipcRenderer.invoke(channel.agentProjectClose, id) as Promise<boolean>,
  cancelQueuedAgentChat: (id, messageId) =>
    ipcRenderer.invoke(channel.agentChatCancelQueued, id, messageId) as Promise<void>,
  onAgentChat: (listener) => subscribe<string>(channel.agentChatUpdate, listener),
};

contextBridge.exposeInMainWorld('yalqen', api);
