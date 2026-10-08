import { app, dialog, type BaseWindow } from 'electron';
import path from 'node:path';
import { t } from '../../shared/i18n.js';
import type { PasswordTransferResult } from '../../shared/types.js';
import type { PasswordStore } from './passwords.js';
import { readPasswordCsv, writePasswordCsv } from './password-tools.js';

export async function transferPasswords(
  mode: 'import' | 'export',
  store: PasswordStore,
  parent: BaseWindow | undefined,
  allowed: () => boolean,
  authenticate: (reason: string) => Promise<boolean>,
  dialogs: Pick<typeof dialog, 'showOpenDialog' | 'showSaveDialog' | 'showMessageBox'> = dialog,
): Promise<PasswordTransferResult> {
  const cancelled: PasswordTransferResult = { status: 'cancelled', added: 0, skipped: 0 };
  if (!allowed()) return cancelled;
  try {
    if (!(await authenticate(t('passwordTools.ownerReason'))) || !allowed()) return cancelled;
    if (mode === 'import') {
      const options = {
        title: t('passwordTools.importTitle'),
        properties: ['openFile'] as ['openFile'],
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      };
      const choice = parent ? await dialogs.showOpenDialog(parent, options) : await dialogs.showOpenDialog(options);
      if (choice.canceled || !choice.filePaths[0] || !allowed()) return cancelled;
      const { records, skipped } = await readPasswordCsv(choice.filePaths[0]);
      const prompt = {
        type: 'question' as const,
        message: t('passwordTools.importConfirm'),
        detail: t('passwordTools.importDetail', { count: records.length, skipped }),
        buttons: [t('profiles.cancel'), t('passwordTools.import')],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      const { response } = parent ? await dialogs.showMessageBox(parent, prompt) : await dialogs.showMessageBox(prompt);
      if (response !== 1 || !allowed()) return cancelled;
      const result = store.importCredentials(records);
      return { status: 'success', added: result.added, skipped: result.skipped + skipped };
    }
    const prompt = {
      type: 'warning' as const,
      message: t('passwordTools.exportConfirm'),
      detail: t('passwordTools.exportDetail'),
      buttons: [t('profiles.cancel'), t('passwordTools.export')],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    };
    const { response } = parent ? await dialogs.showMessageBox(parent, prompt) : await dialogs.showMessageBox(prompt);
    if (response !== 1 || !allowed()) return cancelled;
    const options = {
      title: t('passwordTools.exportTitle'),
      defaultPath: path.join(app.getPath('downloads'), 'yalqen-passwords.csv'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    };
    const choice = parent ? await dialogs.showSaveDialog(parent, options) : await dialogs.showSaveDialog(options);
    if (choice.canceled || !choice.filePath || !allowed()) return cancelled;
    const records = store.exportCredentials();
    await writePasswordCsv(choice.filePath, records);
    return { status: 'success', added: records.length, skipped: 0 };
  } catch {
    return { status: 'failed', added: 0, skipped: 0 };
  }
}
