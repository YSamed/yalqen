import { dialog, type BaseWindow, type WebContents } from 'electron';
import { t } from '../../shared/i18n.js';
import { extensionSite, parseExtensionAccess } from '../../shared/extension-sites.js';
import type { ExtensionManager } from './extensions.js';

export interface ApprovedExtensionReload {
  current(): boolean;
  reload(): Promise<boolean>;
}
interface AccessHost {
  extensions: ExtensionManager;
  pages(): WebContents[];
  approveReload(contents: WebContents): Promise<ApprovedExtensionReload | null>;
  dialogs?: Pick<typeof dialog, 'showMessageBox'>;
}
export class ExtensionAccessController {
  private busy = false;
  constructor(private readonly host: AccessHost) {}
  async setAccess(
    directory: string,
    value: unknown,
    parent: BaseWindow | undefined,
    current: () => boolean,
  ): Promise<string | null> {
    const access = parseExtensionAccess(value);
    if (!access || !this.host.extensions.hasEntry(directory)) return t('extensions.accessInvalid');
    if (!this.host.extensions.accessWillChange(directory, access)) return null;
    return this.apply(directory, parent, current, () => this.host.extensions.setAccess(directory, access));
  }
  async requestSite(
    directory: string,
    url: string,
    parent: BaseWindow,
    current: () => boolean,
  ): Promise<string | null> {
    const site = extensionSite(url);
    if (!site || this.host.extensions.accessFor(directory).mode !== 'click') return t('extensions.accessInvalid');
    const entry = this.host.extensions.list().find((item) => item.path === directory);
    if (!entry?.enabled) return t('extensions.accessInvalid');
    if (entry.sessionSites.includes(site)) return null;
    return this.apply(directory, parent, current, () => this.host.extensions.grantSite(directory, site), site);
  }
  private async apply(
    directory: string,
    parent: BaseWindow | undefined,
    current: () => boolean,
    operation: () => Promise<string | null>,
    site?: string,
  ): Promise<string | null> {
    if (this.busy) return t('extensions.accessBusy');
    if (!current() || parent?.isDestroyed()) return t('extensions.accessCancelled');
    this.busy = true;
    let applied = false;
    try {
      const entry = this.host.extensions.list().find((item) => item.path === directory);
      if (!entry) return t('extensions.accessInvalid');
      const options: Electron.MessageBoxOptions = {
        type: 'question',
        message: t(site ? 'extensions.accessGrantPrompt' : 'extensions.accessPrompt', {
          name: entry.name,
          site: site ?? '',
        }),
        detail: t(site ? 'extensions.accessGrantDetail' : 'extensions.accessReloadDetail'),
        buttons: [t('extensions.accessApply'), t('webStoreApi.cancel')],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      };
      const dialogs = this.host.dialogs ?? dialog;
      const result = parent ? await dialogs.showMessageBox(parent, options) : await dialogs.showMessageBox(options);
      if (result.response !== 0 || !current()) return t('extensions.accessCancelled');
      const pages = this.host.pages();
      const approved: ApprovedExtensionReload[] = [];
      for (const page of pages) {
        const approval = await this.host.approveReload(page);
        if (!approval || !current()) return t('extensions.accessCancelled');
        approved.push(approval);
      }
      const latest = this.host.pages();
      if (
        pages.length !== latest.length ||
        pages.some((page) => !latest.includes(page)) ||
        approved.some((item) => !item.current()) ||
        !current()
      )
        return t('extensions.accessCancelled');
      const error = await operation();
      applied = true;
      const now = this.host.extensions.list().find((item) => item.path === directory);
      if (error && now?.enabled) return error;
      const after = this.host.pages();
      if (
        !current() ||
        approved.some((item) => !item.current()) ||
        pages.length !== after.length ||
        pages.some((page) => !after.includes(page))
      ) {
        await this.host.extensions.setEnabled(directory, false);
        return t('extensions.accessReloadFailed');
      }
      const reloaded = await Promise.all(approved.map((item) => item.reload()));
      if (reloaded.some((success) => !success)) {
        await this.host.extensions.setEnabled(directory, false);
        return t('extensions.accessReloadFailed');
      }
      return error;
    } catch {
      if (applied) {
        await this.host.extensions.setEnabled(directory, false);
        return t('extensions.accessReloadFailed');
      }
      return t('extensions.accessCancelled');
    } finally {
      this.busy = false;
    }
  }
}
