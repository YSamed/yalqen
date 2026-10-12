export const SIDEBAR_WIDGET_IDS = ['media'] as const;
export type SidebarWidgetId = (typeof SIDEBAR_WIDGET_IDS)[number];

// What the sidebar player shows for the tab that played last.
export interface MediaInfo {
  tabId: string;
  title: string;
  // Seconds; null when the page reports no finite length (live streams).
  duration: number | null;
  position: number | null;
  playing: boolean;
  // Whether the page registered a Media Session handler for the previous and the next track.
  canPrevious: boolean;
  canNext: boolean;
  // When position was read, so the renderer can advance it without asking again.
  updatedAt: number;
}

export type MediaSkip = 'previous' | 'next';

// Media Session handlers live in the page's own JavaScript world, which the browser's media scripts
// cannot call into, so the page preload's hook and those scripts talk through these DOM events.
export const MediaSessionEvent = {
  query: 'yalqen-media-query',
  actions: 'yalqen-media-actions',
  run: 'yalqen-media-run',
} as const;

const IDS = new Set<string>(SIDEBAR_WIDGET_IDS);

export function sanitizeSidebarWidgets(value: unknown, fallback: SidebarWidgetId[]): SidebarWidgetId[] {
  if (!Array.isArray(value)) return fallback;
  return [...new Set(value)].filter((id): id is SidebarWidgetId => IDS.has(id));
}
