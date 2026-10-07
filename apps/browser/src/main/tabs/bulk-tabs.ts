import type { TabId } from '../../shared/types.js';

export type BulkCloseMode = 'others' | 'right';

interface BulkTab {
  id: TabId;
  pinnedUrl: string | null;
}

export function bulkCloseTargets<T extends BulkTab>(ordered: readonly T[], id: TabId, mode: BulkCloseMode): T[] {
  const index = ordered.findIndex((tab) => tab.id === id);
  if (index < 0) return [];
  return ordered.filter((tab, position) => tab.id !== id && !tab.pinnedUrl && (mode === 'others' || position > index));
}
