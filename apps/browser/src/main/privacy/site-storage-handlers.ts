import { app, dialog, type BaseWindow, type Session, type WebContents } from 'electron';
import { t } from '../../shared/i18n.js';
import { SiteStorageChannel } from '../../shared/site-storage.js';
import { handleSettingsCall, isSettingsFrame } from '../app/settings-page.js';
import type { SiteStorageManager, StorageOrigins } from './site-storage.js';

export function observeStorageOrigins(
  browsing: Session,
  index: StorageOrigins,
  allowed: (contents: WebContents) => boolean,
): void {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.session !== browsing) return;
    contents.on('did-frame-navigate', (_event, url) => {
      if (allowed(contents)) index.remember(url);
    });
  });
}
interface Host {
  manager: SiteStorageManager;
  parentOf(contents: WebContents): BaseWindow | undefined;
  confirm?(parent: BaseWindow, domain: string | null): Promise<boolean>;
}
export function installSiteStorageHandlers({ manager, parentOf, confirm = confirmClear }: Host): void {
  const clearing = new WeakSet<WebContents>();
  handleSettingsCall(SiteStorageChannel.list, async (event, query, offset) => {
    if (
      typeof query !== 'string' ||
      query.length > 200 ||
      !Number.isInteger(offset) ||
      (offset as number) < 0 ||
      (offset as number) > 20_000
    )
      return null;
    const frame = event.senderFrame;
    const view = await manager.view(event.sender, query.trim(), offset as number);
    return frame === event.sender.mainFrame && isSettingsFrame(event) ? view : null;
  });
  handleSettingsCall(SiteStorageChannel.clear, async (event, domain) => {
    if (domain !== null && (typeof domain !== 'string' || domain.length > 253)) return false;
    const contents = event.sender,
      parent = parentOf(contents),
      frame = event.senderFrame;
    if (!parent || clearing.has(contents)) return false;
    let navigated = false;
    const navigation = (event: Electron.Event & { isMainFrame: boolean }) => {
      if (event.isMainFrame) navigated = true;
    };
    contents.on('did-start-navigation', navigation);
    clearing.add(contents);
    const current = () =>
      !contents.isDestroyed() &&
      !parent.isDestroyed() &&
      !navigated &&
      frame === contents.mainFrame &&
      isSettingsFrame(event);
    try {
      if (domain !== null && !(await manager.groups()).groups.some((group) => group.domain === domain)) return false;
      if (!current() || !(await confirm(parent, domain as string | null)) || !current()) return false;
      return await manager.clear(domain as string | null, current);
    } catch {
      return false;
    } finally {
      contents.off('did-start-navigation', navigation);
      clearing.delete(contents);
    }
  });
}
async function confirmClear(parent: BaseWindow, domain: string | null): Promise<boolean> {
  const { response } = await dialog.showMessageBox(parent, {
    type: 'warning',
    message: domain ? t('siteStorage.clearPrompt', { domain }) : t('siteStorage.clearAllPrompt'),
    detail: t('siteStorage.clearDetail'),
    buttons: [t('siteStorage.cancel'), t('siteStorage.clear')],
    defaultId: 0,
    cancelId: 0,
  });
  return response === 1;
}
