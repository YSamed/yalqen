import type { ChromeLayout } from '../../shared/types.js';

interface PageFrame {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

// A reflowing page resizes with the sliding panel so centered content stays centered every frame, like Dia's new tab.
export function pageFrame(
  width: number,
  height: number,
  layout: ChromeLayout,
  pageFullScreen: boolean,
  reflow = false,
): PageFrame {
  if (pageFullScreen) return { x: 0, y: 0, width, height, radius: 0 };
  const slide = layout.panelSlide;
  const panel = layout.panelWidth + (reflow ? slide : 0);
  return {
    x: layout.panelSide === 'left' ? layout.panelWidth + slide : layout.pageInset - (reflow ? 0 : slide),
    y: layout.chromeHeight,
    width: Math.max(0, width - panel - layout.pageInset - (layout.agentPanelWidth ?? 0)),
    height: Math.max(0, height - layout.chromeHeight - layout.pageInset),
    radius: layout.pageRadius,
  };
}
