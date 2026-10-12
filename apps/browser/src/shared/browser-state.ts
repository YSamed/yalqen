import type { BrowserState, TabSnapshot } from './types';

function sameFields<T extends object>(previous: T | null, next: T | null): boolean {
  if (previous === next) return true;
  if (previous === null || next === null) return false;
  const keys = Object.keys(next) as (keyof T)[];
  return keys.length === Object.keys(previous).length && keys.every((key) => previous[key] === next[key]);
}

function reuseFields<T extends object>(previous: T | null, next: T | null): T | null {
  return sameFields(previous, next) ? previous : next;
}

function reuseArray<T>(previous: T[], next: T[]): T[] {
  return previous.length === next.length && next.every((item, index) => item === previous[index]) ? previous : next;
}

function reuseItems<T extends object>(previous: T[], next: T[]): T[] {
  return reuseArray(
    previous,
    next.map((item, index) => reuseFields(previous[index] ?? null, item)!),
  );
}

function reuseTab(previous: TabSnapshot | undefined, next: TabSnapshot): TabSnapshot {
  if (!previous || previous === next) return next;
  const overrides = reuseFields(previous.overrides, next.overrides)!;
  const translation = reuseFields(previous.translation, next.translation)!;
  const candidate = { ...next, overrides, translation };
  return sameFields(previous, candidate) ? previous : candidate;
}

// IPC clones every object in a snapshot. Keep unchanged values stable so Svelte's
// derived signals and keyed rows can skip work, without mutating raw state.
export function reuseBrowserState(previous: BrowserState, next: BrowserState): BrowserState {
  if (previous === next) return previous;
  let byId: Map<string, TabSnapshot> | undefined;
  const tabs = next.tabs.map((tab, index) => {
    let old: TabSnapshot | undefined = previous.tabs[index];
    if (old?.id !== tab.id) {
      byId ??= new Map(previous.tabs.map((entry) => [entry.id, entry]));
      old = byId.get(tab.id);
    }
    return reuseTab(old, tab);
  });
  const candidate: BrowserState = {
    ...next,
    tabs: reuseArray(previous.tabs, tabs),
    listOrder: reuseArray(previous.listOrder, next.listOrder),
    selectedTabIds: reuseArray(previous.selectedTabIds, next.selectedTabIds),
    ...(next.tabGroups && { tabGroups: reuseItems(previous.tabGroups ?? [], next.tabGroups) }),
    toolbarButtons: reuseArray(previous.toolbarButtons, next.toolbarButtons),
    media: reuseFields(previous.media, next.media),
    device: reuseFields(previous.device, next.device),
    downloads: reuseFields(previous.downloads, next.downloads)!,
    agentSession: reuseFields(previous.agentSession, next.agentSession)!,
    agentChat: reuseFields(previous.agentChat, next.agentChat)!,
    projectRun: reuseFields(previous.projectRun, next.projectRun)!,
    agentProviders: reuseArray(previous.agentProviders, next.agentProviders),
    agentElements: reuseItems(previous.agentElements, next.agentElements),
    agentProjects: reuseItems(previous.agentProjects, next.agentProjects),
    agentBackgroundChats: reuseItems(previous.agentBackgroundChats, next.agentBackgroundChats),
  };
  return sameFields(previous, candidate) ? previous : candidate;
}
