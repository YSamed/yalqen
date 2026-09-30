interface Numberable {
  pinnedUrl: string | null;
  view: unknown;
}

export function tabForShortcut<T extends Numberable>(
  tabs: readonly T[],
  index: number,
  skipClosedPinned: boolean,
): T | undefined {
  const numbered = skipClosedPinned ? tabs.filter((tab) => !tab.pinnedUrl || tab.view) : tabs;
  return index < 0 ? numbered.at(-1) : numbered[index];
}
