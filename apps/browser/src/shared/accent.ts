export const ACCENT_COLORS = [
  { id: 'graphite', hex: '#6b6e76' },
  { id: 'mint', hex: '#1d9a6c' },
  { id: 'ocean', hex: '#0f7fc6' },
  { id: 'lavender', hex: '#6a5ab8' },
  { id: 'orange', hex: '#f28c28' },
  { id: 'rose', hex: '#d94f72' },
  { id: 'coral', hex: '#e33b4f' },
  { id: 'ember', hex: '#e05317' },
] as const;
export type AccentColorId = (typeof ACCENT_COLORS)[number]['id'];
export const DEFAULT_ACCENT: AccentColorId = 'orange';

const HEX = new Map<string, string>(ACCENT_COLORS.map(({ id, hex }) => [id, hex]));

export function isAccentColor(value: unknown): value is AccentColorId {
  return typeof value === 'string' && HEX.has(value);
}

export function accentHex(id: AccentColorId): string {
  return HEX.get(id) ?? HEX.get(DEFAULT_ACCENT)!;
}
