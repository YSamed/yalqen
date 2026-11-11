export const BOOSTS_URL = 'yalqen://boosts/';
export const BoostChannel = {
  list: 'yalqen-boosts:list',
  save: 'yalqen-boosts:save',
  remove: 'yalqen-boosts:remove',
  changed: 'yalqen-boosts:changed',
} as const;
export const BOOST_FONTS = ['system', 'serif', 'mono'] as const;
export type BoostFont = (typeof BOOST_FONTS)[number];
export interface Boost {
  enabled: boolean;
  accent: string | null;
  background: string | null;
  font: BoostFont | null;
  hidden: string[];
  css: string;
}
export interface BoostSite {
  origin: string;
  boost: Boost;
}
export interface BoostView {
  sites: BoostSite[];
  writable: boolean;
}
export interface BoostApi {
  list(): Promise<BoostView | null>;
  save(origin: string, boost: Boost): Promise<boolean>;
  remove(origin: string): Promise<boolean>;
  onChange(listener: () => void): () => void;
}
