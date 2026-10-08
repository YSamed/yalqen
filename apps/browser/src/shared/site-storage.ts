export interface SiteStorageEntry {
  domain: string;
  origins: number;
  cookies: number;
  databaseBytes: number | null;
}
export interface SiteStorageView {
  sites: SiteStorageEntry[];
  total: number;
  offset: number;
  more: boolean;
  limited: boolean;
}
export const SiteStorageChannel = {
  list: 'yalqen-site-storage:list',
  clear: 'yalqen-site-storage:clear',
} as const;
