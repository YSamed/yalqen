import type { AgentClientId, AgentConnections, AgentConnectionState, AgentSetupResult } from '../../shared/types.js';
import { addToClaudeCode, claudeConnection, removeFromClaudeCode } from './claude-setup.js';
import { addToCodex, codexConnection, removeFromCodex } from './codex-setup.js';

export interface McpEndpoint {
  url: string;
  token: string;
}

interface ConnectionTarget {
  state(endpoint: McpEndpoint): Promise<AgentConnectionState>;
  connect(endpoint: McpEndpoint): Promise<AgentSetupResult>;
  disconnect(): Promise<AgentSetupResult>;
}

export type ConnectionTargets = Record<AgentClientId, ConnectionTarget>;

export const AGENT_CLIENTS: readonly AgentClientId[] = ['claude', 'codex'];

export const DEFAULT_TARGETS: ConnectionTargets = {
  claude: {
    state: ({ url, token }) => claudeConnection(url, token),
    connect: ({ url, token }) => addToClaudeCode(url, token),
    disconnect: () => removeFromClaudeCode(),
  },
  codex: {
    state: ({ url, token }) => codexConnection(url, token),
    connect: ({ url, token }) => addToCodex(url, token),
    disconnect: () => removeFromCodex(),
  },
};

export function isAgentClient(value: unknown): value is AgentClientId {
  return AGENT_CLIENTS.includes(value as AgentClientId);
}

export async function connectionStates(
  endpoint: McpEndpoint,
  targets: ConnectionTargets = DEFAULT_TARGETS,
): Promise<AgentConnections> {
  const [claude, codex] = await Promise.all(AGENT_CLIENTS.map((id) => targets[id].state(endpoint)));
  return { claude, codex };
}

// A new token or port silently breaks every client set up earlier, so stale registrations follow the bridge.
// Clients the user never connected are left alone.
export async function repairConnections(
  endpoint: McpEndpoint,
  targets: ConnectionTargets = DEFAULT_TARGETS,
): Promise<AgentClientId[]> {
  const states = await connectionStates(endpoint, targets);
  const stale = AGENT_CLIENTS.filter((id) => states[id] === 'stale');
  const repaired = await Promise.all(stale.map((id) => targets[id].connect(endpoint)));
  return stale.filter((_id, index) => repaired[index].ok);
}
