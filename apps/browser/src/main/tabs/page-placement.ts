import type { Rectangle, WebContentsView } from 'electron';
import { NEW_TAB_URL, PageChannel, type DeviceFrame, type NewTabCenter } from '../../shared/types.js';
import { applyDeviceMetrics, applyEmulation, clearEmulation, fitDevice } from '../devtools/devices.js';
import { liveContents, type Tab } from './tab.js';

export const SPLIT_GAP = 6;

export interface PaneSlot {
  index: number;
  count: number;
}

export function slotRect(bounds: Rectangle, { index, count }: PaneSlot, gap = SPLIT_GAP): Rectangle {
  if (count < 2) return bounds;
  const free = Math.max(0, bounds.width - gap * (count - 1));
  const left = Math.round((free * index) / count);
  const right = Math.round((free * (index + 1)) / count);
  return { x: bounds.x + left + gap * index, y: bounds.y, width: right - left, height: bounds.height };
}

export class PagePlacement {
  bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  radius = 0;
  newTabCenterOffset = 0;

  constructor(private readonly slotOf: (tab: Tab) => PaneSlot | null = () => null) {}

  area(tab: Tab): Rectangle {
    const slot = this.slotOf(tab);
    return slot ? slotRect(this.bounds, slot) : this.bounds;
  }

  place(tab: Tab, view: WebContentsView, metricsOnly = false): Promise<void> | null {
    const area = this.area(tab);
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

  newTabCenter(tab: Tab): NewTabCenter {
    const contents = liveContents(tab);
    const zoom = contents ? contents.getZoomFactor() : 1;
    if (tab.emulation) return { offset: 0, width: null };
    if (this.slotOf(tab)) return { offset: 0, width: this.area(tab).width / zoom };
    return { offset: this.newTabCenterOffset / zoom, width: this.bounds.width / zoom };
  }

  syncNewTabCenter(tab: Tab): void {
    if (tab.url !== NEW_TAB_URL) return;
    liveContents(tab)?.send(PageChannel.newTabCenter, this.newTabCenter(tab));
  }
}
