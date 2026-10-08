interface Listable {
  id: string;
  pinnedUrl: string | null;
  group?: string | null;
}

type OpenedPinned = ReadonlyMap<string, string | null>;

export function tabListOrder<T extends Listable>(tabs: readonly T[], opened: OpenedPinned): T[] {
  const unpinned = tabs.filter((tab) => !tab.pinnedUrl);
  const pinnedById = new Map(tabs.filter((tab) => tab.pinnedUrl).map((tab) => [tab.id, tab]));
  const unpinnedIds = new Set(unpinned.map((tab) => tab.id));
  const byAnchor = new Map<string | null, T[]>();
  const orphans: T[] = [];
  for (const [id, anchor] of opened) {
    const tab = pinnedById.get(id);
    if (!tab) continue;
    if (anchor !== null && !unpinnedIds.has(anchor)) {
      orphans.push(tab);
      continue;
    }
    const group = byAnchor.get(anchor);
    if (group) group.push(tab);
    else byAnchor.set(anchor, [tab]);
  }
  const ordered = [
    ...(byAnchor.get(null) ?? []),
    ...unpinned.flatMap((tab) => [tab, ...(byAnchor.get(tab.id) ?? [])]),
    ...orphans,
  ];
  const groups = new Set(tabs.flatMap((tab) => (tab.group ? [tab.group] : [])));
  return [
    ...ordered.filter((tab) => !tab.group),
    ...Array.from(groups).flatMap((name) => ordered.filter((tab) => tab.group === name)),
  ];
}

export function tabForShortcut<T>(ordered: readonly T[], index: number): T | undefined {
  return index < 0 ? ordered.at(-1) : ordered[index];
}
