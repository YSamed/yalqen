import type { BaseWindow } from 'electron';

export const glassAvailable = process.platform === 'darwin';

// A transparent window flashes dark grey for one frame after a Stage Manager switch, so the window stays opaque
// and uses vibrancy; Liquid Glass shows nothing behind an opaque window.
export function applyGlass(window: BaseWindow): boolean {
  if (!glassAvailable) return false;
  try {
    window.setVibrancy('hud');
    // An opaque colour stops the compositor clearing see-through chrome, so translucent controls pile up into white.
    window.setBackgroundColor('#00000000');
    return true;
  } catch (error) {
    console.warn('[glass] could not set vibrancy', error);
    return false;
  }
}
