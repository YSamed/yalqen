export const SIDEBAR_WIDGET_IDS = ['media'] as const;
export type SidebarWidgetId = (typeof SIDEBAR_WIDGET_IDS)[number];

// What the sidebar player shows for the tab that played last.
export interface MediaInfo {
  tabId: string;
  title: string;
  artist: string;
  // Cover art from the page's Media Session; the favicon stands in without it.
  artwork: string | null;
  faviconUrl: string | null;
  // Seconds; null when the page reports no finite length (live streams).
  duration: number | null;
  position: number | null;
  playing: boolean;
  // When position was read, so the renderer can advance it without asking again.
  updatedAt: number;
}

const IDS = new Set<string>(SIDEBAR_WIDGET_IDS);

export function sanitizeSidebarWidgets(value: unknown, fallback: SidebarWidgetId[]): SidebarWidgetId[] {
  if (!Array.isArray(value)) return fallback;
  return [...new Set(value)].filter((id): id is SidebarWidgetId => IDS.has(id));
}
