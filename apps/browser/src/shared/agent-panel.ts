import type {
  AgentChatContext,
  AgentChatImage,
  AgentChatState,
  AgentSessionState,
  AgentTerminalSize,
  ProjectRunState,
  TabSnapshot,
} from './types.js';

export const MAX_CHAT_TABS = 5;

export interface AgentChatComposer {
  text: string;
  attachments: TabSnapshot[];
  images: AgentChatImage[];
}

export function normalizeAgentContexts(value: unknown): AgentChatContext[] | null {
  const entries = value === null ? [] : Array.isArray(value) ? value : [value];
  const contexts: AgentChatContext[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      typeof entry.title !== 'string' ||
      typeof entry.url !== 'string' ||
      !/^https?:/.test(entry.url) ||
      (entry.local !== undefined && typeof entry.local !== 'boolean')
    )
      return null;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    contexts.push({
      id: entry.id,
      title: entry.title,
      url: entry.url,
      ...(entry.local !== undefined && { local: entry.local }),
    } as AgentChatContext);
    if (contexts.length > MAX_CHAT_TABS) return null;
  }
  return contexts;
}

export function resolveAgentContexts(
  tabIds: unknown,
  tabs: readonly Pick<TabSnapshot, 'id' | 'title' | 'url' | 'isPrivate' | 'agentObserved'>[],
  developerWindow = false,
): AgentChatContext[] | null {
  if (tabIds === null) return [];
  const ids = typeof tabIds === 'string' ? [tabIds] : tabIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !id)) return null;
  const unique = [...new Set<string>(ids)];
  if (unique.length > MAX_CHAT_TABS) return null;
  const contexts: AgentChatContext[] = [];
  for (const id of unique) {
    const tab = tabs.find((entry) => entry.id === id);
    if (!tab || (tab.isPrivate && !developerWindow) || !/^https?:/.test(tab.url)) return null;
    contexts.push({ id: tab.id, title: tab.title, url: tab.url, local: tab.agentObserved });
  }
  return contexts;
}

export const EMPTY_AGENT_CHAT: AgentChatState = {
  id: null,
  provider: 'claude',
  workMode: 'normal',
  replyLength: 'short',
  directory: null,
  status: 'idle',
  model: null,
  modelChoice: null,
  effort: null,
  permissionMode: 'default',
  models: [],
  commands: [],
  usage: null,
  error: null,
};

export const EMPTY_AGENT_SESSION: AgentSessionState = {
  id: null,
  directory: null,
  status: 'idle',
  exitCode: null,
  error: null,
};

export const EMPTY_PROJECT_RUN: ProjectRunState = {
  directory: null,
  command: null,
  status: 'idle',
  url: null,
  exitCode: null,
};

export const DEFAULT_AGENT_PANEL_WIDTH = 400;
export const MIN_AGENT_PANEL_WIDTH = 280;
const MAX_AGENT_PANEL_WIDTH = 800;
export const MIN_AGENT_PAGE_WIDTH = 300;

export function fitAgentPanelWidth(requested: number, windowWidth: number, tabPanelWidth: number): number {
  const maximum = Math.min(MAX_AGENT_PANEL_WIDTH, windowWidth - tabPanelWidth - MIN_AGENT_PAGE_WIDTH - 16);
  return Math.round(Math.max(MIN_AGENT_PANEL_WIDTH, Math.min(requested, maximum)));
}

export function isAgentTerminalSize(value: unknown): value is AgentTerminalSize {
  if (!value || typeof value !== 'object') return false;
  const { cols, rows } = value as AgentTerminalSize;
  return Number.isInteger(cols) && cols >= 2 && cols <= 500 && Number.isInteger(rows) && rows >= 1 && rows <= 500;
}
