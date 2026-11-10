import type { AnchorRect } from './types.js';

export interface TooltipTheme {
  dark: boolean;
  surface: string;
  text: string;
  accent: string;
  border: string;
}

export interface TooltipRequest {
  text: string;
  keys: string[];
  anchor: AnchorRect;
  theme: TooltipTheme;
}

export interface TooltipSize {
  width: number;
  height: number;
}

export const TOOLTIP_GAP = 6;
export const TOOLTIP_EDGE = 8;
export const TOOLTIP_MAX_TEXT = 200;

// Titles carry their shortcut at the end, as in "Reload (⌘R)"; the tooltip draws it as key caps.
const SHORTCUT = /^(.*\S)\s*\(([⌃⌥⇧⌘]+)([^\s()]{1,6})\)$/u;

export function splitShortcut(title: string): { text: string; keys: string[] } {
  const match = SHORTCUT.exec(title.trim());
  if (!match) return { text: title.trim(), keys: [] };
  return { text: match[1], keys: [...match[2], match[3].toUpperCase()] };
}

// Below the anchor and centred on it, kept inside the window; above it when there is no room below.
export function placeTooltip(anchor: AnchorRect, size: TooltipSize, area: TooltipSize): { x: number; y: number } {
  const centered = anchor.x + anchor.width / 2 - size.width / 2;
  const x = Math.max(TOOLTIP_EDGE, Math.min(centered, area.width - size.width - TOOLTIP_EDGE));
  const below = anchor.y + anchor.height + TOOLTIP_GAP;
  const y = below + size.height <= area.height - TOOLTIP_EDGE ? below : anchor.y - TOOLTIP_GAP - size.height;
  return { x: Math.round(x), y: Math.round(Math.max(TOOLTIP_EDGE, y)) };
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function shortString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

// The request comes from the browser interface over IPC; anything unexpected is dropped.
export function validTooltip(value: unknown): TooltipRequest | null {
  if (typeof value !== 'object' || value === null) return null;
  const { text, keys, anchor, theme } = value as Record<string, unknown>;
  if (!shortString(text, TOOLTIP_MAX_TEXT)) return null;
  if (!Array.isArray(keys) || keys.length > 6 || !keys.every((key) => shortString(key, 6))) return null;
  const rect = anchor as Record<string, unknown> | null;
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(finite)) return null;
  const colors = theme as Record<string, unknown> | null;
  if (!colors || typeof colors.dark !== 'boolean') return null;
  if (![colors.surface, colors.text, colors.accent, colors.border].every((color) => shortString(color, 120)))
    return null;
  return {
    text,
    keys: keys as string[],
    anchor: { x: rect.x as number, y: rect.y as number, width: rect.width as number, height: rect.height as number },
    theme: {
      dark: colors.dark,
      surface: colors.surface as string,
      text: colors.text as string,
      accent: colors.accent as string,
      border: colors.border as string,
    },
  };
}
