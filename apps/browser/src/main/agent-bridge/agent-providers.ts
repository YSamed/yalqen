import { execFile } from 'node:child_process';
import type { AgentProviderId } from '../../shared/types.js';
import type { AcpAgent } from './acp-client.js';
import { childEnv, findCommand } from './shell-command.js';

function helpMentions(executable: string, flag: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(executable, ['--help'], { env: childEnv(), timeout: 10_000, maxBuffer: 1024 * 1024 }, (_error, stdout) =>
      resolve(new RegExp(`(^|\\s)${flag}\\b`, 'm').test(String(stdout))),
    );
  });
}

export const ACP_AGENTS: Record<Exclude<AgentProviderId, 'claude'>, AcpAgent> = {
  codex: { label: 'Codex', command: 'codex-acp', args: async () => [] },
  // Gemini CLI renamed --experimental-acp to --acp; older releases only know the experimental flag.
  gemini: {
    label: 'Gemini CLI',
    command: 'gemini',
    args: async (executable) => [(await helpMentions(executable, '--acp')) ? '--acp' : '--experimental-acp'],
  },
};

let detected: Promise<AgentProviderId[]> | null = null;

export function availableProviders(): Promise<AgentProviderId[]> {
  detected ??= Promise.all(
    (Object.keys(ACP_AGENTS) as (keyof typeof ACP_AGENTS)[]).map((id) =>
      findCommand(ACP_AGENTS[id].command).then(
        () => id,
        () => null,
      ),
    ),
  ).then((found) => ['claude', ...found.filter((id) => id !== null)]);
  return detected;
}

export function isAgentProvider(value: unknown): value is AgentProviderId {
  return value === 'claude' || value === 'codex' || value === 'gemini';
}
