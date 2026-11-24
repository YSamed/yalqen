import type { TabId } from './types.js';

export interface AgentEpisodePreview {
  id: string;
  lines: string[];
}

export interface AgentProjectSummary {
  id: string;
  directory: string | null;
  busy: boolean;
  waiting: boolean;
}

export interface AgentTerminalSize {
  cols: number;
  rows: number;
}

export interface AgentSessionState {
  id: string | null;
  directory: string | null;
  status: 'idle' | 'starting' | 'running' | 'exited' | 'error';
  exitCode: number | null;
  error:
    'claude-not-found' | 'invalid-directory' | 'terminal-unavailable' | 'connection-failed' | 'start-failed' | null;
}

export interface ProjectRunState {
  directory: string | null;
  command: string | null;
  status: 'idle' | 'starting' | 'running' | 'exited' | 'error';
  url: string | null;
  exitCode: number | null;
}

export interface AgentTerminalOutput {
  sessionId: string;
  sequence: number;
  data: string;
}

export interface AgentTerminalSnapshot {
  state: AgentSessionState;
  sequence: number;
  data: string;
}

export type AgentPermissionMode = 'default' | 'acceptEdits' | 'auto' | 'plan';
export type AgentProviderId = 'claude' | 'codex' | 'gemini';
export type AgentWorkMode = 'normal' | 'verify' | 'review' | 'design';
export type AgentReplyLength = 'short' | 'detailed';
export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface AgentChatModel {
  value: string;
  label: string;
  efforts: AgentEffort[];
}

export interface AgentChatCommand {
  name: string;
  description: string;
  argumentHint: string;
}

export interface AgentChatSession {
  id: string;
  title: string;
  updatedAt: number;
  branch: string | null;
}

export interface AgentChatUsage {
  cost: number;
  contextTokens: number | null;
  contextLimit: number | null;
}

export interface AgentChatSettings {
  workMode?: AgentWorkMode;
  replyLength?: AgentReplyLength;
  permissionMode?: AgentPermissionMode;
  model?: string | null;
  effort?: AgentEffort | null;
}

export interface AgentChatState {
  id: string | null;
  provider: AgentProviderId;
  workMode: AgentWorkMode;
  replyLength: AgentReplyLength;
  directory: string | null;
  status: 'idle' | 'starting' | 'thinking' | 'approval' | 'ready' | 'stopped' | 'error';
  model: string | null;
  modelChoice: string | null;
  effort: AgentEffort | null;
  permissionMode: AgentPermissionMode;
  models: AgentChatModel[];
  commands: AgentChatCommand[];
  usage: AgentChatUsage | null;
  error:
    | 'claude-not-found'
    | 'invalid-directory'
    | 'connection-failed'
    | 'authentication-required'
    | 'start-failed'
    | 'request-failed'
    | null;
}

export type AgentChatPart =
  | { type: 'text'; text: string }
  | {
      type: 'tool';
      id: string;
      name: string;
      input: string;
      output: string;
      status: 'running' | 'done' | 'error' | 'stopped';
      verification: 'passed' | 'failed' | null;
      task: AgentChatTask | null;
      steps: string[];
    };

export interface AgentChatTask {
  description: string;
  status: 'running' | 'completed' | 'failed' | 'stopped';
  toolUses: number;
  summary: string | null;
}

export interface AgentRewindPreview {
  canRewind: boolean;
  error: string | null;
  files: string[];
  insertions: number;
  deletions: number;
}

export interface AgentChatContext {
  id: TabId;
  title: string;
  url: string;
  local: boolean;
}

export interface AgentElementRef {
  id: string;
  tabId: TabId;
  url: string;
  label: string;
  component: string | null;
  source: string | null;
  reference?: boolean;
}

export interface AgentChatMessage {
  id: string;
  role: 'user' | 'assistant';
  parts: AgentChatPart[];
  context: AgentChatContext | null;
  contexts?: AgentChatContext[];
  elements: AgentElementRef[];
  episode: AgentEpisodePreview | null;
  images: string[];
  reverted: boolean;
  workMode: AgentWorkMode;
}

export interface AgentChatImage {
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  data: string;
  thumbnail: string;
}

interface AgentChatQuestion {
  question: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

export interface AgentChatPermission {
  id: string;
  tool: string;
  title: string;
  input: string;
  plan: string | null;
  questions: AgentChatQuestion[];
  canAlwaysAllow: boolean;
}

export interface AgentChatSnapshot {
  state: AgentChatState;
  revision: number;
  messages: AgentChatMessage[];
  queue: AgentChatMessage[];
  permissions: AgentChatPermission[];
}

export type AgentActionPolicy = 'off' | 'ask' | 'allow';

export type AgentSetupKind = 'claude' | 'codex' | 'token' | 'otel';

export interface AgentBackgroundChat {
  id: string;
  title: string;
  status: AgentChatState['status'];
}

export type AgentSetupResult = { ok: true } | { ok: false; reason: 'not-found' | 'failed'; detail: string };

export type AgentClientId = 'claude' | 'codex';

export type AgentConnectionState = 'connected' | 'stale' | 'missing' | 'unavailable';

export type AgentConnections = Record<AgentClientId, AgentConnectionState>;

export interface AgentBridgeView {
  enabled: boolean;
  port: number | null;
  error: string | null;
  lastCallAt: number | null;
  calls: number;
  client: string | null;
  staleTokenAt: number | null;
  url: string | null;
  claudeCommand: string | null;
  codexConfig: string | null;
  otelConfig: string | null;
  observedTabs: number;
  connectionsRevision: number;
}

export const AgentBridgeChannel = {
  status: 'yalqen-agent:status',
  copy: 'yalqen-agent:copy',
  regenerate: 'yalqen-agent:regenerate',
  connections: 'yalqen-agent:connections',
  connect: 'yalqen-agent:connect',
  disconnect: 'yalqen-agent:disconnect',
  changed: 'yalqen-agent:changed',
} as const;
