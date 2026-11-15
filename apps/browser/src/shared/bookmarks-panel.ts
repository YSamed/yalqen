// The bookmarks side panel: the bookmark tree, sent to the window only while the panel is open.
export interface PanelBookmark {
  id: string;
  title: string;
  url: string;
  folderId: string | null;
  // The site's icon from history, when one was seen.
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

// A bookmark and a tab show the same page when their addresses match without the part after # and a trailing
// slash, so a mail or app bookmark still finds its tab after the page moved within itself.
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

// The open tab for a bookmark: the active tab when it is that page, otherwise the first one.
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

// Folders nest by parentId; the root holds what has no folder. Order is kept as stored.
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
