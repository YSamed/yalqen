export const SIDEBAR_WIDGET_IDS = ['media'] as const;
export type SidebarWidgetId = (typeof SIDEBAR_WIDGET_IDS)[number];

export interface MediaInfo {
  tabId: string;
  title: string;
  duration: number | null;
  position: number | null;
  playing: boolean;
  canPrevious: boolean;
  canNext: boolean;
  updatedAt: number;
}

export type MediaSkip = 'previous' | 'next';

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
