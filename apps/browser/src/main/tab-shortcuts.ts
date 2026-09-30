interface Listable {
  id: string;
  pinnedUrl: string | null;
}

export type OpenedPinned = ReadonlyMap<string, string | null>;

export function tabListOrder<T extends Listable>(tabs: readonly T[], opened: OpenedPinned): T[] {
  const unpinned = tabs.filter((tab) => !tab.pinnedUrl);
  const unpinnedIds = new Set(unpinned.map((tab) => tab.id));
  const byAnchor = new Map<string | null, T[]>();
  const orphans: T[] = [];
  for (const [id, anchor] of opened) {
    const tab = tabs.find((candidate) => candidate.id === id && candidate.pinnedUrl);
    if (!tab) continue;
    if (anchor !== null && !unpinnedIds.has(anchor)) {
      orphans.push(tab);
      continue;
    }
    byAnchor.set(anchor, [...(byAnchor.get(anchor) ?? []), tab]);
  }
  return [
    ...(byAnchor.get(null) ?? []),
    ...unpinned.flatMap((tab) => [tab, ...(byAnchor.get(tab.id) ?? [])]),
    ...orphans,
  ];
}

export function tabForShortcut<T>(ordered: readonly T[], index: number): T | undefined {
  return index < 0 ? ordered.at(-1) : ordered[index];
}
