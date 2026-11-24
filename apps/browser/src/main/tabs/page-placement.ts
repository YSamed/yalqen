import type { Rectangle, WebContentsView } from 'electron';
import type { DeviceFrame } from '../../shared/types.js';
import { applyDeviceMetrics, applyEmulation, clearEmulation, fitDevice } from '../devtools/devices.js';
import type { Tab } from './tab.js';
import { SPLIT_GAP, slotRect, type PaneSlot } from '../../shared/split-layout.js';

export { SPLIT_GAP, slotRect, type PaneSlot };

export const DEVTOOLS_MIN_WIDTH = 280;
const PAGE_MIN_WIDTH = 320;

export function devToolsSplit(
  area: Rectangle,
  width: number | null,
  gap = SPLIT_GAP,
): { page: Rectangle; tools: Rectangle } {
  const room = Math.max(0, area.width - gap);
  const most = Math.max(Math.min(DEVTOOLS_MIN_WIDTH, Math.floor(room / 2)), room - PAGE_MIN_WIDTH);
  const tools = Math.max(0, Math.min(Math.max(width ?? Math.round(area.width * 0.4), DEVTOOLS_MIN_WIDTH), most));
  return {
    page: { x: area.x, y: area.y, width: room - tools, height: area.height },
    tools: { x: area.x + area.width - tools, y: area.y, width: tools, height: area.height },
  };
}

export class PagePlacement {
  bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  radius = 0;
  devToolsWidth: number | null = null;

  constructor(private readonly slotOf: (tab: Tab) => PaneSlot | null = () => null) {}

  area(tab: Tab): Rectangle {
    const slot = this.slotOf(tab);
    return slot ? slotRect(this.bounds, slot) : this.bounds;
  }

  place(tab: Tab, view: WebContentsView, metricsOnly = false): Promise<void> | null {
    const area = this.pageArea(tab);
    if (!tab.emulation) {
      view.setBorderRadius(this.radius);
      view.setBounds(area);
      return null;
    }
    const frame = fitDevice(tab.emulation, area);
    view.setBorderRadius(Math.round(frame.cornerRadius * frame.scale));
    view.setBounds({
      x: area.x + frame.x,
      y: area.y + frame.y,
      width: frame.viewWidth,
      height: frame.viewHeight,
    });
    const apply = metricsOnly ? applyDeviceMetrics : applyEmulation;
    return apply(view.webContents, tab.emulation, frame.scale).catch((error: unknown) => {
      console.warn('[emulation] could not apply device overrides:', error);
    });
  }

  pageArea(tab: Tab): Rectangle {
    const area = this.area(tab);
    const tools = tab.devToolsShown ? tab.devTools : null;
    if (!tools) return area;
    const split = devToolsSplit(area, this.devToolsWidth);
    tools.setBorderRadius(this.radius);
    tools.setBounds(split.tools);
    return split.page;
  }

  devToolsDivider(tab: Tab): (Rectangle & { value: number }) | null {
    if (!tab.devToolsShown || !tab.devTools) return null;
    const area = this.area(tab);
    const { page, tools } = devToolsSplit(area, this.devToolsWidth);
    const value = area.width > 0 ? Math.round((tools.width / area.width) * 100) : 0;
    return { x: page.x + page.width, y: page.y, width: SPLIT_GAP, height: page.height, value };
  }

  clearDevice(tab: Tab, view: WebContentsView): Promise<void> {
    this.place(tab, view);
    return clearEmulation(view.webContents).catch((error: unknown) => {
      console.warn('[emulation] could not clear device overrides:', error);
    });
  }

  deviceFrame(tab: Tab | undefined): DeviceFrame | null {
    if (!tab?.emulation) return null;
    const area = this.area(tab);
    const frame = fitDevice(tab.emulation, area);
    return { ...frame, x: frame.x + area.x - this.bounds.x };
  }
}
