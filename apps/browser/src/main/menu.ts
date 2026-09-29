import { Menu, type MenuItemConstructorOptions } from 'electron';
import { AUTO_RELOAD_SECONDS, type DevCommandId, type DeviceId } from '../shared/types.js';

export interface DeviceMenuItem {
  id: DeviceId;
  label: string;
  checked: boolean;
}

export interface MenuActions {
  newTab(): void;
  newWindow(): void;
  newPrivateWindow(): void;
  newPrivateTab(): void;
  newDeveloperWindow(): void;
  closeTab(): void;
  closeWindow(): void;
  moveTabToNewWindow(): void;
  reopenClosedTab(): void;
  selectNextTab(): void;
  selectPreviousTab(): void;
  selectTab(index: number): void;
  focusAddress(): void;
  find(): void;
  findNext(forward: boolean): void;
  reload(): void;
  hardReload(): void;
  zoom(direction: 1 | -1 | 0): void;
  togglePanel(): void;
  toggleSidebar(): void;
  toggleToolbar(): void;
  toggleDevTools(): void;
  toggleDeviceView(): void;
  rotateDevice(): void;
  devices: DeviceMenuItem[];
  selectDevice(id: DeviceId): void;
  openSettings(): void;
  checkForUpdates: (() => void) | null;
  toggleBookmark(): void;
  showBookmarks(): void;
  print(): void;
  savePdf(): void;
  viewSource(): void;
  devCommand(id: DevCommandId): void;
}

export function buildMenu(actions: MenuActions): Menu {
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
            label: 'Yalqen',
            submenu: [
              { label: 'Yalqen Hakkında', role: 'about' },
              ...(actions.checkForUpdates
                ? [
                    {
                      label: 'Güncellemeleri Denetle…',
                      click: actions.checkForUpdates,
                    } satisfies MenuItemConstructorOptions,
                  ]
                : []),
              { type: 'separator' },
              settingsItem,
              { type: 'separator' },
              { label: 'Servisler', role: 'services' },
              { type: 'separator' },
              { label: "Yalqen'i Gizle", role: 'hide' },
              { label: 'Diğerlerini Gizle', role: 'hideOthers' },
              { label: 'Tümünü Göster', role: 'unhide' },
              { type: 'separator' },
              { label: "Yalqen'den Çık", role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'Dosya',
      submenu: [
        { label: 'Yeni sekme', accelerator: 'CmdOrCtrl+T', click: actions.newTab },
        { label: 'Yeni pencere', accelerator: 'CmdOrCtrl+N', click: actions.newWindow },
        { label: 'Yeni gizli pencere', accelerator: 'CmdOrCtrl+Shift+N', click: actions.newPrivateWindow },
        { label: 'Yeni gizli sekme', click: actions.newPrivateTab },
        { label: 'Yeni geliştirici penceresi', click: actions.newDeveloperWindow },
        { type: 'separator' },
        { label: 'Sekmeyi kapat', accelerator: 'CmdOrCtrl+W', click: actions.closeTab },
        { label: 'Pencereyi kapat', accelerator: 'CmdOrCtrl+Shift+W', click: actions.closeWindow },
        {
          label: 'Kapatılan sekmeyi aç',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: actions.reopenClosedTab,
        },
        { type: 'separator' },
        { label: 'Adres çubuğu', accelerator: 'CmdOrCtrl+L', click: actions.focusAddress },
        { type: 'separator' },
        { label: 'PDF olarak kaydet…', accelerator: 'CmdOrCtrl+Shift+S', click: actions.savePdf },
        { label: 'Ekran görüntüsü al…', click: () => actions.devCommand('screenshot') },
        { label: 'Tam sayfa ekran görüntüsü al…', click: () => actions.devCommand('full-page-screenshot') },
        { label: 'Yazdır…', accelerator: 'CmdOrCtrl+P', click: actions.print },
        ...(isMac ? [] : [{ type: 'separator' } as const, settingsItem]),
      ],
    },
    {
      label: 'Düzen',
      submenu: [
        { label: 'Geri Al', role: 'undo' },
        { label: 'Yinele', role: 'redo' },
        { type: 'separator' },
        { label: 'Kes', role: 'cut' },
        { label: 'Kopyala', role: 'copy' },
        { label: 'Yapıştır', role: 'paste' },
        ...(isMac ? [{ label: 'Biçimlendirmeyi Eşleştirerek Yapıştır', role: 'pasteAndMatchStyle' } as const] : []),
        { label: 'Sil', role: 'delete' },
        { label: 'Tümünü Seç', role: 'selectAll' },
        { type: 'separator' },
        { label: 'Bul…', accelerator: 'CmdOrCtrl+F', click: actions.find },
        { label: 'Sonrakini bul', accelerator: 'CmdOrCtrl+G', click: () => actions.findNext(true) },
        { label: 'Öncekini bul', accelerator: 'CmdOrCtrl+Shift+G', click: () => actions.findNext(false) },
      ],
    },
    {
      label: 'Yer imleri',
      submenu: [
        { label: 'Bu sayfayı yer imlerine ekle/kaldır', accelerator: 'CmdOrCtrl+D', click: actions.toggleBookmark },
        { label: 'Tüm yer imleri', accelerator: 'CmdOrCtrl+Alt+B', click: actions.showBookmarks },
      ],
    },
    {
      label: 'Sekme',
      submenu: [
        { label: 'Sonraki sekme', accelerator: 'Ctrl+Tab', click: actions.selectNextTab },
        { label: 'Önceki sekme', accelerator: 'Ctrl+Shift+Tab', click: actions.selectPreviousTab },
        { label: 'Sekmeyi yeni pencereye taşı', click: actions.moveTabToNewWindow },
        ...Array.from({ length: 9 }, (_, i): MenuItemConstructorOptions => ({
          label: i === 8 ? 'Son sekme' : `Sekme ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => actions.selectTab(i === 8 ? -1 : i),
        })),
      ],
    },
    {
      label: 'Görünüm',
      submenu: [
        { label: 'Yenile', accelerator: 'CmdOrCtrl+R', click: actions.reload },
        { label: 'Önbelleği yok sayarak yenile', accelerator: 'CmdOrCtrl+Shift+R', click: actions.hardReload },
        { label: 'Bu sekmede önbelleği kapat/aç', click: () => actions.devCommand('toggle-cache') },
        {
          label: 'Otomatik yenile',
          submenu: [
            ...AUTO_RELOAD_SECONDS.map((seconds) => ({
              label: seconds < 60 ? `Her ${seconds} saniyede` : `Her ${seconds / 60} dakikada`,
              click: () => actions.devCommand(`auto-reload-${seconds}`),
            })),
            { type: 'separator' as const },
            { label: 'Durdur', click: () => actions.devCommand('auto-reload-off') },
          ],
        },
        { type: 'separator' },
        { label: 'Varsayılan boyut', accelerator: 'CmdOrCtrl+0', click: () => actions.zoom(0) },
        { label: 'Yakınlaştır', accelerator: 'CmdOrCtrl+Plus', click: () => actions.zoom(1) },
        {
          label: 'Yakınlaştır',
          accelerator: 'CmdOrCtrl+=',
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => actions.zoom(1),
        },
        { label: 'Uzaklaştır', accelerator: 'CmdOrCtrl+-', click: () => actions.zoom(-1) },
        { label: 'Sekme panelini daralt/genişlet', accelerator: 'CmdOrCtrl+S', click: actions.togglePanel },
        { label: 'Üst menüyü göster/gizle', accelerator: 'CmdOrCtrl+Shift+B', click: actions.toggleToolbar },
        { label: 'Yan menüyü göster/gizle', accelerator: 'CmdOrCtrl+Shift+U', click: actions.toggleSidebar },
        { type: 'separator' },
        { label: 'Sayfa kaynağı', accelerator: 'Alt+CmdOrCtrl+U', click: actions.viewSource },
        { label: 'Sayfa geliştirici araçları', accelerator: 'Alt+CmdOrCtrl+I', click: actions.toggleDevTools },
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
  ];

  return Menu.buildFromTemplate(template);
}
