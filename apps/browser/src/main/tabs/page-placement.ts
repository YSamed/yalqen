import type { Rectangle, WebContentsView } from 'electron';
import { NEW_TAB_URL, PageChannel, type DeviceFrame, type NewTabCenter } from '../../shared/types.js';
import { applyDeviceMetrics, applyEmulation, clearEmulation, fitDevice } from '../devtools/devices.js';
import { liveContents, type Tab } from './tab.js';

export class PagePlacement {
  bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  radius = 0;
  newTabCenterOffset = 0;

  place(tab: Tab, view: WebContentsView, metricsOnly = false): Promise<void> | null {
    if (!tab.emulation) {
      view.setBorderRadius(this.radius);
      view.setBounds(this.bounds);
      return null;
    }
    const frame = fitDevice(tab.emulation, this.bounds);
    view.setBorderRadius(Math.round(frame.cornerRadius * frame.scale));
    view.setBounds({
      x: this.bounds.x + frame.x,
      y: this.bounds.y + frame.y,
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
    return tab?.emulation ? fitDevice(tab.emulation, this.bounds) : null;
  }

  newTabCenter(tab: Tab): NewTabCenter {
    const contents = liveContents(tab);
    const zoom = contents ? contents.getZoomFactor() : 1;
    if (tab.emulation) return { offset: 0, width: null };
    return { offset: this.newTabCenterOffset / zoom, width: this.bounds.width / zoom };
  }

  syncNewTabCenter(tab: Tab): void {
    if (tab.url !== NEW_TAB_URL) return;
    liveContents(tab)?.send(PageChannel.newTabCenter, this.newTabCenter(tab));
  }
}
