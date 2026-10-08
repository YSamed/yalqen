import type { TabId } from './types.js';

export type TabSelectionMode = 'toggle' | 'range';

export function selectTabIds(
  order: readonly TabId[],
  selected: readonly TabId[],
  anchor: TabId | null,
  active: TabId | null,
  id: TabId,
  mode: TabSelectionMode,
): { ids: TabId[]; anchor: TabId | null } {
  if (!order.includes(id)) return { ids: selected.filter((item) => order.includes(item)), anchor };
  const start = anchor && order.includes(anchor) ? anchor : active && order.includes(active) ? active : id;
  if (mode === 'range') {
    const a = order.indexOf(start),
      b = order.indexOf(id);
    return { ids: order.slice(Math.min(a, b), Math.max(a, b) + 1), anchor: start };
  }
  const ids = new Set(selected.length ? selected : active ? [active] : []);
  if (ids.has(id)) ids.delete(id);
  else ids.add(id);
  return { ids: order.filter((item) => ids.has(item)), anchor: id };
}

export function moveTabSelection<T extends { id: TabId }>(
  tabs: readonly T[],
  selected: readonly TabId[],
  id: TabId,
  toIndex: number,
): T[] {
  const from = tabs.findIndex((tab) => tab.id === id);
  if (from < 0 || !Number.isFinite(toIndex)) return [...tabs];
  const ids = new Set(selected.includes(id) ? selected : [id]);
  const moving = tabs.filter((tab) => ids.has(tab.id));
  const boundary = Math.max(0, Math.min(Math.trunc(toIndex) + (toIndex > from ? 1 : 0), tabs.length));
  const insertion = tabs.slice(0, boundary).filter((tab) => !ids.has(tab.id)).length;
  const remaining = tabs.filter((tab) => !ids.has(tab.id));
  remaining.splice(insertion, 0, ...moving);
  return remaining;
}
