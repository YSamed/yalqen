import type { ChromeLayout } from '../../shared/types.js';

export interface PageFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

export function pageFrame(width: number, height: number, layout: ChromeLayout, pageFullScreen: boolean): PageFrame {
  if (pageFullScreen) return { x: 0, y: 0, width, height, radius: 0 };
  return {
    x: layout.panelSide === 'left' ? layout.panelWidth + layout.panelSlide : layout.pageInset - layout.panelSlide,
    y: layout.chromeHeight,
    width: Math.max(0, width - layout.panelWidth - layout.pageInset - (layout.agentPanelWidth ?? 0)),
    height: Math.max(0, height - layout.chromeHeight - layout.pageInset),
    radius: layout.pageRadius,
  };
}
