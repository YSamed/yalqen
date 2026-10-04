import {
  desktopCapturer,
  Menu,
  webContents,
  type BaseWindow,
  type DesktopCapturerSource,
  type Session,
  type WebContents,
} from 'electron';
import { t } from '../../shared/i18n.js';
import { permissionOrigin } from './permissions.js';

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

// Uses the macOS screen picker where available (macOS 15+); the handler below is the fallback.
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
        desktopCapturer
          .getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
          .then((sources) => pickSource(sources, parentOf(contents)))
          .then(
            (source) => callback(source ? { video: source } : {}),
            () => callback({}),
          );
      },
      { useSystemPicker: true },
    );
  }
}
