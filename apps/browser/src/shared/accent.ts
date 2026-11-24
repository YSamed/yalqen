export const ACCENT_COLORS = [
  { id: 'orange', hex: '#f28c28' },
  { id: 'coral', hex: '#ec5f4b' },
  { id: 'rose', hex: '#de5a92' },
  { id: 'lavender', hex: '#8a6fe8' },
  { id: 'ocean', hex: '#3a8ee6' },
  { id: 'mint', hex: '#1fa67f' },
  { id: 'gold', hex: '#d4a020' },
  { id: 'graphite', hex: '#6b6e76' },
  { id: 'peach', hex: '#f6b98c' },
  { id: 'blush', hex: '#f2a7b5' },
  { id: 'lilac', hex: '#c3b1f0' },
  { id: 'sky', hex: '#9cc8f2' },
  { id: 'sage', hex: '#a8d5b8' },
  { id: 'butter', hex: '#f1d98a' },
] as const;
export type AccentColorId = (typeof ACCENT_COLORS)[number]['id'];
export const DEFAULT_ACCENT: AccentColorId = 'orange';

const HEX = new Map<string, string>(ACCENT_COLORS.map(({ id, hex }) => [id, hex]));

export function isAccentColor(value: unknown): value is AccentColorId {
  return typeof value === 'string' && HEX.has(value);
}

export function accentHex(id: AccentColorId): string {
  return HEX.get(id) ?? ACCENT_COLORS[0].hex;
}
