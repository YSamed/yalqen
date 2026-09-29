import { app, webContents } from 'electron';
import type { PageProcess, ProcessGroup, ProcessGroupKind, ProcessUsage } from '../shared/types.js';

export interface ProcessSample {
  pid: number;
  type: string;
  workingSetKB: number;
}

export interface ContentsSample {
  pid: number;
  url: string;
  title: string;
}

export const MAX_PAGE_PROCESSES = 8;
const GROUP_ORDER: readonly ProcessGroupKind[] = [
  'pages',
  'interface',
  'extensions',
  'browser',
  'gpu',
  'utility',
  'other',
];
const TYPE_KINDS: Record<string, ProcessGroupKind> = { Browser: 'browser', GPU: 'gpu', Utility: 'utility' };

const toMB = (kilobytes: number) => Math.round(kilobytes / 1024);

export function contentsKind(url: string): ProcessGroupKind {
  if (url.startsWith('file:')) return 'interface';
  if (url.startsWith('chrome-extension:')) return 'extensions';
  if (url.startsWith('devtools:')) return 'other';
  return 'pages';
}

// Renderers without a web contents of their own host out-of-process iframes or wait as spares,
// so they count towards the pages.
export function summarizeProcesses(
  processes: readonly ProcessSample[],
  contents: readonly ContentsSample[],
  pageLimit = MAX_PAGE_PROCESSES,
): ProcessUsage {
  const rendererKinds = new Map<number, ProcessGroupKind>();
  const titles = new Map<number, string[]>();
  for (const item of contents) {
    const kind = contentsKind(item.url);
    if (kind === 'pages') titles.set(item.pid, [...(titles.get(item.pid) ?? []), item.title || item.url]);
    if (kind === 'pages' || !rendererKinds.has(item.pid)) rendererKinds.set(item.pid, kind);
  }

  const groups = new Map<ProcessGroupKind, { count: number; kilobytes: number }>();
  const memory = new Map<number, number>();
  let totalKB = 0;
  for (const sample of processes) {
    const kind =
      sample.type === 'Tab' ? (rendererKinds.get(sample.pid) ?? 'pages') : (TYPE_KINDS[sample.type] ?? 'other');
    const group = groups.get(kind) ?? { count: 0, kilobytes: 0 };
    group.count++;
    group.kilobytes += sample.workingSetKB;
    groups.set(kind, group);
    memory.set(sample.pid, sample.workingSetKB);
    totalKB += sample.workingSetKB;
  }

  const pages: PageProcess[] = [...titles]
    .filter(([pid]) => memory.has(pid))
    .map(([pid, pageTitles]) => ({ pid, titles: pageTitles, memoryMB: toMB(memory.get(pid) ?? 0) }))
    .sort((a, b) => b.memoryMB - a.memoryMB)
    .slice(0, pageLimit);

  return {
    totalMB: toMB(totalKB),
    groups: GROUP_ORDER.flatMap((kind): ProcessGroup[] => {
      const group = groups.get(kind);
      return group ? [{ kind, count: group.count, memoryMB: toMB(group.kilobytes) }] : [];
    }),
    pages,
  };
}

export function processUsage(): ProcessUsage {
  return summarizeProcesses(
    app.getAppMetrics().map((metric) => ({
      pid: metric.pid,
      type: metric.type,
      workingSetKB: metric.memory.workingSetSize,
    })),
    webContents
      .getAllWebContents()
      .filter((contents) => !contents.isDestroyed())
      .map((contents) => ({ pid: contents.getOSProcessId(), url: contents.getURL(), title: contents.getTitle() })),
  );
}
