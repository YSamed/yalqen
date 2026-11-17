export interface PanelBookmark {
  id: string;
  title: string;
  url: string;
  folderId: string | null;
  icon: string | null;
}

export interface PanelFolder {
  id: string;
  title: string;
  parentId: string | null;
}

export interface BookmarksPanelView {
  folders: PanelFolder[];
  bookmarks: PanelBookmark[];
}

export function pageKey(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.hash = '';
  const key = parsed.href;
  return key.endsWith('/') ? key.slice(0, -1) : key;
}

export function tabForBookmark<T extends { id: string; url: string }>(
  url: string,
  tabs: readonly T[],
  activeId: string | null,
): T | null {
  const key = pageKey(url);
  let found: T | null = null;
  for (const tab of tabs) {
    if (pageKey(tab.url) !== key) continue;
    if (tab.id === activeId) return tab;
    found ??= tab;
  }
  return found;
}

export interface BookmarkNode {
  folder: PanelFolder;
  folders: BookmarkNode[];
  bookmarks: PanelBookmark[];
}

export function bookmarkTree(view: BookmarksPanelView): { folders: BookmarkNode[]; bookmarks: PanelBookmark[] } {
  const known = new Set(view.folders.map((folder) => folder.id));
  const childFolders = new Map<string | null, PanelFolder[]>();
  for (const folder of view.folders) {
    const parent = folder.parentId && known.has(folder.parentId) ? folder.parentId : null;
    childFolders.set(parent, [...(childFolders.get(parent) ?? []), folder]);
  }
  const childBookmarks = new Map<string | null, PanelBookmark[]>();
  for (const bookmark of view.bookmarks) {
    const folder = bookmark.folderId && known.has(bookmark.folderId) ? bookmark.folderId : null;
    childBookmarks.set(folder, [...(childBookmarks.get(folder) ?? []), bookmark]);
  }
  const seen = new Set<string>();
  const build = (folder: PanelFolder): BookmarkNode => {
    seen.add(folder.id);
    return {
      folder,
      folders: (childFolders.get(folder.id) ?? []).filter((child) => !seen.has(child.id)).map(build),
      bookmarks: childBookmarks.get(folder.id) ?? [],
    };
  };
  return { folders: (childFolders.get(null) ?? []).map(build), bookmarks: childBookmarks.get(null) ?? [] };
}
