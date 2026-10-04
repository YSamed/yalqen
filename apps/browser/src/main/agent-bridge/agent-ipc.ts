import { clipboard } from 'electron';
import {
  AgentBridgeChannel,
  type AgentBridgeView,
  type AgentSetupKind,
  type ClaudeSetupResult,
} from '../../shared/types.js';
import { handleSettingsCall } from '../app/settings-page.js';

const SETUP_KINDS = new Set<unknown>(['claude', 'codex', 'token', 'otel'] satisfies AgentSetupKind[]);

interface AgentIpcHost {
  view(): AgentBridgeView;
  snippet(kind: AgentSetupKind): string | null;
  regenerateToken(): void;
  addToClaude(): Promise<ClaudeSetupResult>;
}

export function registerAgentBridgeIpc(host: AgentIpcHost): void {
  handleSettingsCall(AgentBridgeChannel.status, () => host.view());
  handleSettingsCall(AgentBridgeChannel.copy, (_event, kind) => {
    if (!SETUP_KINDS.has(kind)) return false;
    const text = host.snippet(kind as AgentSetupKind);
    if (!text) return false;
    clipboard.writeText(text);
    return true;
  });
  handleSettingsCall(AgentBridgeChannel.regenerate, () => {
    host.regenerateToken();
    return host.view();
  });
  handleSettingsCall(AgentBridgeChannel.addToClaude, () => host.addToClaude());
}
