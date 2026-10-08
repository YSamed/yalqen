import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, dialog, type BaseWindow, type WebContents } from 'electron';
import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { t } from '../../shared/i18n.js';
import { pageFileName } from '../devtools/page-export.js';

function relocateResources(html: string, folder: string): string {
  const document = parse(html);
  const visit = (node: DefaultTreeAdapterMap['node']) => {
    if ('attrs' in node) {
      for (const attr of node.attrs) attr.value = attr.value.replaceAll('page_files/', `${folder}/`);
      if (node.tagName === 'style') {
        for (const child of node.childNodes) {
          if ('value' in child) child.value = child.value.replaceAll('page_files/', `${folder}/`);
        }
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child);
    if ('content' in node) visit(node.content);
  };
  visit(document);
  return serialize(document);
}

export async function writeOfflinePage(
  contents: WebContents,
  file: string,
  current: () => boolean = () => !contents.isDestroyed(),
): Promise<void> {
  const temporary = await fs.mkdtemp(path.join(path.dirname(file), '.yalqen-save-'));
  let resourceDirectory: string | null = null;
  let committed = false;
  try {
    const complete = /\.html?$/i.test(file);
    const page = path.join(temporary, complete ? 'page.html' : 'page.mhtml');
    await contents.savePage(page, complete ? 'HTMLComplete' : 'MHTML');
    if (!current()) throw new Error(t('pageFiles.pageChanged'));
    if (complete) {
      const resources = path.join(temporary, 'page_files');
      const info = await fs.stat(resources).catch(() => null);
      if (info?.isDirectory()) {
        const folder = `yalqen-resources-${randomUUID()}`;
        await fs.writeFile(page, relocateResources(await fs.readFile(page, 'utf8'), folder));
        resourceDirectory = path.join(path.dirname(file), folder);
        await fs.rename(resources, resourceDirectory);
      }
    }
    if (!current()) throw new Error(t('pageFiles.pageChanged'));
    await fs.rename(page, file);
    committed = true;
  } finally {
    if (resourceDirectory && !committed) await fs.rm(resourceDirectory, { recursive: true, force: true });
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

export async function saveOfflinePage(
  window: BaseWindow,
  contents: WebContents | null,
  dialogs: Pick<typeof dialog, 'showSaveDialog' | 'showMessageBox'> = dialog,
): Promise<void> {
  if (!contents || contents.isDestroyed()) return;
  let navigated = false;
  const navigation = ({ isMainFrame }: { isMainFrame: boolean }) => {
    if (isMainFrame) navigated = true;
  };
  contents.on('did-start-navigation', navigation);
  const current = () => !navigated && !contents.isDestroyed();
  try {
    const { canceled, filePath } = await dialogs.showSaveDialog(window, {
      title: t('pageFiles.saveTitle'),
      defaultPath: path.join(app.getPath('downloads'), pageFileName(contents.getTitle(), contents.getURL(), 'mhtml')),
      filters: [
        { name: t('pageFiles.archive'), extensions: ['mhtml', 'mht'] },
        { name: t('pageFiles.complete'), extensions: ['html', 'htm'] },
      ],
    });
    if (canceled || !filePath || !current()) return;
    const file = /\.(mhtml|mht|html|htm)$/i.test(filePath) ? filePath : `${filePath}.mhtml`;
    await writeOfflinePage(contents, file, current);
  } catch (error) {
    console.warn('[save-page] could not save:', error);
    if (!window.isDestroyed())
      await dialogs.showMessageBox(window, {
        type: 'error',
        message: t('pageFiles.saveFailed'),
        detail: String(error),
      });
  } finally {
    if (!contents.isDestroyed()) contents.removeListener('did-start-navigation', navigation);
  }
}

export async function openLocalFiles(
  window: BaseWindow,
  open: (url: string) => void,
  dialogs: Pick<typeof dialog, 'showOpenDialog' | 'showMessageBox'> = dialog,
): Promise<void> {
  try {
    const { canceled, filePaths } = await dialogs.showOpenDialog(window, {
      title: t('pageFiles.openTitle'),
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: t('pageFiles.webFiles'),
          extensions: ['html', 'htm', 'mhtml', 'mht', 'pdf', 'txt', 'svg', 'png', 'jpg', 'jpeg', 'webp'],
        },
        { name: t('pageFiles.allFiles'), extensions: ['*'] },
      ],
    });
    if (canceled || window.isDestroyed()) return;
    for (const file of filePaths) open(pathToFileURL(file).href);
  } catch (error) {
    if (!window.isDestroyed())
      await dialogs.showMessageBox(window, {
        type: 'error',
        message: t('pageFiles.openFailed'),
        detail: String(error),
      });
  }
}
