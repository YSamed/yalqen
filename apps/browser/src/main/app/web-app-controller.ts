import { Menu, dialog, type BaseWindow, type WebContents, type MenuItemConstructorOptions } from 'electron';
import { t } from '../../shared/i18n.js';
import type { WebAppInfo } from '../../shared/web-apps.js';
import { WebAppStore, parseWebAppManifest, type WebAppManifest } from '../library/web-apps.js';
import { withDebugger } from '../devtools/page-debugger.js';
interface Host {
  store: WebAppStore;
  open(app: WebAppInfo): void;
  confirm?(parent: BaseWindow, app: WebAppManifest, remove: boolean): Promise<boolean>;
}
export class WebAppController {
  private readonly pending = new WeakSet<WebContents>();
  private readonly confirm: NonNullable<Host['confirm']>;
  constructor(private readonly host: Host) {
    this.confirm =
      host.confirm ??
      (async (parent, app, remove) => {
        const result = await dialog.showMessageBox(parent, {
          type: 'question',
          message: t(remove ? 'webApps.removeQuestion' : 'webApps.installQuestion', { name: app.name }),
          detail: remove ? t('webApps.removeDetail') : `${app.startUrl}\n\n${t('webApps.installDetail')}`,
          buttons: [t('internalPages.cancel'), t(remove ? 'webApps.remove' : 'webApps.install')],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        return result.response === 1;
      });
  }
  async install(parent: BaseWindow, contents: WebContents, allowed: () => boolean): Promise<boolean> {
    if (parent.isDestroyed() || contents.isDestroyed() || !allowed() || this.pending.has(contents)) return false;
    const url = contents.getURL(),
      frame = contents.mainFrame;
    let navigated = false;
    const navigation = (event: Electron.Event & { isMainFrame: boolean }) => {
      if (event.isMainFrame) navigated = true;
    };
    const current = () =>
      !parent.isDestroyed() &&
      !contents.isDestroyed() &&
      !navigated &&
      contents.mainFrame === frame &&
      contents.getURL() === url &&
      allowed();
    this.pending.add(contents);
    contents.on('did-start-navigation', navigation);
    try {
      const result = await withDebugger(contents, () => contents.debugger.sendCommand('Page.getAppManifest'));
      if (!current()) return false;
      const manifest = parseWebAppManifest(result, url);
      if (!manifest) {
        await dialog.showMessageBox(parent, { type: 'info', message: t('webApps.unavailable') });
        return false;
      }
      if (!(await this.confirm(parent, manifest, false)) || !current()) return false;
      const saved = this.host.store.install(manifest);
      if (!saved) {
        await dialog.showMessageBox(parent, { type: 'info', message: t('webApps.failed') });
        return false;
      }
      this.host.open(saved);
      return true;
    } catch {
      return false;
    } finally {
      if (!contents.isDestroyed()) contents.off('did-start-navigation', navigation);
      this.pending.delete(contents);
    }
  }
  menu(parent: BaseWindow): MenuItemConstructorOptions[] {
    const apps = this.host.store.list();
    return apps.length
      ? apps.map((app) => ({
          label: app.name,
          submenu: [
            { label: app.startUrl, enabled: false },
            { type: 'separator' },
            {
              label: t('webApps.open'),
              click: () => {
                if (!parent.isDestroyed()) this.host.open(app);
              },
            },
            {
              label: t('webApps.remove'),
              click: () => {
                void this.remove(parent, app);
              },
            },
          ],
        }))
      : [{ label: t('webApps.empty'), enabled: false }];
  }
  show(parent: BaseWindow): void {
    Menu.buildFromTemplate(this.menu(parent)).popup({ window: parent });
  }
  private async remove(parent: BaseWindow, app: WebAppInfo): Promise<void> {
    if (parent.isDestroyed() || !(await this.confirm(parent, app, true)) || parent.isDestroyed()) return;
    if (!this.host.store.remove(app.id))
      await dialog.showMessageBox(parent, { type: 'info', message: t('webApps.failed') });
  }
}
