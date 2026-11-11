import { accentHex, isAccentColor, type AccentColorId } from './accent.js';

export type WindowColor = 'none' | 'accent' | AccentColorId;
export const DEFAULT_WINDOW_COLOR: WindowColor = 'none';

export function isWindowColor(value: unknown): value is WindowColor {
  return value === 'none' || value === 'accent' || isAccentColor(value);
}

// The hex is the hook for other color sources: a workspace color only has to feed its own hex into BrowserState.windowColor.
export function windowColorHex(color: WindowColor, accent: AccentColorId): string | null {
  if (color === 'none') return null;
  return accentHex(color === 'accent' ? accent : color);
}

export type Rgb = readonly [number, number, number];
export type Scheme = 'light' | 'dark';

// Mirrors the neutral surfaces in tokens.css and app.css that the window color is mixed into.
export const WINDOW_BASES = {
  light: { bg: [238, 238, 240], glass: [250, 247, 243], text: [26, 27, 30], muted: [98, 100, 107] },
  dark: { bg: [10, 10, 11], glass: [0, 0, 0], text: [243, 243, 244], muted: [156, 157, 163] },
} as const satisfies Record<Scheme, Record<string, Rgb>>;

const TINT_STRENGTH = 0.18;
export const MIN_CONTRAST = 4.5;

const mix = (from: Rgb, to: Rgb, amount: number): Rgb =>
  from.map((channel, index) => Math.round(channel + (to[index] - channel) * amount)) as unknown as Rgb;

const parseHex = (hex: string): Rgb =>
  [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16)) as unknown as Rgb;

function luminance(color: Rgb): number {
  const [r, g, b] = color.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

// Muted text moves toward the main text color until it is readable on every tinted surface.
function readableMuted(muted: Rgb, text: Rgb, surfaces: Rgb[]): Rgb {
  for (let step = 0; step <= 10; step++) {
    const candidate = mix(muted, text, step / 10);
    if (surfaces.every((surface) => contrastRatio(candidate, surface) >= MIN_CONTRAST)) return candidate;
  }
  return text;
}

export function windowTint(hex: string): Record<Scheme, { bg: Rgb; glass: Rgb; muted: Rgb }> {
  const color = parseHex(hex);
  const derive = ({ bg, glass, text, muted }: (typeof WINDOW_BASES)[Scheme]) => {
    const tintedBg = mix(bg, color, TINT_STRENGTH);
    const tintedGlass = mix(glass, color, TINT_STRENGTH);
    return { bg: tintedBg, glass: tintedGlass, muted: readableMuted(muted, text, [tintedBg, tintedGlass]) };
  };
  return { light: derive(WINDOW_BASES.light), dark: derive(WINDOW_BASES.dark) };
}

export function windowTintVars(hex: string | null): Record<string, string | null> {
  const tint = hex === null ? null : windowTint(hex);
  const rgb = (color?: Rgb) => (color ? `rgb(${color.join(' ')})` : null);
  return {
    '--tint-bg-light': rgb(tint?.light.bg),
    '--tint-bg-dark': rgb(tint?.dark.bg),
    '--tint-glass-light': rgb(tint?.light.glass),
    '--tint-glass-dark': rgb(tint?.dark.glass),
    '--tint-muted-light': rgb(tint?.light.muted),
    '--tint-muted-dark': rgb(tint?.dark.muted),
  };
}
