import { nativeTheme, systemPreferences, type BaseWindow } from 'electron';

export const glassAvailable = process.platform === 'darwin';

// A transparent window flashes dark grey for one frame after a Stage Manager switch, so the window stays opaque
// and uses vibrancy; Liquid Glass shows nothing behind an opaque window.
export function applyGlass(window: BaseWindow): boolean {
  if (!glassAvailable) return false;
  try {
    window.setVibrancy('hud');
    matchSystemBackground(window);
    return true;
  } catch (error) {
    console.warn('[glass] could not set vibrancy', error);
    return false;
  }
}

// An opaque window defaults to white, which shows at the frame edge during Stage Manager switches.
function matchSystemBackground(window: BaseWindow): void {
  const sync = () => window.setBackgroundColor(systemPreferences.getColor('window-background'));
  sync();
  nativeTheme.on('updated', sync);
  window.once('closed', () => nativeTheme.off('updated', sync));
}
