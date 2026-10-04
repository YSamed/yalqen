import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_FILES = 20_000;
const MAX_RESULTS = 20;
const CACHE_MS = 30_000;
const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.svelte-kit', 'coverage']);

type ListFiles = (directory: string) => Promise<string[]>;

function gitFiles(directory: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: directory, timeout: 5000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout) => (error ? reject(error) : resolve(stdout.split('\0').filter(Boolean).slice(0, MAX_FILES))),
    );
  });
}

async function walkFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [''];
  while (pending.length && files.length < MAX_FILES) {
    const relative = pending.shift()!;
    let entries;
    try {
      entries = await fs.readdir(path.join(directory, relative), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) pending.push(child);
      } else if (entry.isFile()) files.push(child);
    }
  }
  return files;
}

async function listProjectFiles(directory: string): Promise<string[]> {
  try {
    return await gitFiles(directory);
  } catch {
    return walkFiles(directory);
  }
}

function score(file: string, query: string): number {
  const lower = file.toLowerCase();
  const name = lower.slice(lower.lastIndexOf('/') + 1);
  if (name.startsWith(query)) return 0;
  if (name.includes(query)) return 1;
  if (lower.includes(query)) return 2;
  let index = 0;
  for (const character of lower) if (character === query[index]) index++;
  return index === query.length ? 3 : -1;
}

export function matchFiles(files: readonly string[], query: string): string[] {
  const needle = query.toLowerCase();
  if (!needle) return files.slice(0, MAX_RESULTS);
  return files
    .map((file) => ({ file, rank: score(file, needle) }))
    .filter(({ rank }) => rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.file.length - b.file.length || a.file.localeCompare(b.file))
    .slice(0, MAX_RESULTS)
    .map(({ file }) => file);
}

export class ProjectFiles {
  private cache: { directory: string; files: Promise<string[]>; at: number } | null = null;

  constructor(private readonly list: ListFiles = listProjectFiles) {}

  async search(directory: string, query: string): Promise<string[]> {
    if (!this.cache || this.cache.directory !== directory || Date.now() - this.cache.at > CACHE_MS)
      this.cache = { directory, files: this.list(directory).catch(() => []), at: Date.now() };
    return matchFiles(await this.cache.files, query);
  }
}
