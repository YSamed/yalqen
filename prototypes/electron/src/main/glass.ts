import type { BaseWindow } from 'electron';

/** The part of `electron-liquid-glass` used here. Only public API; no `unstable_*` calls. */
interface LiquidGlass {
  addView(handle: Buffer, options?: { cornerRadius?: number; tintColor?: string; opaque?: boolean }): number;
}

/**
 * Loads the native glass addon. It is an optional, macOS-only dependency, so on
 * other platforms (or if the addon fails to load) the window stays opaque.
 */
function loadLiquidGlass(): LiquidGlass | null {
  if (process.platform !== 'darwin') return null;
  try {
    const module = require('electron-liquid-glass') as { default?: LiquidGlass } & LiquidGlass;
    return module.default ?? module;
  } catch (error) {
    console.warn('[glass] electron-liquid-glass not available, using opaque window', error);
    return null;
  }
}

const liquidGlass = loadLiquidGlass();

/** True when the window can be created transparent with a system glass view behind the UI. */
export const glassAvailable = liquidGlass !== null;

/**
 * Puts the system glass material behind the whole window content: NSGlassEffectView
 * on macOS 26+, NSVisualEffectView on older macOS (done by the addon).
 * The window must have been created with `transparent: true`. Returns false when
 * no glass view was added, in which case the UI has to paint an opaque background.
 */
export function applyGlass(window: BaseWindow): boolean {
  if (!liquidGlass) return false;
  try {
    return liquidGlass.addView(window.getNativeWindowHandle()) >= 0;
  } catch (error) {
    console.warn('[glass] could not add glass view', error);
    return false;
  }
}
