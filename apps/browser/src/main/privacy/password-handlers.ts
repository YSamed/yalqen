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
import { PageChannel, PasswordsChannel, type SubmittedCredential, type SavedLoginChoice } from '../../shared/types.js';
import { generatePassword } from './password-tools.js';
import { transferPasswords } from './password-transfer.js';
import { chooseLogin } from './login-menu.js';
import { passwordOrigin, sanitizeCredential, type Cipher, type PasswordStore, type SaveOffer } from './passwords.js';

// A login that succeeds navigates or removes its form; one that does neither in time most likely failed.
const SUBMISSION_WAIT_MS = 10_000;

export const safeStorageCipher: Cipher = {
  available: () => safeStorage.isEncryptionAvailable(),
  encrypt: (text) => safeStorage.encryptString(text).toString('base64'),
  decrypt: (secret) => safeStorage.decryptString(Buffer.from(secret, 'base64')),
};

interface PasswordHandlerOptions {
  store: PasswordStore;
  savesPasswords: (contents: WebContents) => boolean;
  parentOf: (contents: WebContents) => BaseWindow | undefined;
  isSettingsFrame: (event: IpcMainInvokeEvent) => boolean;
  onChange: () => void;
  authenticate?: (reason: string) => Promise<boolean>;
  transferDialogs?: Pick<typeof dialog, 'showOpenDialog' | 'showSaveDialog' | 'showMessageBox'>;
  chooseAccount?: (parent: BaseWindow, choices: readonly SavedLoginChoice[]) => Promise<string | null>;
}

interface Submission {
  origin: string;
  credential: SubmittedCredential;
}

export async function confirmOwner(reason: string): Promise<boolean> {
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
  chooseAccount = chooseLogin,
  authenticate = confirmOwner,
  transferDialogs = dialog,
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
  ipcMain.handle(PageChannel.generatePassword, (event, length: unknown) =>
    mainFrameOrigin(event) ? generatePassword(length) : null,
  );
  ipcMain.handle(PageChannel.savedLogins, (event) => {
    const origin = mainFrameOrigin(event);
    return {
      choices: origin ? store.choices(origin) : [],
      chooseLabel: t('passwordHandlers.chooseAccount'),
      generateLabel: origin ? t('passwordTools.generate') : null,
    };
  });
  ipcMain.handle(PageChannel.fillSavedLogin, (event, id: unknown) => {
    const origin = mainFrameOrigin(event);
    return origin && typeof id === 'string' ? store.login(origin, id) : null;
  });
  const choosing = new WeakSet<WebContents>();
  ipcMain.handle(PageChannel.chooseSavedLogin, async (event) => {
    const origin = mainFrameOrigin(event);
    const frame = event.senderFrame;
    const contents = event.sender;
    const parent = parentOf(contents);
    if (!origin || !parent || choosing.has(contents)) return null;
    const choices = store.choices(origin);
    if (choices.length === 0) return null;
    choosing.add(contents);
    try {
      const id = await chooseAccount(parent, choices);
      if (
        !id ||
        contents.isDestroyed() ||
        frame !== contents.mainFrame ||
        !savesPasswords(contents) ||
        passwordOrigin(contents.mainFrame.url) !== origin
      )
        return null;
      return store.login(origin, id);
    } finally {
      choosing.delete(contents);
    }
  });

  ipcMain.handle(PasswordsChannel.generate, (event) => (isSettingsFrame(event) ? generatePassword() : null));
  ipcMain.handle(PasswordsChannel.save, async (event, value: unknown) => {
    if (!isSettingsFrame(event) || !(await authenticate(t('passwordTools.ownerReason'))) || !isSettingsFrame(event))
      return false;
    try {
      const saved = store.saveManual(value);
      if (saved) onChange();
      return saved;
    } catch {
      return false;
    }
  });
  ipcMain.handle(PasswordsChannel.transfer, async (event, mode: unknown) => {
    if (!isSettingsFrame(event) || (mode !== 'import' && mode !== 'export'))
      return { status: 'cancelled', added: 0, skipped: 0 };
    const result = await transferPasswords(
      mode,
      store,
      parentOf(event.sender),
      () => isSettingsFrame(event),
      authenticate,
      transferDialogs,
    );
    if (mode === 'import' && result.status === 'success') onChange();
    return result;
  });
  ipcMain.handle(PasswordsChannel.list, (event) => (isSettingsFrame(event) ? store.view() : null));
  ipcMain.handle(PasswordsChannel.reveal, async (event, id: unknown) => {
    if (!isSettingsFrame(event) || typeof id !== 'string') return null;
    return (await authenticate(t('passwordHandlers.revealReason'))) && isSettingsFrame(event) ? store.reveal(id) : null;
  });
  ipcMain.handle(PasswordsChannel.copy, async (event, id: unknown) => {
    if (!isSettingsFrame(event) || typeof id !== 'string') return false;
    if (!(await authenticate(t('passwordHandlers.copyReason'))) || !isSettingsFrame(event)) return false;
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
