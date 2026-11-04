import type { BaseWindow } from 'electron';

export const glassAvailable = process.platform === 'darwin';

// The window must be created transparent: on an opaque window Chromium skips clearing see-through chrome,
// which leaves ghost copies with partial swap and piles translucent controls into white without it.
export function applyGlass(window: BaseWindow): boolean {
  if (!glassAvailable) return false;
  try {
    window.setVibrancy('hud');
    window.setBackgroundColor('#00000000');
    return true;
  } catch (error) {
    console.warn('[glass] could not set vibrancy', error);
    return false;
  }
}
