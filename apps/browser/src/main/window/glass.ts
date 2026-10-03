import type { BaseWindow } from 'electron';

interface LiquidGlass {
  addView(handle: Buffer, options?: { cornerRadius?: number; tintColor?: string; opaque?: boolean }): number;
}

function loadLiquidGlass(): LiquidGlass | null {
  if (process.platform !== 'darwin') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module, loaded only on macOS
    const module = require('electron-liquid-glass') as { default?: LiquidGlass } & LiquidGlass;
    return module.default ?? module;
  } catch (error) {
    console.warn('[glass] electron-liquid-glass not available, using opaque window', error);
    return null;
  }
}

const liquidGlass = loadLiquidGlass();

export const glassAvailable = liquidGlass !== null;

export function applyGlass(window: BaseWindow): boolean {
  if (!liquidGlass) return false;
  try {
    return liquidGlass.addView(window.getNativeWindowHandle()) >= 0;
  } catch (error) {
    console.warn('[glass] could not add glass view', error);
    return false;
  }
}
