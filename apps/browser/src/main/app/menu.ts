import { Menu, type MenuItemConstructorOptions } from 'electron';
import { AUTO_RELOAD_SECONDS, type DevCommandId, type DeviceId } from '../../shared/types.js';
import { t } from '../../shared/i18n.js';

interface DeviceMenuItem {
  id: DeviceId;
  label: string;
  checked: boolean;
}

interface MenuActions {
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
  home(): void;
  reload(): void;
  hardReload(): void;
  toggleReader(): void;
  zoom(direction: 1 | -1 | 0): void;
  togglePanel(): void;
  toggleSidebar(): void;
  toggleAgentPanel(): void;
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
  saveReadingPage(): void;
  showReadingList(): void;
  print(): void;
  savePdf(): void;
  savePage(): void;
  openFile(): void;
  viewSource(): void;
  devCommand(id: DevCommandId): void;
}

export function buildMenu(actions: MenuActions): Menu {
  const isMac = process.platform === 'darwin';
  const settingsItem: MenuItemConstructorOptions = {
    label: t('menu.settings'),
    accelerator: 'CmdOrCtrl+,',
    click: actions.openSettings,
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'Yalqen',
            submenu: [
              { label: t('menu.about'), role: 'about' },
              ...(actions.checkForUpdates
                ? [
                    {
                      label: t('menu.checkForUpdates'),
                      click: actions.checkForUpdates,
                    } satisfies MenuItemConstructorOptions,
                  ]
                : []),
              { type: 'separator' },
              settingsItem,
              { type: 'separator' },
              { label: t('menu.services'), role: 'services' },
              { type: 'separator' },
              { label: t('menu.hide'), role: 'hide' },
              { label: t('menu.hideOthers'), role: 'hideOthers' },
              { label: t('menu.showAll'), role: 'unhide' },
              { type: 'separator' },
              { label: t('menu.quit'), role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: t('menu.file'),
      submenu: [
        { label: t('menu.newWindow'), accelerator: 'CmdOrCtrl+N', click: actions.newWindow },
        { label: t('menu.newPrivateWindow'), accelerator: 'CmdOrCtrl+Shift+N', click: actions.newPrivateWindow },
        { label: t('menu.newDeveloperWindow'), click: actions.newDeveloperWindow },
        { type: 'separator' },
        { label: t('menu.closeWindow'), accelerator: 'CmdOrCtrl+Shift+W', click: actions.closeWindow },
        { type: 'separator' },
        { label: t('menu.addressBar'), accelerator: 'CmdOrCtrl+L', click: actions.focusAddress },
        { label: t('menu.openFile'), accelerator: 'CmdOrCtrl+O', click: actions.openFile },
        { type: 'separator' },
        { label: t('menu.savePage'), accelerator: 'CmdOrCtrl+S', click: actions.savePage },
        { label: t('menu.savePdf'), accelerator: 'CmdOrCtrl+Shift+S', click: actions.savePdf },
        { label: t('menu.screenshot'), click: () => actions.devCommand('screenshot') },
        {
          label: t('menu.fullPageScreenshot'),
          accelerator: 'CmdOrCtrl+Alt+S',
          click: () => actions.devCommand('full-page-screenshot'),
        },
        { label: t('menu.print'), accelerator: 'CmdOrCtrl+P', click: actions.print },
        ...(isMac ? [] : [{ type: 'separator' } as const, settingsItem]),
      ],
    },
    {
      label: t('menu.edit'),
      submenu: [
        { label: t('menu.undo'), role: 'undo' },
        { label: t('menu.redo'), role: 'redo' },
        { type: 'separator' },
        { label: t('menu.cut'), role: 'cut' },
        { label: t('menu.copy'), role: 'copy' },
        { label: t('menu.paste'), role: 'paste' },
        ...(isMac ? [{ label: t('menu.pasteAndMatchStyle'), role: 'pasteAndMatchStyle' } as const] : []),
        { label: t('menu.delete'), role: 'delete' },
        { label: t('menu.selectAll'), role: 'selectAll' },
        { type: 'separator' },
        { label: t('menu.find'), accelerator: 'CmdOrCtrl+F', click: actions.find },
        { label: t('menu.findNext'), accelerator: 'CmdOrCtrl+G', click: () => actions.findNext(true) },
        { label: t('menu.findPrevious'), accelerator: 'CmdOrCtrl+Shift+G', click: () => actions.findNext(false) },
      ],
    },
    {
      label: t('menu.bookmarks'),
      submenu: [
        { label: t('menu.toggleBookmark'), accelerator: 'CmdOrCtrl+D', click: actions.toggleBookmark },
        { label: t('menu.allBookmarks'), accelerator: 'CmdOrCtrl+Alt+B', click: actions.showBookmarks },
        { type: 'separator' },
        { label: t('readingList.savePage'), accelerator: 'CmdOrCtrl+Shift+D', click: actions.saveReadingPage },
        { label: t('readingList.title'), click: actions.showReadingList },
      ],
    },
    {
      label: t('menu.tab'),
      submenu: [
        { label: t('menu.newTab'), accelerator: 'CmdOrCtrl+T', click: actions.newTab },
        { label: t('menu.newPrivateTab'), click: actions.newPrivateTab },
        { label: t('menu.closeTab'), accelerator: 'CmdOrCtrl+W', click: actions.closeTab },
        {
          label: t('menu.reopenClosedTab'),
          accelerator: 'CmdOrCtrl+Shift+T',
          click: actions.reopenClosedTab,
        },
        { type: 'separator' },
        { label: t('menu.nextTab'), accelerator: 'Ctrl+Tab', click: actions.selectNextTab },
        { label: t('menu.previousTab'), accelerator: 'Ctrl+Shift+Tab', click: actions.selectPreviousTab },
        { label: t('menu.moveTabToNewWindow'), click: actions.moveTabToNewWindow },
        ...Array.from({ length: 9 }, (_, i): MenuItemConstructorOptions => ({
          label: i === 8 ? t('menu.lastTab') : t('menu.tabNumber', { number: i + 1 }),
          accelerator: `CmdOrCtrl+${i + 1}`,
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => actions.selectTab(i === 8 ? -1 : i),
        })),
      ],
    },
    {
      label: t('menu.view'),
      submenu: [
        { label: t('toolbar.home'), accelerator: 'Alt+Home', click: actions.home },
        { label: t('menu.reload'), accelerator: 'CmdOrCtrl+R', click: actions.reload },
        { label: t('menu.hardReload'), accelerator: 'CmdOrCtrl+Shift+R', click: actions.hardReload },
        { label: t('reader.toggle'), accelerator: 'CmdOrCtrl+Alt+R', click: actions.toggleReader },
        { label: t('menu.toggleCache'), click: () => actions.devCommand('toggle-cache') },
        {
          label: t('menu.autoReload'),
          submenu: [
            ...AUTO_RELOAD_SECONDS.map((seconds) => ({
              label:
                seconds < 60
                  ? t('menu.autoReloadSeconds', { seconds })
                  : t('menu.autoReloadMinutes', { count: seconds / 60 }),
              click: () => actions.devCommand(`auto-reload-${seconds}`),
            })),
            { type: 'separator' as const },
            { label: t('menu.autoReloadStop'), click: () => actions.devCommand('auto-reload-off') },
          ],
        },
        { type: 'separator' },
        { label: t('menu.actualSize'), accelerator: 'CmdOrCtrl+0', click: () => actions.zoom(0) },
        { label: t('menu.zoomIn'), accelerator: 'CmdOrCtrl+Plus', click: () => actions.zoom(1) },
        {
          label: t('menu.zoomIn'),
          accelerator: 'CmdOrCtrl+=',
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => actions.zoom(1),
        },
        { label: t('menu.zoomOut'), accelerator: 'CmdOrCtrl+-', click: () => actions.zoom(-1) },
        { label: t('menu.togglePanel'), accelerator: 'CmdOrCtrl+Shift+Y', click: actions.togglePanel },
        { label: t('menu.toggleToolbar'), accelerator: 'CmdOrCtrl+Shift+B', click: actions.toggleToolbar },
        { label: t('menu.toggleSidebar'), accelerator: 'CmdOrCtrl+Shift+U', click: actions.toggleSidebar },
        { label: t('agentPanel.toggle'), accelerator: 'CmdOrCtrl+Alt+A', click: actions.toggleAgentPanel },
        { type: 'separator' },
        { label: t('menu.viewSource'), accelerator: 'Alt+CmdOrCtrl+U', click: actions.viewSource },
        { label: t('menu.developerTools'), accelerator: 'Alt+CmdOrCtrl+I', click: actions.toggleDevTools },
        { label: t('menu.phoneView'), accelerator: 'Alt+CmdOrCtrl+M', click: actions.toggleDeviceView },
        {
          label: t('menu.pickElement'),
          accelerator: 'Alt+CmdOrCtrl+P',
          click: () => actions.devCommand('pick-element'),
        },
        {
          label: t('menu.device'),
          submenu: actions.devices.map((device) => ({
            label: device.label,
            type: 'radio' as const,
            checked: device.checked,
            click: () => actions.selectDevice(device.id),
          })),
        },
        { label: t('menu.rotateDevice'), accelerator: 'Shift+Alt+CmdOrCtrl+M', click: actions.rotateDevice },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
