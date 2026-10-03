import {
  clipboard,
  dialog,
  ipcMain,
  safeStorage,
  systemPreferences,
  type BaseWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MessageBoxOptions,
  type WebContents,
} from 'electron';
import { t } from '../../shared/i18n.js';
import { PageChannel, PasswordsChannel, type SubmittedCredential } from '../../shared/types.js';
import { passwordOrigin, sanitizeCredential, type Cipher, type PasswordStore, type SaveOffer } from './passwords.js';

// A login that succeeds navigates or removes its form; one that does neither in time most likely failed.
const SUBMISSION_WAIT_MS = 10_000;

export const safeStorageCipher: Cipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
  decrypt: (secret) => safeStorage.decryptString(Buffer.from(secret, 'base64')),
};

export interface PasswordHandlerOptions {
  store: PasswordStore;
  savesPasswords: (contents: WebContents) => boolean;
  parentOf: (contents: WebContents) => BaseWindow | undefined;
  isSettingsFrame: (event: IpcMainInvokeEvent) => boolean;
  onChange: () => void;
}

interface Submission {
  origin: string;
  credential: SubmittedCredential;
}

async function confirmOwner(reason: string): Promise<boolean> {
  if (!systemPreferences.canPromptTouchID()) return true;
  try {
    await systemPreferences.promptTouchID(reason);
    return true;
  } catch {
    return false;
  }
}

function promptOptions(offer: SaveOffer, { origin, credential }: Submission): MessageBoxOptions {
  const host = new URL(origin).host;
  const detail = credential.username
    ? t('passwordHandlers.username', { username: credential.username })
    : t('passwordHandlers.noUsername');
  return offer === 'save'
    ? {
        type: 'question',
        message: t('passwordHandlers.savePrompt', { host }),
        detail,
        buttons: [t('passwordHandlers.save'), t('passwordHandlers.never'), t('passwordHandlers.notNow')],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      }
    : {
        type: 'question',
        message: t('passwordHandlers.updatePrompt', { host }),
        detail,
        buttons: [t('passwordHandlers.update'), t('passwordHandlers.notNow')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      };
}

export function installPasswordHandlers({
  store,
  savesPasswords,
  parentOf,
  isSettingsFrame,
  onChange,
}: PasswordHandlerOptions): void {
  const pending = new WeakMap<WebContents, { accept: () => void; cancel: () => void }>();
  let prompts: Promise<unknown> = Promise.resolve();

  const offerToSave = (contents: WebContents, submission: Submission) => {
    prompts = prompts
      .then(async () => {
        const offer = store.offer(submission.origin, submission.credential);
        if (!offer || contents.isDestroyed()) return;
        const parent = parentOf(contents);
        const options = promptOptions(offer, submission);
        const { response } = parent
          ? await dialog.showMessageBox(parent, options)
          : await dialog.showMessageBox(options);
        if (response === 0) store.save(submission.origin, submission.credential);
        else if (offer === 'save' && response === 1) store.neverSave(submission.origin);
        else return;
        onChange();
      })
      .catch((error: unknown) => console.warn('[passwords] could not offer to save:', error));
  };

  const waitForSuccess = (contents: WebContents, submission: Submission) => {
    pending.get(contents)?.cancel();
    const accept = () => {
      cancel();
      offerToSave(contents, submission);
    };
    const cancel = () => {
      clearTimeout(timer);
      contents.off('did-navigate', accept);
      contents.off('did-navigate-in-page', onPageNavigation);
      contents.off('destroyed', cancel);
      pending.delete(contents);
    };
    const onPageNavigation = (_event: unknown, _url: string, isMainFrame: boolean) => {
      if (isMainFrame) accept();
    };
    const timer = setTimeout(cancel, SUBMISSION_WAIT_MS);
    contents.on('did-navigate', accept);
    contents.on('did-navigate-in-page', onPageNavigation);
    contents.once('destroyed', cancel);
    pending.set(contents, { accept, cancel });
  };

  const mainFrameOrigin = (event: IpcMainEvent | IpcMainInvokeEvent) => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame || !savesPasswords(event.sender)) return null;
    return passwordOrigin(frame.url);
  };

  ipcMain.on(PageChannel.credentialSubmitted, (event, value: unknown) => {
    const origin = mainFrameOrigin(event);
    const credential = sanitizeCredential(value);
    if (!origin || !credential || !store.offer(origin, credential)) return;
    waitForSuccess(event.sender, { origin, credential });
  });
  ipcMain.on(PageChannel.credentialAccepted, (event) => {
    if (mainFrameOrigin(event)) pending.get(event.sender)?.accept();
  });
  ipcMain.handle(PageChannel.savedLogins, (event) => {
    const origin = mainFrameOrigin(event);
    return origin ? store.logins(origin) : [];
  });

  ipcMain.handle(PasswordsChannel.list, (event) => (isSettingsFrame(event) ? store.view() : null));
  ipcMain.handle(PasswordsChannel.reveal, async (event, id: unknown) => {
    if (!isSettingsFrame(event) || typeof id !== 'string') return null;
    return (await confirmOwner(t('passwordHandlers.revealReason'))) ? store.reveal(id) : null;
  });
  ipcMain.handle(PasswordsChannel.copy, async (event, id: unknown) => {
    if (!isSettingsFrame(event) || typeof id !== 'string') return false;
    if (!(await confirmOwner(t('passwordHandlers.copyReason')))) return false;
    const password = store.reveal(id);
    if (password === null) return false;
    clipboard.writeText(password);
    return true;
  });
  ipcMain.handle(PasswordsChannel.remove, (event, id: unknown) => {
    if (!isSettingsFrame(event) || typeof id !== 'string') return;
    store.remove(id);
    onChange();
  });
  ipcMain.handle(PasswordsChannel.allowSaving, (event, origin: unknown) => {
    if (!isSettingsFrame(event) || typeof origin !== 'string') return;
    store.allowSaving(origin);
    onChange();
  });
}
