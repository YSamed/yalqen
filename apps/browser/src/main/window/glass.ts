import type { BaseWindow } from 'electron';

export const glassAvailable = process.platform === 'darwin';

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
