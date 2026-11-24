import { DEFAULT_FRAME_THEME, frameGradient, readableFrameAmount } from '../../shared/frame-theme';
import type { BrowserState, TabSnapshot } from '../../shared/types';
import { windowTintVars } from '../../shared/window-color';

export type ChromeMode = 'normal' | 'developer' | 'private';

const PRIVATE_ACCENT = '#d4d4d8';

export function chromeMode(browser: BrowserState, activeTab: TabSnapshot | null): ChromeMode {
  if (!browser.tabModes) return 'normal';
  if (browser.developer || activeTab?.developer) return 'developer';
  return activeTab?.isPrivate ? 'private' : 'normal';
}

// Every renderer that shows browser chrome themes itself from these root attributes and variables.
export function applyRootTheme(browser: BrowserState, mode: ChromeMode, dark: boolean): void {
  const root = document.documentElement;
  root.dataset.material = browser.material;
  root.dataset.mode = mode;
  root.dataset.style = 'card';
  root.style.setProperty('--accent', mode === 'private' ? PRIVATE_ACCENT : browser.accent);
  for (const [name, value] of Object.entries(windowTintVars(browser.windowColor))) {
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  // The frame palette colors the card frame, so the window color never applies there.
  root.removeAttribute('data-window-color');
  root.toggleAttribute('data-fullscreen', browser.windowFullScreen);
  const frameTheme =
    browser.spaces.find((space) => space.id === browser.activeSpaceId)?.theme ??
    browser.frameTheme ??
    DEFAULT_FRAME_THEME;
  const frameColors = frameTheme.colors;
  const frameAmount = readableFrameAmount(frameColors, frameTheme.intensity, dark ? 'dark' : 'light', false);
  const framed = frameColors.length > 0 && frameAmount > 0;
  if (framed) {
    root.style.setProperty('--frame-gradient', frameGradient(frameColors, frameAmount));
    root.style.setProperty('--frame-primary', frameColors[0]!);
  } else {
    root.style.removeProperty('--frame-gradient');
    root.style.removeProperty('--frame-primary');
  }
  root.toggleAttribute('data-frame', framed);
  root.dataset.frameTexture = frameTheme.textureStrength > 0 ? frameTheme.texture : 'none';
  root.style.setProperty('--frame-texture-strength', String(frameTheme.textureStrength / 100));
}
