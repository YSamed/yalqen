import { app, dialog, type BaseWindow } from 'electron';
import path from 'node:path';
import { t } from '../../shared/i18n.js';
import { importErrorMessage, type BookmarkImportResult, type HistoryImportResult } from '../library/browser-import.js';
import { writeBookmarkHtml } from '../library/bookmark-html.js';
import type { BookmarkStore } from '../library/bookmarks.js';

async function chooseFile(window: BaseWindow, title: string): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title,
    buttonLabel: t('window.import'),
    defaultPath: app.getPath('appData'),
    properties: ['openFile'],
  });
  return canceled ? null : (filePaths[0] ?? null);
}

export async function importBookmarksWithDialog(
  window: BaseWindow,
  importBookmarks: (file: string) => Promise<BookmarkImportResult>,
  file?: string,
): Promise<void> {
  const source = file ?? (await chooseFile(window, t('window.chooseBookmarksFile')));
  if (!source) return;
  try {
    const { bookmarks, folders, skipped } = await importBookmarks(source);
    const details = [
      folders > 0 ? t('window.foldersCreated', { count: folders }) : '',
      skipped > 0 ? t('window.bookmarksSkipped', { count: skipped }) : '',
    ];
    void dialog.showMessageBox(window, {
      type: 'info',
      message: bookmarks > 0 ? t('window.bookmarksImported', { count: bookmarks }) : t('window.noNewBookmarks'),
      detail: details.filter(Boolean).join(' '),
    });
  } catch (error) {
    console.warn('[bookmarks] could not import:', error);
    void dialog.showMessageBox(window, {
      type: 'error',
      message: t('window.bookmarksImportFailed'),
      detail: importErrorMessage(error),
    });
  }
}

export async function importHistoryWithDialog(
  window: BaseWindow,
  importHistory: (file: string) => Promise<HistoryImportResult>,
  file?: string,
): Promise<void> {
  const source = file ?? (await chooseFile(window, t('window.chooseHistoryFile')));
  if (!source) return;
  try {
    const { visits, skipped } = await importHistory(source);
    void dialog.showMessageBox(window, {
      type: 'info',
      message: visits > 0 ? t('window.visitsImported', { count: visits }) : t('window.noNewVisits'),
      detail: skipped > 0 ? t('window.visitsSkipped', { count: skipped }) : '',
    });
  } catch (error) {
    console.warn('[history] could not import:', error);
    void dialog.showMessageBox(window, {
      type: 'error',
      message: t('window.historyImportFailed'),
      detail: importErrorMessage(error, 'history'),
    });
  }
}

export async function exportBookmarksWithDialog(window: BaseWindow, store: BookmarkStore): Promise<void> {
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: t('bookmarks.menuExport'),
      defaultPath: path.join(app.getPath('documents'), 'bookmarks.html'),
      filters: [{ name: 'HTML', extensions: ['html'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (canceled || !filePath || window.isDestroyed()) return;
    await writeBookmarkHtml(filePath, store.folders(), store.bookmarks());
  } catch (error) {
    console.warn('[bookmarks] could not export:', error);
    if (!window.isDestroyed())
      void dialog.showMessageBox(window, {
        type: 'error',
        message: t('window.bookmarksExportFailed'),
        detail: error instanceof Error ? error.message : String(error),
      });
  }
}
