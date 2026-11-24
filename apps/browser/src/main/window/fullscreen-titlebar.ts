import path from 'node:path';
import type { BaseWindow } from 'electron';
import { IS_MAC } from '../platform.js';

interface FullScreenTitlebarModule {
  hideFullScreenTitlebar(): void;
  menuBarEdge(handle: Buffer): number | null;
}

let loaded: FullScreenTitlebarModule | null | undefined;

// Without the macOS module native full screen keeps its title strip and the content does not slide.
function nativeModule(): FullScreenTitlebarModule | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  if (!IS_MAC) return loaded;
  try {
    const module = { exports: {} as FullScreenTitlebarModule };
    process.dlopen(module, path.join(__dirname, '../../native/fullscreen-titlebar.node'));
    module.exports.hideFullScreenTitlebar();
    loaded = module.exports;
  } catch (error) {
    console.warn('Native full-screen title strip stays visible:', error);
  }
  return loaded;
}

export function hideFullScreenTitlebar(): void {
  nativeModule();
}

export function menuBarEdge(window: BaseWindow): number | null {
  return nativeModule()?.menuBarEdge(window.getNativeWindowHandle()) ?? null;
}
