import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AgentConnectionState, AgentSetupResult } from '../../shared/types.js';

const TABLE = 'mcp_servers.yalqen';
const HEADER = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*(#.*)?$/;

export function codexConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'config.toml');
}

function tableName(header: string): string {
  return header
    .split('.')
    .map((part) => part.trim().replace(/^"(.*)"$/, '$1'))
    .join('.');
}

function isYalqenTable(name: string): boolean {
  return name === TABLE || name.startsWith(`${TABLE}.`);
}

// Only the Yalqen table and its subtables are touched; every other line keeps its exact text.
export function withoutYalqen(config: string): string {
  const kept: string[] = [];
  let skipping = false;
  for (const line of config.split('\n')) {
    const header = HEADER.exec(line);
    if (header) skipping = isYalqenTable(tableName(header[1]));
    if (!skipping) kept.push(line);
  }
  return kept.join('\n').trimEnd();
}

export function withYalqen(config: string, url: string, token: string): string {
  const rest = withoutYalqen(config);
  const block = [`[${TABLE}]`, `url = "${url}"`, `http_headers = { Authorization = "Bearer ${token}" }`].join('\n');
  return `${rest ? `${rest}\n\n` : ''}${block}\n`;
}

export function codexRegistration(config: string): { url: string | null; token: string | null } | null {
  let inside = false;
  let found = false;
  let url: string | null = null;
  let token: string | null = null;
  for (const line of config.split('\n')) {
    const header = HEADER.exec(line);
    if (header) {
      inside = tableName(header[1]) === TABLE;
      found ||= inside;
      continue;
    }
    if (!inside) continue;
    url ??= /^\s*url\s*=\s*"([^"]*)"/.exec(line)?.[1] ?? null;
    token ??= /^\s*http_headers\s*=.*Authorization\s*=\s*"Bearer\s+([^"]+)"/.exec(line)?.[1] ?? null;
  }
  return found ? { url, token } : null;
}

async function readConfig(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

// The previous file is kept next to it, and the new one replaces it in a single rename.
async function writeConfig(file: string, previous: string | null, next: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  if (previous !== null) await fs.writeFile(`${file}.yalqen-backup`, previous, { mode: 0o600 });
  const temporary = `${file}.yalqen-${process.pid}.tmp`;
  await fs.writeFile(temporary, next, { mode: 0o600 });
  await fs.rename(temporary, file);
}

function failure(error: unknown, token = ''): AgentSetupResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    ok: false,
    reason: 'failed',
    detail: (token ? message.replaceAll(token, '<token>') : message).slice(0, 300),
  };
}

export async function addToCodex(url: string, token: string, file = codexConfigPath()): Promise<AgentSetupResult> {
  try {
    const previous = await readConfig(file);
    await writeConfig(file, previous, withYalqen(previous ?? '', url, token));
    return { ok: true };
  } catch (error) {
    return failure(error, token);
  }
}

export async function removeFromCodex(file = codexConfigPath()): Promise<AgentSetupResult> {
  try {
    const previous = await readConfig(file);
    if (previous === null || !codexRegistration(previous)) return { ok: true };
    const rest = withoutYalqen(previous);
    await writeConfig(file, previous, rest ? `${rest}\n` : '');
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function codexConnection(
  url: string,
  token: string,
  file = codexConfigPath(),
): Promise<AgentConnectionState> {
  const config = await readConfig(file).catch(() => null);
  const registered = config === null ? null : codexRegistration(config);
  if (!registered) return 'missing';
  return registered.url === url && registered.token === token ? 'connected' : 'stale';
}
