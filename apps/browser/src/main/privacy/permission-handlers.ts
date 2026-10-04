import {
  dialog,
  shell,
  systemPreferences,
  type BaseWindow,
  type MessageBoxOptions,
  type Session,
  type WebContents,
} from 'electron';
import {
  permissionOrigin,
  permissionQuestion,
  requestedPermissions,
  type PermissionStore,
  type SitePermission,
} from './permissions.js';
import { t } from '../../shared/i18n.js';

const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);

type MediaDevice = 'camera' | 'microphone';

const PRIVACY_PANES: Record<MediaDevice, string> = {
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
};

const mediaDevices = (kinds: readonly SitePermission[]): MediaDevice[] =>
  kinds.filter((kind): kind is MediaDevice => kind === 'camera' || kind === 'microphone');

async function macMediaAccess(device: MediaDevice): Promise<boolean> {
  const status = systemPreferences.getMediaAccessStatus(device);
  if (status === 'granted') return true;
  if (status === 'not-determined') return systemPreferences.askForMediaAccess(device);
  return false;
}

interface PermissionHandlerOptions {
  sessions: readonly (readonly [Session, boolean])[];
  storeFor: (isPrivate: boolean) => PermissionStore;
  parentOf: (contents: WebContents) => BaseWindow | undefined;
}

export function installPermissionHandlers({ sessions, storeFor, parentOf }: PermissionHandlerOptions): void {
  let prompts: Promise<unknown> = Promise.resolve();
  // Prompts are shown one at a time; a queued request is decided again once its turn comes,
  // since an earlier answer may already cover it.
  const ask = (
    contents: WebContents,
    isPrivate: boolean,
    origin: string,
    kinds: SitePermission[],
  ): Promise<boolean> => {
    const answer = prompts.then(async () => {
      const store = storeFor(isPrivate);
      const decided = store.decide(origin, kinds);
      if (decided !== 'ask') return decided === 'allow';
      const parent = parentOf(contents);
      const options: MessageBoxOptions = {
        type: 'question',
        message: permissionQuestion(new URL(origin).host, kinds),
        detail: t('permissionHandlers.detail'),
        buttons: [t('permissionHandlers.allow'), t('permissionHandlers.allowOnce'), t('permissionHandlers.block')],
        defaultId: 2,
        cancelId: 2,
        noLink: true,
      };
      const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      if (response === 0) store.set(origin, kinds, 'allow');
      else if (response === 1) store.allowOnce(origin, kinds);
      else store.set(origin, kinds, 'deny');
      return response !== 2;
    });
    prompts = answer.catch(() => {});
    return answer;
  };

  // A site allowed in Yalqen still gets a silent, empty stream until macOS lets Yalqen itself use the device.
  const systemAccess = async (contents: WebContents, kinds: readonly SitePermission[]): Promise<boolean> => {
    if (process.platform !== 'darwin') return true;
    for (const device of mediaDevices(kinds)) {
      if (await macMediaAccess(device)) continue;
      const parent = parentOf(contents);
      const options: MessageBoxOptions = {
        type: 'warning',
        message: t(
          device === 'camera' ? 'permissionHandlers.systemCameraOff' : 'permissionHandlers.systemMicrophoneOff',
        ),
        detail: t('permissionHandlers.systemDetail'),
        buttons: [t('permissionHandlers.openSystemSettings'), t('permissionHandlers.notNow')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      };
      const { response } = parent ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
      if (response === 0) void shell.openExternal(PRIVACY_PANES[device]);
      return false;
    }
    return true;
  };

  for (const [browsing, isPrivate] of sessions) {
    browsing.setPermissionRequestHandler((contents, permission, callback, details) => {
      if (ALLOWED_PERMISSIONS.has(permission)) {
        callback(true);
        return;
      }
      const kinds = requestedPermissions(permission, 'mediaTypes' in details ? details.mediaTypes : []);
      const origin = permissionOrigin(details.requestingUrl);
      if (!kinds || !origin || origin !== permissionOrigin(contents.getURL())) {
        callback(false);
        return;
      }
      const decided = storeFor(isPrivate).decide(origin, kinds);
      const siteAllowed =
        decided === 'ask' ? ask(contents, isPrivate, origin, kinds) : Promise.resolve(decided === 'allow');
      siteAllowed.then((allowed) => allowed && systemAccess(contents, kinds)).then(callback, () => callback(false));
    });
    browsing.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
      if (ALLOWED_PERMISSIONS.has(permission)) return true;
      const kinds = requestedPermissions(permission, details.mediaType ? [details.mediaType] : []);
      const origin = permissionOrigin(requestingOrigin);
      if (!kinds || !origin) return false;
      if (details.embeddingOrigin && permissionOrigin(details.embeddingOrigin) !== origin) return false;
      return storeFor(isPrivate).decide(origin, kinds) === 'allow';
    });
  }
}
