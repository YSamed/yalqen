import { execFile } from 'node:child_process';
import type { ClaudeSetupResult } from '../../shared/types.js';

const TIMEOUT_MS = 20_000;
// Apps opened from the Dock get a bare PATH, so the user's login shell finds the CLI the way their terminal does.
const SCRIPT = [
  'command -v claude >/dev/null 2>&1 || { echo "claude-not-found" >&2; exit 127; }',
  'claude mcp remove yalqen --scope user >/dev/null 2>&1',
  'claude mcp add --scope user --transport http yalqen "$YALQEN_MCP_URL" --header "Authorization: Bearer $YALQEN_MCP_TOKEN"',
].join('\n');

interface ClaudeSetupOptions {
  shell?: string;
  env?: NodeJS.ProcessEnv;
}

export function addToClaudeCode(
  url: string,
  token: string,
  options: ClaudeSetupOptions = {},
): Promise<ClaudeSetupResult> {
  const shell = options.shell ?? process.env.SHELL ?? '/bin/zsh';
  const env = { ...(options.env ?? process.env), YALQEN_MCP_URL: url, YALQEN_MCP_TOKEN: token };
  return new Promise((resolve) => {
    execFile(shell, ['-ilc', SCRIPT], { env, timeout: TIMEOUT_MS }, (error, _stdout, stderr) => {
      if (!error) resolve({ ok: true });
      else if (stderr.includes('claude-not-found')) resolve({ ok: false, reason: 'not-found', detail: '' });
      else {
        const detail = (stderr.trim().split('\n').pop() || error.message).replaceAll(token, '<token>');
        resolve({ ok: false, reason: 'failed', detail: detail.slice(0, 300) });
      }
    });
  });
}
