import { execFile } from 'node:child_process';
import { DISCARD_AFTER_MINUTES } from '../../shared/types.js';

export const DEFAULT_DISCARD_AFTER_MINUTES = 30;
const DISCARD_CHECK_MS = 15_000;
export const PRESSURE_MIN_IDLE_MS = 60_000;

type MemoryPressure = 'normal' | 'warning' | 'critical';

export interface DiscardCandidate {
  live: boolean;
  active: boolean;
  pinned: boolean;
  loading: boolean;
  audible: boolean;
  devToolsOpen: boolean;
  edited: boolean;
  inactiveSince: number;
}

export function isDiscardAfterMinutes(value: unknown): value is (typeof DISCARD_AFTER_MINUTES)[number] {
  return (DISCARD_AFTER_MINUTES as readonly unknown[]).includes(value);
}

function isDiscardable(tab: DiscardCandidate): boolean {
  return tab.live && !tab.active && !tab.pinned && !tab.loading && !tab.audible && !tab.devToolsOpen && !tab.edited;
}

export function shouldDiscard(tab: DiscardCandidate, now: number, afterMinutes: number): boolean {
  return afterMinutes > 0 && isDiscardable(tab) && now - tab.inactiveSince >= afterMinutes * 60_000;
}

export function pressureVictim<T extends DiscardCandidate>(tabs: readonly T[], now: number): T | null {
  let oldest: T | null = null;
  for (const tab of tabs) {
    if (!isDiscardable(tab) || now - tab.inactiveSince < PRESSURE_MIN_IDLE_MS) continue;
    if (!oldest || tab.inactiveSince < oldest.inactiveSince) oldest = tab;
  }
  return oldest;
}

function readMemoryPressure(): Promise<MemoryPressure> {
  if (process.platform !== 'darwin') return Promise.resolve('normal');
  return new Promise((resolve) => {
    execFile('sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'], (error, stdout) => {
      resolve(error ? 'normal' : parsePressureLevel(stdout));
    });
  });
}

export function parsePressureLevel(output: string): MemoryPressure {
  const level = Number(output.trim());
  if (level >= 4) return 'critical';
  if (level >= 2) return 'warning';
  return 'normal';
}

interface DiscardableTabs {
  discardCandidates(): (DiscardCandidate & { id: string })[];
  discard(id: string): boolean;
  discardInactive(now: number, afterMinutes: number): number;
}

interface MemorySaverHost {
  tabSets(): DiscardableTabs[];
  afterMinutes(): number;
}

export function startMemorySaver(host: MemorySaverHost): () => void {
  const nextPressureVictim = () =>
    pressureVictim(
      host.tabSets().flatMap((tabs) => tabs.discardCandidates().map((tab) => ({ ...tab, tabs }))),
      Date.now(),
    );
  const discardUnderPressure = (count: number) => {
    for (let i = 0; i < count; i++) {
      const victim = nextPressureVictim();
      if (!victim?.tabs.discard(victim.id)) return;
    }
  };
  const timer = setInterval(() => {
    const minutes = host.afterMinutes();
    if (minutes === 0) return;
    for (const tabs of host.tabSets()) tabs.discardInactive(Date.now(), minutes);
    if (!nextPressureVictim()) return;
    void readMemoryPressure().then((pressure) => {
      if (pressure !== 'normal') discardUnderPressure(pressure === 'critical' ? 3 : 1);
    });
  }, DISCARD_CHECK_MS);
  return () => clearInterval(timer);
}
