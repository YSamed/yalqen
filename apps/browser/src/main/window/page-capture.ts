import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, type BaseWindow, type WebContents } from 'electron';
import { t } from '../../shared/i18n.js';
import { pageFileName } from '../devtools/page-export.js';
import type { TabManager } from '../tabs/tabs.js';

export function printPage(contents: WebContents | null): void {
  contents?.print({}, (success, reason) => {
    if (!success && reason !== 'Print job canceled' && reason !== 'cancelled') {
      console.warn(`[print] could not print: ${reason}`);
    }
  });
}

function showSaveFailure(window: BaseWindow, message: string, error: unknown): void {
  void dialog.showMessageBox(window, { type: 'error', message, detail: String(error) });
}

export async function savePdfFile(window: BaseWindow, contents: WebContents | null): Promise<void> {
  if (!contents) return;
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: t('window.savePdfTitle'),
    defaultPath: path.join(app.getPath('downloads'), pageFileName(contents.getTitle(), contents.getURL(), 'pdf')),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath || contents.isDestroyed()) return;
  try {
    await fs.promises.writeFile(filePath, await contents.printToPDF({ printBackground: true }));
  } catch (error) {
    console.warn('[print] could not save the page as PDF:', error);
    showSaveFailure(window, t('window.savePdfFailed'), error);
  }
}

export async function saveScreenshotFile(window: BaseWindow, tabs: TabManager, fullPage: boolean): Promise<void> {
  try {
    const capture = await tabs.captureActive(fullPage);
    if (!capture) return;
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: fullPage ? t('window.saveFullPageScreenshotTitle') : t('window.saveScreenshotTitle'),
      defaultPath: path.join(app.getPath('downloads'), pageFileName(capture.title, capture.url, 'png')),
      filters: [{ name: 'PNG', extensions: ['png'] }],
    });
    if (canceled || !filePath) return;
    await fs.promises.writeFile(filePath, capture.png);
  } catch (error) {
    console.warn('[screenshot] could not save the screenshot:', error);
    showSaveFailure(window, t('window.saveScreenshotFailed'), error);
  }
}
