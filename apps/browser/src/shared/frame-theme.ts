import { MIN_CONTRAST, WINDOW_BASES, contrastRatio, mix, parseHex, type Rgb, type Scheme } from './window-color.js';

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
const FULLSCREEN_BASES: Record<Scheme, Rgb> = { light: [255, 255, 255], dark: [0, 0, 0] };

// Lowers the mix until the sidebar text stays readable on every color, so a bright yellow cannot wash out white text.
export function readableFrameAmount(colors: string[], intensity: number, scheme: Scheme, fullscreen: boolean): number {
  const base = (fullscreen ? FULLSCREEN_BASES : CARD_SIDEBAR_BASES)[scheme];
  const text = WINDOW_BASES[scheme].text;
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

const PAD_LIGHT_TOP = 85;
const PAD_LIGHT_RANGE = 60;
const PAD_SATURATION = 0.85;

// The color pad maps x to hue and y to lightness at a fixed saturation, like Arc's theme picker.
export function padColor(x: number, y: number): string {
  const hue = x * 360;
  const lightness = (PAD_LIGHT_TOP - y * PAD_LIGHT_RANGE) / 100;
  const chroma = PAD_SATURATION * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12;
    const value = lightness - chroma * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function padPoint(hex: string): { x: number; y: number } {
  const [r, g, b] = parseHex(hex).map((channel) => channel / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = ((g - b) / delta) % 6;
    else if (max === g) hue = (b - r) / delta + 2;
    else hue = (r - g) / delta + 4;
  }
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return {
    x: clamp(((((hue * 60) % 360) + 360) % 360) / 360),
    y: clamp((PAD_LIGHT_TOP - ((max + min) / 2) * 100) / PAD_LIGHT_RANGE),
  };
}
