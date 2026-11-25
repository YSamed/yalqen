import type { BrowserState, TabSnapshot } from './types';

type Json = Record<string, unknown> | unknown[];

function isJson(value: unknown): value is Json {
  return typeof value === 'object' && value !== null;
}

function reuseArray<T>(previous: T[], next: T[]): T[] {
  return previous.length === next.length && next.every((item, index) => item === previous[index]) ? previous : next;
}

// Keeps every unchanged object and array of `previous`, at any depth, so Svelte skips what did not change.
// A copy is made only from the first difference on, because most pushes change one value.
function reuse<T>(previous: unknown, next: T): T {
  if (previous === next || !isJson(previous) || !isJson(next)) return next;
  if (Array.isArray(next)) {
    if (!Array.isArray(previous)) return next;
    let copy: unknown[] | null = null;
    for (let index = 0; index < next.length; index++) {
      const kept = reuse(previous[index], next[index]);
      if (copy) copy[index] = kept;
      else if (kept !== previous[index]) (copy = previous.slice(0, index))[index] = kept;
    }
    return (copy ?? (next.length === previous.length ? previous : previous.slice(0, next.length))) as T;
  }
  if (Array.isArray(previous)) return next;
  const before = previous as Record<string, unknown>;
  const after = next as Record<string, unknown>;
  let copy: Record<string, unknown> | null = null;
  let count = 0;
  for (const key in after) {
    count++;
    const kept = reuse(before[key], after[key]);
    if (copy) copy[key] = kept;
    else if (kept !== before[key]) copy = { ...before, [key]: kept };
  }
  if (!copy && count === Object.keys(before).length) return previous as T;
  copy ??= { ...before };
  for (const key of Object.keys(copy)) if (!(key in after)) delete copy[key];
  return copy as T;
}

export function reuseBrowserState(previous: BrowserState, next: BrowserState): BrowserState {
  if (previous === next) return previous;
  let byId: Map<string, TabSnapshot> | undefined;
  const tabs = reuseArray(
    previous.tabs,
    next.tabs.map((tab, index) => {
      let old: TabSnapshot | undefined = previous.tabs[index];
      if (old?.id !== tab.id) {
        byId ??= new Map(previous.tabs.map((entry) => [entry.id, entry]));
        old = byId.get(tab.id);
      }
      return reuse(old, tab);
    }),
  );
  const rest = reuse(previous, { ...next, tabs: previous.tabs });
  return tabs === previous.tabs ? rest : { ...rest, tabs };
}
