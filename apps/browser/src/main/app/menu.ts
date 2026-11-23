import { Menu, type MenuItemConstructorOptions } from 'electron';
import { AUTO_RELOAD_SECONDS, type DevCommandId, type DeviceId } from '../../shared/types.js';
import { t } from '../../shared/i18n.js';
import { shortcutAccelerator, type ShortcutId, type ShortcutOverrides } from '../../shared/shortcuts.js';

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
  showArchive(): void;
  cleanTabs(): void;
  selectNextTab(): void;
  selectPreviousTab(): void;
  selectTab(index: number): void;
  switchSpace(index: number): void;
  focusAddress(): void;
  find(): void;
  findNext(forward: boolean): void;
  home(): void;
  reload(): void;
  hardReload(): void;
  toggleReader(): void;
  zoom(direction: 1 | -1 | 0): void;
  cyclePanel(): void;
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
  showWorkspaces(): void;
  showBoosts(): void;
  hideElement(): void;
  showEasels(): void;
  clipToEasel(): void;
  installWebApp(): void;
  manageWebApps(): void;
  showReadingList(): void;
  print(): void;
  savePdf(): void;
  savePage(): void;
  openFile(): void;
  viewSource(): void;
  devCommand(id: DevCommandId): void;
}

export function buildMenu(actions: MenuActions, shortcuts: ShortcutOverrides): Menu {
  const isMac = process.platform === 'darwin';
  const key = (id: ShortcutId) => shortcutAccelerator(id, shortcuts);
  const settingsItem: MenuItemConstructorOptions = {
    label: t('menu.settings'),
    accelerator: key('settings'),
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
        { label: t('menu.newWindow'), accelerator: key('newWindow'), click: actions.newWindow },
        { label: t('menu.newPrivateWindow'), accelerator: key('newPrivateWindow'), click: actions.newPrivateWindow },
        { label: t('menu.newDeveloperWindow'), click: actions.newDeveloperWindow },
        { type: 'separator' },
        { label: t('menu.closeWindow'), accelerator: key('closeWindow'), click: actions.closeWindow },
        { type: 'separator' },
        { label: t('menu.addressBar'), accelerator: key('addressBar'), click: actions.focusAddress },
        { label: t('menu.openFile'), accelerator: key('openFile'), click: actions.openFile },
        { type: 'separator' },
        { label: t('menu.savePage'), accelerator: key('savePage'), click: actions.savePage },
        { label: t('menu.savePdf'), accelerator: key('savePdf'), click: actions.savePdf },
        { label: t('menu.screenshot'), click: () => actions.devCommand('screenshot') },
        {
          label: t('menu.fullPageScreenshot'),
          accelerator: key('fullPageScreenshot'),
          click: () => actions.devCommand('full-page-screenshot'),
        },
        {
          label: t('menu.captureArea'),
          accelerator: key('captureArea'),
          click: () => actions.devCommand('capture-area'),
        },
        { label: t('menu.print'), accelerator: key('print'), click: actions.print },
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
        {
          label: t('menu.copyAddress'),
          accelerator: key('copyAddress'),
          click: () => actions.devCommand('copy-address'),
        },
        { type: 'separator' },
        { label: t('menu.find'), accelerator: key('find'), click: actions.find },
        { label: t('menu.findNext'), accelerator: key('findNext'), click: () => actions.findNext(true) },
        { label: t('menu.findPrevious'), accelerator: key('findPrevious'), click: () => actions.findNext(false) },
      ],
    },
    {
      label: t('menu.bookmarks'),
      submenu: [
        { label: t('menu.toggleBookmark'), accelerator: key('toggleBookmark'), click: actions.toggleBookmark },
        { label: t('menu.allBookmarks'), accelerator: key('allBookmarks'), click: actions.showBookmarks },
        { type: 'separator' },
        { label: t('readingList.savePage'), accelerator: key('saveReadingPage'), click: actions.saveReadingPage },
        { label: t('readingList.title'), click: actions.showReadingList },
      ],
    },
    {
      label: t('menu.tab'),
      submenu: [
        { label: t('menu.newTab'), accelerator: key('newTab'), click: actions.newTab },
        { label: t('menu.newPrivateTab'), click: actions.newPrivateTab },
        { label: t('menu.closeTab'), accelerator: key('closeTab'), click: actions.closeTab },
        {
          label: t('menu.reopenClosedTab'),
          accelerator: key('reopenClosedTab'),
          click: actions.reopenClosedTab,
        },
        { label: t('archivePage.title'), click: actions.showArchive },
        { label: t('menu.cleanTabs'), accelerator: key('cleanTabs'), click: actions.cleanTabs },
        { type: 'separator' },
        { label: t('menu.nextTab'), accelerator: key('nextTab'), click: actions.selectNextTab },
        { label: t('menu.previousTab'), accelerator: key('previousTab'), click: actions.selectPreviousTab },
        { label: t('menu.moveTabToNewWindow'), click: actions.moveTabToNewWindow },
        { type: 'separator' },
        { label: t('workspaces.title'), click: actions.showWorkspaces },
        { label: t('boosts.title'), click: actions.showBoosts },
        { label: t('boosts.hideElement'), click: actions.hideElement },
        { label: t('easels.title'), click: actions.showEasels },
        { label: t('easels.clip'), click: actions.clipToEasel },
        { label: t('webApps.installPage'), click: actions.installWebApp },
        { label: t('webApps.manage'), click: actions.manageWebApps },
        ...Array.from({ length: 9 }, (_, i): MenuItemConstructorOptions => ({
          label: i === 8 ? t('menu.lastTab') : t('menu.tabNumber', { number: i + 1 }),
          accelerator: `CmdOrCtrl+${i + 1}`,
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => actions.selectTab(i === 8 ? -1 : i),
        })),
        ...Array.from({ length: 9 }, (_, i): MenuItemConstructorOptions => ({
          label: t('menu.spaceNumber', { number: i + 1 }),
          accelerator: `${isMac ? 'Ctrl' : 'Ctrl+Shift'}+${i + 1}`,
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => actions.switchSpace(i),
        })),
      ],
    },
    {
      label: t('menu.view'),
      submenu: [
        { label: t('toolbar.home'), accelerator: key('home'), click: actions.home },
        { label: t('menu.reload'), accelerator: key('reload'), click: actions.reload },
        { label: t('menu.hardReload'), accelerator: key('hardReload'), click: actions.hardReload },
        { label: t('reader.toggle'), accelerator: key('toggleReader'), click: actions.toggleReader },
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
        { label: t('menu.actualSize'), accelerator: key('actualSize'), click: () => actions.zoom(0) },
        { label: t('menu.zoomIn'), accelerator: key('zoomIn'), click: () => actions.zoom(1) },
        {
          label: t('menu.zoomIn'),
          accelerator: 'CmdOrCtrl+=',
          visible: false,
          acceleratorWorksWhenHidden: true,
          click: () => actions.zoom(1),
        },
        { label: t('menu.zoomOut'), accelerator: key('zoomOut'), click: () => actions.zoom(-1) },
        { label: t('menu.cyclePanel'), accelerator: key('cyclePanel'), click: actions.cyclePanel },
        { label: t('menu.toggleToolbar'), accelerator: key('toggleToolbar'), click: actions.toggleToolbar },
        { label: t('agentPanel.toggle'), accelerator: key('toggleAgentPanel'), click: actions.toggleAgentPanel },
        { type: 'separator' },
        { label: t('menu.viewSource'), accelerator: key('viewSource'), click: actions.viewSource },
        { label: t('menu.developerTools'), accelerator: key('developerTools'), click: actions.toggleDevTools },
        { label: t('menu.phoneView'), accelerator: key('phoneView'), click: actions.toggleDeviceView },
        {
          label: t('menu.pickElement'),
          accelerator: key('pickElement'),
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
        { label: t('menu.rotateDevice'), accelerator: key('rotateDevice'), click: actions.rotateDevice },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}
