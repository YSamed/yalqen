import type { AgentChatState, AgentSessionState, AgentTerminalSize } from './types.js';

export const EMPTY_AGENT_CHAT: AgentChatState = {
  id: null,
  directory: null,
  status: 'idle',
  model: null,
  error: null,
};

export const EMPTY_AGENT_SESSION: AgentSessionState = {
  id: null,
  directory: null,
  status: 'idle',
  exitCode: null,
  error: null,
};

export const DEFAULT_AGENT_PANEL_WIDTH = 400;
export const MIN_AGENT_PANEL_WIDTH = 280;
export const MAX_AGENT_PANEL_WIDTH = 800;
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
