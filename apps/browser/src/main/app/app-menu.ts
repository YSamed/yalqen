import { BaseWindow, Menu, dialog } from 'electron';
import { toggleReader } from '../pages/reader.js';
import { t } from '../../shared/i18n.js';
import { NEW_TAB_URL, type DeviceId } from '../../shared/types.js';
import { DEVICES } from '../devtools/devices.js';
import type { WindowOptions, YalqenWindow } from '../window/window.js';
import { buildMenu } from './menu.js';
import type { SettingsStore } from './settings.js';
import type { Updater } from './updater.js';

export interface AppMenuHost {
  current(): YalqenWindow | null;
  openWindow(options: WindowOptions): YalqenWindow;
  settings: SettingsStore;
  updateSettings(patch: unknown): void;
  updater: Updater;
  toggleBookmark(url: string, title: string): void;
  saveReadingPage(window: YalqenWindow): void;
  deviceId(): DeviceId;
  selectDevice(id: DeviceId): void;
}

export function installAppMenu(host: AppMenuHost): void {
  const { settings, updateSettings, updater } = host;
  const current = () => host.current();
  const from = () => current() ?? undefined;
  const inWindow = (run: (window: YalqenWindow) => void) => () => {
    const window = current();
    run(window && !window.window.isDestroyed() ? window : host.openWindow({}));
  };
  Menu.setApplicationMenu(
    buildMenu({
      newTab: inWindow((window) => window.tabs.open()),
      newWindow: () => host.openWindow({ from: from() }),
      newPrivateWindow: () => host.openWindow({ isPrivate: true, from: from() }),
      newDeveloperWindow: () => host.openWindow({ developer: true, from: from() }),
      newPrivateTab: inWindow((window) => window.tabs.open(NEW_TAB_URL, { isPrivate: true })),
      closeTab: () => {
        const tabs = current()?.tabs;
        if (tabs && tabs.selectedTabIds.length > 1) void tabs.closeSelected();
        else if (tabs?.activeTabId) tabs.close(tabs.activeTabId);
      },
      closeWindow: () => BaseWindow.getFocusedWindow()?.close(),
      reopenClosedTab: inWindow((window) => window.tabs.reopenClosed()),
      moveTabToNewWindow: inWindow((window) => window.moveActiveTabToNewWindow()),
      selectNextTab: inWindow((window) => window.tabs.selectRelative(1)),
      selectPreviousTab: inWindow((window) => window.tabs.selectRelative(-1)),
      selectTab: (index) => current()?.tabs.selectByIndex(index),
      focusAddress: inWindow((window) => window.openAddress()),
      find: () => current()?.openFind(),
      findNext: (forward) => current()?.openFind(forward),
      home: inWindow((window) => window.goHome()),
      reload: () => current()?.tabs.reload(),
      hardReload: () => current()?.tabs.reloadIgnoringCache(),
      toggleReader: () => {
        const window = current(),
          contents = window?.tabs.activeContents();
        if (!window || !contents) return;
        const url = contents.getURL();
        void toggleReader(contents, () => window.tabs.activeContents() === contents).then((opened) => {
          if (
            opened === false &&
            !contents.isDestroyed() &&
            !window.window.isDestroyed() &&
            window.tabs.activeContents() === contents &&
            contents.getURL() === url
          )
            void dialog.showMessageBox(window.window, { type: 'info', message: t('reader.unavailable') });
        });
      },
      zoom: (direction) => current()?.tabs.zoom(direction),
      togglePanel: () => updateSettings({ panelCollapsed: !settings.get().panelCollapsed }),
      toggleSidebar: () => updateSettings({ sidebarVisible: !settings.get().sidebarVisible }),
      toggleAgentPanel: () => current()?.toggleAgentPanel(),
      toggleToolbar: () => updateSettings({ toolbarVisible: !settings.get().toolbarVisible }),
      toggleDevTools: () => current()?.tabs.toggleDevTools(),
      toggleDeviceView: () => current()?.tabs.toggleEmulation(host.deviceId()),
      rotateDevice: () => current()?.tabs.rotateDevice(),
      devices: DEVICES.map((device) => ({
        id: device.id,
        label: device.label,
        checked: device.id === host.deviceId(),
      })),
      selectDevice: (id) => {
        host.selectDevice(id);
        current()?.tabs.selectDevice(id);
      },
      openSettings: inWindow((window) => window.tabs.openSettings()),
      checkForUpdates:
        updater.status().state === 'unavailable'
          ? null
          : inWindow((window) => {
              updater.check();
              window.tabs.openSettings();
            }),
      toggleBookmark: () => {
        const page = current()?.tabs.activePage();
        if (page) host.toggleBookmark(page.url, page.title);
      },
      showBookmarks: inWindow((window) => window.tabs.openBookmarks()),
      saveReadingPage: inWindow((window) => host.saveReadingPage(window)),
      showReadingList: inWindow((window) => window.tabs.openReadingList()),
      print: () => current()?.print(),
      savePdf: () => void current()?.savePageAsPdf(),
      savePage: () => void current()?.savePageOffline(),
      openFile: inWindow((window) => void window.openLocalFiles()),
      viewSource: () => current()?.tabs.viewSource(),
      devCommand: (id) => current()?.runDevCommand(id),
    }),
  );
}
