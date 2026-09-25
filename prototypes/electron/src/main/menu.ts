import { Menu, app, type MenuItemConstructorOptions } from 'electron';
import type { DeviceId } from '../shared/types.js';

export interface DeviceMenuItem {
  id: DeviceId;
  label: string;
  checked: boolean;
}

export interface MenuActions {
  newTab(): void;
  closeTab(): void;
  reopenClosedTab(): void;
  focusAddress(): void;
  reload(): void;
  goBack(): void;
  goForward(): void;
  togglePanel(): void;
  toggleDevTools(): void;
  toggleDeviceView(): void;
  rotateDevice(): void;
  devices: DeviceMenuItem[];
  selectDevice(id: DeviceId): void;
  selectTab(index: number): void;
  openPageSet(): void;
  discardBackground(): void;
  simulateMemoryPressure(): void;
  recordSnapshot(): void;
  openSettings(): void;
}

/** Shortcuts live in the app menu so they work while a page has focus. */
export function buildMenu(actions: MenuActions): Menu {
  const tabShortcuts: MenuItemConstructorOptions[] = Array.from({ length: 9 }, (_, i) => ({
    label: i === 8 ? 'Son sekme' : `Sekme ${i + 1}`,
    accelerator: `CmdOrCtrl+${i + 1}`,
    click: () => actions.selectTab(i === 8 ? -1 : i),
  }));

  const isMac = process.platform === 'darwin';
  const settingsItem: MenuItemConstructorOptions = {
    label: 'Ayarlar…',
    accelerator: 'CmdOrCtrl+,',
    click: actions.openSettings,
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              settingsItem,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'Dosya',
      submenu: [
        { label: 'Yeni sekme', accelerator: 'CmdOrCtrl+T', click: actions.newTab },
        { label: 'Sekmeyi kapat', accelerator: 'CmdOrCtrl+W', click: actions.closeTab },
        {
          label: 'Kapatılan sekmeyi aç',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: actions.reopenClosedTab,
        },
        { type: 'separator' },
        { label: 'Adres çubuğu', accelerator: 'CmdOrCtrl+L', click: actions.focusAddress },
        ...(isMac ? [] : [{ type: 'separator' } as const, settingsItem]),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'Görünüm',
      submenu: [
        { label: 'Yenile', accelerator: 'CmdOrCtrl+R', click: actions.reload },
        { label: 'Sekme panelini daralt/genişlet', accelerator: 'CmdOrCtrl+S', click: actions.togglePanel },
        { type: 'separator' },
        { label: 'Sayfa DevTools', accelerator: 'Alt+CmdOrCtrl+I', click: actions.toggleDevTools },
        { label: 'Telefon görünümü', accelerator: 'Alt+CmdOrCtrl+M', click: actions.toggleDeviceView },
        {
          label: 'Cihaz',
          submenu: actions.devices.map((device) => ({
            label: device.label,
            type: 'radio' as const,
            checked: device.checked,
            click: () => actions.selectDevice(device.id),
          })),
        },
        { label: 'Cihazı döndür', accelerator: 'Shift+Alt+CmdOrCtrl+M', click: actions.rotateDevice },
      ],
    },
    {
      label: 'Geçmiş',
      submenu: [
        { label: 'Geri', accelerator: 'CmdOrCtrl+[', click: actions.goBack },
        { label: 'İleri', accelerator: 'CmdOrCtrl+]', click: actions.goForward },
      ],
    },
    { label: 'Sekmeler', submenu: tabShortcuts },
    {
      label: 'Ölçüm',
      submenu: [
        { label: 'Sayfa setini aç', click: actions.openPageSet },
        { label: 'Arka plan sekmelerini bellekten çıkar', click: actions.discardBackground },
        { label: 'Bellek baskısı sinyali gönder', click: actions.simulateMemoryPressure },
        { label: 'Bellek ölçümü kaydet', accelerator: 'CmdOrCtrl+Shift+M', click: actions.recordSnapshot },
      ],
    },
    { role: 'windowMenu' },
  ];

  return Menu.buildFromTemplate(template);
}
