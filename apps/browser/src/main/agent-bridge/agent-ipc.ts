import { clipboard } from 'electron';
import {
  AgentBridgeChannel,
  type AgentBridgeView,
  type AgentClientId,
  type AgentConnections,
  type AgentSetupKind,
  type AgentSetupResult,
} from '../../shared/types.js';
import { handleSettingsCall } from '../app/settings-page.js';
import { isAgentClient } from './agent-connections.js';

const SETUP_KINDS = new Set<unknown>(['claude', 'codex', 'token', 'otel'] satisfies AgentSetupKind[]);

interface AgentIpcHost {
  view(): AgentBridgeView;
  snippet(kind: AgentSetupKind): string | null;
  regenerateToken(): void;
  connections(): Promise<AgentConnections | null>;
  connect(id: AgentClientId): Promise<AgentSetupResult>;
  disconnect(id: AgentClientId): Promise<AgentSetupResult>;
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
  handleSettingsCall(AgentBridgeChannel.connections, () => host.connections());
  handleSettingsCall(AgentBridgeChannel.connect, (_event, id) =>
    isAgentClient(id) ? host.connect(id) : { ok: false, reason: 'failed', detail: '' },
  );
  handleSettingsCall(AgentBridgeChannel.disconnect, (_event, id) =>
    isAgentClient(id) ? host.disconnect(id) : { ok: false, reason: 'failed', detail: '' },
  );
}
