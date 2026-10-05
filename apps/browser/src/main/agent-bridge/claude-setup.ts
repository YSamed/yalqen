import { execFile } from 'node:child_process';
import type { AgentConnectionState, AgentSetupResult } from '../../shared/types.js';

const TIMEOUT_MS = 20_000;
const NOT_FOUND = 'command -v claude >/dev/null 2>&1 || { echo "claude-not-found" >&2; exit 127; }';
const ADD_SCRIPT = [
  NOT_FOUND,
  'claude mcp remove yalqen --scope user >/dev/null 2>&1',
  'claude mcp add --scope user --transport http yalqen "$YALQEN_MCP_URL" --header "Authorization: Bearer $YALQEN_MCP_TOKEN"',
].join('\n');
const REMOVE_SCRIPT = [NOT_FOUND, 'claude mcp remove yalqen --scope user'].join('\n');
const GET_SCRIPT = [NOT_FOUND, 'claude mcp get yalqen'].join('\n');

interface ClaudeSetupOptions {
  shell?: string;
  env?: NodeJS.ProcessEnv;
}

interface Run {
  error: Error | null;
  stdout: string;
  stderr: string;
}

// Apps opened from the Dock get a bare PATH, so the user's login shell finds the CLI the way their terminal does.
function runClaude(script: string, options: ClaudeSetupOptions, extraEnv: NodeJS.ProcessEnv = {}): Promise<Run> {
  const shell = options.shell ?? process.env.SHELL ?? '/bin/zsh';
  const env = { ...(options.env ?? process.env), ...extraEnv };
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', script], { env, timeout: TIMEOUT_MS }, (error, stdout, stderr) =>
      resolve({ error, stdout: String(stdout), stderr: String(stderr) }),
    );
  });
}

function resultOf({ error, stderr }: Run, secret = ''): AgentSetupResult {
  if (!error) return { ok: true };
  if (stderr.includes('claude-not-found')) return { ok: false, reason: 'not-found', detail: '' };
  const last = stderr.trim().split('\n').pop() || error.message;
  const detail = secret ? last.replaceAll(secret, '<token>') : last;
  return { ok: false, reason: 'failed', detail: detail.slice(0, 300) };
}

export async function addToClaudeCode(
  url: string,
  token: string,
  options: ClaudeSetupOptions = {},
): Promise<AgentSetupResult> {
  return resultOf(await runClaude(ADD_SCRIPT, options, { YALQEN_MCP_URL: url, YALQEN_MCP_TOKEN: token }), token);
}

export async function removeFromClaudeCode(options: ClaudeSetupOptions = {}): Promise<AgentSetupResult> {
  return resultOf(await runClaude(REMOVE_SCRIPT, options));
}

export function claudeRegistration(output: string): { url: string | null; token: string | null } {
  return {
    url: /^\s*URL:\s*(\S+)/m.exec(output)?.[1] ?? null,
    token: /^\s*Authorization:\s*Bearer\s+(\S+)/im.exec(output)?.[1] ?? null,
  };
}

export async function claudeConnection(
  url: string,
  token: string,
  options: ClaudeSetupOptions = {},
): Promise<AgentConnectionState> {
  const run = await runClaude(GET_SCRIPT, options);
  if (run.stderr.includes('claude-not-found')) return 'unavailable';
  if (run.error) return 'missing';
  const registered = claudeRegistration(run.stdout);
  return registered.url === url && registered.token === token ? 'connected' : 'stale';
}
