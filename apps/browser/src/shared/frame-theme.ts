type Rgb = readonly [number, number, number];
type Scheme = 'light' | 'dark';

const TEXT_COLORS: Record<Scheme, Rgb> = { light: [26, 27, 30], dark: [243, 243, 244] };
const MIN_CONTRAST = 4.5;

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

function contrastRatio(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

export type FrameTexture = 'none' | 'grain' | 'dots';

export interface FrameTheme {
  colors: string[];
  intensity: number;
  texture: FrameTexture;
  textureStrength: number;
}

export const MAX_FRAME_COLORS = 3;
export const DEFAULT_FRAME_THEME: FrameTheme = {
  colors: ['#de5a92'],
  intensity: 50,
  texture: 'none',
  textureStrength: 40,
};

const HEX_COLOR = /^#[0-9a-f]{6}$/;
const TEXTURES = new Set<string>(['none', 'grain', 'dots'] satisfies FrameTexture[]);

const percent = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(100, Math.max(0, value))) : fallback;

export function spaceFrameTheme(value: unknown): FrameTheme | undefined {
  return typeof value === 'object' && value !== null ? sanitizeFrameTheme(value) : undefined;
}

export function sanitizeFrameTheme(value: unknown, base: FrameTheme = DEFAULT_FRAME_THEME): FrameTheme {
  const input = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const colors = Array.isArray(input.colors)
    ? input.colors
        .filter((color): color is string => typeof color === 'string')
        .map((color) => color.toLowerCase())
        .filter((color) => HEX_COLOR.test(color))
        .slice(0, MAX_FRAME_COLORS)
    : [];
  return {
    colors: colors.length > 0 ? colors : base.colors,
    intensity: percent(input.intensity, base.intensity),
    texture:
      typeof input.texture === 'string' && TEXTURES.has(input.texture) ? (input.texture as FrameTexture) : base.texture,
    textureStrength: percent(input.textureStrength, base.textureStrength),
  };
}

const CARD_SIDEBAR_BASES: Record<Scheme, Rgb> = { light: [220, 220, 248], dark: [31, 34, 46] };

// Lowers the mix until the sidebar text stays readable on every color, so a bright yellow cannot wash out white text.
export function readableFrameAmount(colors: string[], intensity: number, scheme: Scheme): number {
  const base = CARD_SIDEBAR_BASES[scheme];
  const text = TEXT_COLORS[scheme];
  for (let amount = intensity; amount > 0; amount -= 5) {
    const readable = colors.every(
      (color) => contrastRatio(mix(base, parseHex(color), amount / 100), text) >= MIN_CONTRAST,
    );
    if (readable) return amount;
  }
  return 0;
}

export function frameGradient(colors: string[], amount: number): string {
  const stop = (color: string, base: string) =>
    `color-mix(in srgb, rgb(from ${color} r g b / var(--card-frame-alpha, 1)) ${amount}%, ` +
    `rgb(from var(${base}) r g b / var(--card-frame-alpha, 1)))`;
  if (colors.length === 1) {
    return `linear-gradient(to bottom, ${stop(colors[0]!, '--card-sidebar-top')}, ${stop(colors[0]!, '--card-sidebar-bottom')})`;
  }
  const stops = colors.map((color, index) => stop(color, index === 0 ? '--card-sidebar-top' : '--card-sidebar-bottom'));
  return `linear-gradient(160deg, ${stops.join(', ')})`;
}
