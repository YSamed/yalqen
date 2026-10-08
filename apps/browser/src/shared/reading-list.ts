export const READING_LIST_URL = 'yalqen://reading-list/';
export const ReadingListChannel = {
  list: 'yalqen-reading-list:list',
  read: 'yalqen-reading-list:read',
  remove: 'yalqen-reading-list:remove',
  changed: 'yalqen-reading-list:changed',
} as const;
export interface ReadingEntry {
  id: string;
  url: string;
  title: string;
  addedAt: number;
  read: boolean;
}
export interface ReadingListView {
  entries: ReadingEntry[];
  writable: boolean;
}
export interface ReadingListApi {
  list(query: string, status: string): Promise<ReadingListView | null>;
  setRead(id: string, read: boolean): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  onChange(listener: () => void): () => void;
}
export function readingUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}
