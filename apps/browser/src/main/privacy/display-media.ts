import {
  desktopCapturer,
  dialog,
  Menu,
  webContents,
  type BaseWindow,
  type MessageBoxOptions,
  type DesktopCapturerSource,
  type Session,
  type WebContents,
} from 'electron';
import { t } from '../../shared/i18n.js';
import { permissionOrigin } from './permissions.js';
import { openSystemSettings, screenAccessGranted } from './system-access.js';

interface DisplayMediaOptions {
  sessions: readonly Session[];
  parentOf: (contents: WebContents) => BaseWindow | undefined;
}

function pickSource(
  sources: DesktopCapturerSource[],
  parent: BaseWindow | undefined,
): Promise<DesktopCapturerSource | null> {
  return new Promise((resolve) => {
    let picked: DesktopCapturerSource | null = null;
    const item = (source: DesktopCapturerSource) => ({ label: source.name, click: () => (picked = source) });
    const screens = sources.filter((source) => source.id.startsWith('screen:'));
    const windows = sources.filter((source) => source.id.startsWith('window:') && source.name);
    const menu = Menu.buildFromTemplate([
      { label: t('displayMedia.pick'), enabled: false },
      ...screens.map(item),
      ...(windows.length > 0 ? [{ type: 'separator' as const }, ...windows.map(item)] : []),
    ]);
    // On macOS the click handler runs after the menu reports it closed.
    menu.popup({ window: parent, callback: () => setTimeout(() => resolve(picked)) });
  });
}

// The macOS system picker needs no Screen Recording permission, so Yalqen would never be listed under
// Privacy & Security. Capturing through desktopCapturer makes macOS ask and list it.
async function explainScreenAccess(parent: BaseWindow | undefined): Promise<void> {
  const options: MessageBoxOptions = {
    type: 'warning',
    message: t('displayMedia.systemOff'),
    detail: t('displayMedia.systemDetail'),
    buttons: [t('permissionHandlers.openSystemSettings'), t('permissionHandlers.notNow')],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
  const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  if (response === 0) openSystemSettings('screen');
}

export function installDisplayMediaHandler({ sessions, parentOf }: DisplayMediaOptions): void {
  for (const browsing of sessions) {
    browsing.setDisplayMediaRequestHandler(
      (request, callback) => {
        const frame = request.frame;
        const contents = frame ? webContents.fromFrame(frame) : undefined;
        if (!frame || !contents || !request.videoRequested || !permissionOrigin(request.securityOrigin)) {
          callback({});
          return;
        }
        const parent = parentOf(contents);
        desktopCapturer
          .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
          .then(async (sources) => {
            if (screenAccessGranted()) return pickSource(sources, parent);
            await explainScreenAccess(parent);
            return null;
          })
          .then(
            (source) => callback(source ? { video: source } : {}),
            () => callback({}),
          );
      },
      { useSystemPicker: false },
    );
  }
}
