import { AUTO_ARCHIVE_HOURS } from '../../shared/types.js';

export const ARCHIVE_CHECK_MS = 5 * 60_000;
const HOUR_MS = 3_600_000;

export interface ArchiveCandidate {
  active: boolean;
  pinned: boolean;
  private: boolean;
  loading: boolean;
  playing: boolean;
  devToolsOpen: boolean;
  edited: boolean;
  autoReload: boolean;
  hasLiveChild: boolean;
  inactiveSince: number;
}

export function isAutoArchiveHours(value: unknown): value is (typeof AUTO_ARCHIVE_HOURS)[number] {
  return (AUTO_ARCHIVE_HOURS as readonly unknown[]).includes(value);
}

// Private tabs never reach the closed list or history, so archiving one would lose it.
export function shouldArchive(tab: ArchiveCandidate, now: number, hours: number): boolean {
  if (hours <= 0 || now - tab.inactiveSince < hours * HOUR_MS) return false;
  return !(
    tab.active ||
    tab.pinned ||
    tab.private ||
    tab.loading ||
    tab.playing ||
    tab.devToolsOpen ||
    tab.edited ||
    tab.autoReload ||
    tab.hasLiveChild
  );
}

interface ArchivableTabs {
  archiveInactive(now: number, hours: number): number;
}

interface AutoArchiveHost {
  tabSets(): ArchivableTabs[];
  afterHours(): number;
}

export function startAutoArchive(host: AutoArchiveHost): () => void {
  const timer = setInterval(() => {
    const hours = host.afterHours();
    if (hours === 0) return;
    for (const tabs of host.tabSets()) tabs.archiveInactive(Date.now(), hours);
  }, ARCHIVE_CHECK_MS);
  return () => clearInterval(timer);
}
