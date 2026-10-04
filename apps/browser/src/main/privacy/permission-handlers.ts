import { dialog, type BaseWindow, type MessageBoxOptions, type Session, type WebContents } from 'electron';
import {
  permissionOrigin,
  permissionQuestion,
  requestedPermissions,
  type PermissionStore,
  type SitePermission,
} from './permissions.js';
import { t } from '../../shared/i18n.js';

const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'clipboard-sanitized-write']);

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
      if (decided !== 'ask') {
        callback(decided === 'allow');
        return;
      }
      ask(contents, isPrivate, origin, kinds).then(callback, () => callback(false));
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
