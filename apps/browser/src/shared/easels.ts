export const EASELS_URL = 'yalqen://easels/';
export const MAX_CLIP_CHARS = 400_000;
export const EaselChannel = {
  list: 'yalqen-easels:list',
  open: 'yalqen-easels:open',
  create: 'yalqen-easels:create',
  rename: 'yalqen-easels:rename',
  remove: 'yalqen-easels:remove',
  add: 'yalqen-easels:add',
  patch: 'yalqen-easels:patch',
  removeItem: 'yalqen-easels:remove-item',
  changed: 'yalqen-easels:changed',
} as const;
export interface EaselClip {
  id: string;
  kind: 'clip';
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
  url: string;
  title: string;
}
export interface EaselNote {
  id: string;
  kind: 'note';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}
export interface EaselStroke {
  id: string;
  kind: 'stroke';
  color: string;
  width: number;
  points: number[];
}
export type EaselItem = EaselClip | EaselNote | EaselStroke;
export interface Easel {
  id: string;
  name: string;
  updatedAt: number;
  items: EaselItem[];
}
export interface EaselSummary {
  id: string;
  name: string;
  count: number;
}
export interface EaselList {
  easels: EaselSummary[];
  writable: boolean;
}
export interface EaselApi {
  list(): Promise<EaselList | null>;
  open(id: string): Promise<Easel | null>;
  create(name: string): Promise<string | null>;
  rename(id: string, name: string): Promise<boolean>;
  remove(id: string): Promise<boolean>;
  add(id: string, item: unknown): Promise<EaselItem | null>;
  patch(id: string, itemId: string, patch: unknown): Promise<boolean>;
  removeItem(id: string, itemId: string): Promise<boolean>;
  onChange(listener: () => void): () => void;
}
