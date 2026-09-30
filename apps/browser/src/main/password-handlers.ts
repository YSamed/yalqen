import {
  clipboard,
  dialog,
  ipcMain,
  safeStorage,
  systemPreferences,
  type BaseWindow,
  type IpcMainInvokeEvent,
  type MessageBoxOptions,
  type WebContents,
} from 'electron';
import { PageChannel, PasswordsChannel, type SubmittedCredential } from '../shared/types.js';
import { passwordOrigin, sanitizeCredential, type Cipher, type PasswordStore, type SaveOffer } from './passwords.js';

// A login usually navigates once it succeeds; waiting for that keeps most failed attempts from being offered.
const NAVIGATION_WAIT_MS = 3000;

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
  const detail = credential.username ? `Kullanıcı adı: ${credential.username}` : 'Kullanıcı adı yok';
  return offer === 'save'
    ? {
        type: 'question',
        message: `${host} için şifre kaydedilsin mi?`,
        detail,
        buttons: ['Kaydet', 'Bu sitede asla', 'Şimdi değil'],
        defaultId: 0,
        cancelId: 2,
        noLink: true,
      }
    : {
        type: 'question',
        message: `${host} için kayıtlı şifre güncellensin mi?`,
        detail,
        buttons: ['Güncelle', 'Şimdi değil'],
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
  const pending = new WeakMap<WebContents, () => void>();
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

  const waitForNavigation = (contents: WebContents, submission: Submission) => {
    pending.get(contents)?.();
    const done = () => {
      cancel();
      offerToSave(contents, submission);
    };
    const cancel = () => {
      clearTimeout(timer);
      contents.off('did-navigate', done);
      contents.off('did-navigate-in-page', onPageNavigation);
      contents.off('destroyed', cancel);
      pending.delete(contents);
    };
    const onPageNavigation = (_event: unknown, _url: string, isMainFrame: boolean) => {
      if (isMainFrame) done();
    };
    const timer = setTimeout(done, NAVIGATION_WAIT_MS);
    contents.on('did-navigate', done);
    contents.on('did-navigate-in-page', onPageNavigation);
    contents.once('destroyed', cancel);
    pending.set(contents, cancel);
  };

  ipcMain.on(PageChannel.credentialSubmitted, (event, value: unknown) => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame || !savesPasswords(event.sender)) return;
    const origin = passwordOrigin(frame.url);
    const credential = sanitizeCredential(value);
    if (!origin || !credential || !store.offer(origin, credential)) return;
    waitForNavigation(event.sender, { origin, credential });
  });

  ipcMain.handle(PasswordsChannel.list, (event) => (isSettingsFrame(event) ? store.view() : null));
  ipcMain.handle(PasswordsChannel.reveal, async (event, id: unknown) => {
    if (!isSettingsFrame(event) || typeof id !== 'string') return null;
    return (await confirmOwner('kayıtlı şifreyi göstermek')) ? store.reveal(id) : null;
  });
  ipcMain.handle(PasswordsChannel.copy, async (event, id: unknown) => {
    if (!isSettingsFrame(event) || typeof id !== 'string') return false;
    if (!(await confirmOwner('kayıtlı şifreyi kopyalamak'))) return false;
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
