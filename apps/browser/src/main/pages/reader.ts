import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import { t } from '../../shared/i18n.js';
import { pageScriptPath } from '../app/paths.js';
import type { ReaderLabels } from '../../shared/reader.js';

const WORLD = 1020;
const pending = new WeakSet<WebContents>();
let script: string | undefined;
export async function toggleReader(
  contents: WebContents,
  allowed: () => boolean = () => true,
): Promise<boolean | null> {
  if (pending.has(contents) || !allowed()) return null;
  if (contents.isDestroyed() || !/^https?:/.test(contents.getURL())) return false;
  const url = contents.getURL(),
    frame = contents.mainFrame,
    token = randomUUID();
  let navigated = false;
  const navigation = (event: Electron.Event & { isMainFrame: boolean }) => {
    if (event.isMainFrame) navigated = true;
  };
  contents.on('did-start-navigation', navigation);
  pending.add(contents);
  const current = () =>
    !contents.isDestroyed() && !navigated && contents.mainFrame === frame && contents.getURL() === url && allowed();
  try {
    script ??= fs.readFileSync(pageScriptPath('reader'), 'utf8');
    const ready = await contents.executeJavaScriptInIsolatedWorld(WORLD, [
      {
        code: `(() => {
      if(!globalThis.__yalqenReader){${script}\nglobalThis.__yalqenReader=YalqenReader;}
      return globalThis.__yalqenReader.prepare(${JSON.stringify(token)});
    })()`,
      },
    ]);
    if (!current()) return null;
    if (!ready) return false;
    const labels: ReaderLabels = {
      title: t('reader.title'),
      smaller: t('reader.smaller'),
      larger: t('reader.larger'),
      close: t('reader.close'),
    };
    const applied = !!(await contents.executeJavaScriptInIsolatedWorld(WORLD, [
      { code: `globalThis.__yalqenReader?.apply(${JSON.stringify(token)},${JSON.stringify(labels)}) ?? false` },
    ]));
    return current() ? applied : null;
  } catch {
    return current() ? false : null;
  } finally {
    contents.off('did-start-navigation', navigation);
    pending.delete(contents);
  }
}
