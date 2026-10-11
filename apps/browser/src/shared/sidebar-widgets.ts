export const SIDEBAR_WIDGET_IDS = ['media', 'clock', 'focus', 'closed-tabs', 'downloads'] as const;
export type SidebarWidgetId = (typeof SIDEBAR_WIDGET_IDS)[number];

// How many recently closed tabs the widget lists; the state only carries these.
export const CLOSED_TAB_PREVIEWS = 3;

export interface ClosedTabPreview {
  id: string;
  title: string;
  url: string;
  faviconUrl: string | null;
}

const IDS = new Set<string>(SIDEBAR_WIDGET_IDS);

export function sanitizeSidebarWidgets(value: unknown, fallback: SidebarWidgetId[]): SidebarWidgetId[] {
  if (!Array.isArray(value)) return fallback;
  return [...new Set(value)].filter((id): id is SidebarWidgetId => IDS.has(id));
}

export function moveSidebarWidget(order: SidebarWidgetId[], id: SidebarWidgetId, toIndex: number): SidebarWidgetId[] {
  const from = order.indexOf(id);
  if (from < 0) return order;
  const next = order.filter((item) => item !== id);
  const target = Math.max(0, Math.min(next.length, toIndex > from ? toIndex - 1 : toIndex));
  next.splice(target, 0, id);
  return next.every((item, index) => item === order[index]) ? order : next;
}
