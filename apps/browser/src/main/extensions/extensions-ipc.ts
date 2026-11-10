import { dialog, type BaseWindow, type OpenDialogOptions, type WebContents } from 'electron';
import { t } from '../../shared/i18n.js';
import { ExtensionsChannel, type ConfirmRequest } from '../../shared/types.js';
import { permissionLines } from './permission-text.js';
import { handleSettingsCall, isSettingsFrame } from '../app/settings-page.js';
import type { ExtensionAccessController } from './extension-access-controller.js';
import { STORE_HOME } from './chrome-web-store.js';
import type { ExtensionManager } from './extensions.js';

interface ExtensionsIpcHost {
  extensions: ExtensionManager;
  access: ExtensionAccessController;
  parentWindow(contents: WebContents): BaseWindow | undefined;
  confirm(window: BaseWindow | undefined, request: ConfirmRequest, returnFocus: WebContents): Promise<boolean>;
  openTab(contents: WebContents, url: string): void;
}

export function registerExtensionsIpc({ extensions, access, parentWindow, confirm, openTab }: ExtensionsIpcHost): void {
  handleSettingsCall(ExtensionsChannel.list, () => extensions.list());
  handleSettingsCall(ExtensionsChannel.setAccess, (event, directory, value) =>
    typeof directory === 'string'
      ? access.setAccess(
          directory,
          value,
          parentWindow(event.sender),
          () => !event.sender.isDestroyed() && isSettingsFrame(event),
        )
      : t('extensions.accessInvalid'),
  );
  handleSettingsCall(ExtensionsChannel.checkUpdates, (event) =>
    extensions.checkForUpdates((name, permissions) => {
      const lines = permissionLines(permissions);
      const request: ConfirmRequest = {
        icon: 'extensions',
        title: t('extensions.updatePermissionsPrompt', { name }),
        message: t('extensions.updateNewPermissions'),
        items: lines.length > 0 ? lines : permissions,
        confirmLabel: t('extensions.updateAllow'),
        cancelLabel: t('webStoreApi.cancel'),
      };
      return confirm(parentWindow(event.sender), request, event.sender);
    }),
  );
  handleSettingsCall(ExtensionsChannel.install, async (event) => {
    const parent = parentWindow(event.sender);
    const options: OpenDialogOptions = {
      title: t('main.chooseExtensionFolder'),
      buttonLabel: t('main.installExtension'),
      properties: ['openDirectory'],
    };
    const { canceled, filePaths } = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    return canceled || !filePaths[0] ? null : extensions.install(filePaths[0]);
  });
  handleSettingsCall(ExtensionsChannel.installFromStore, (_event, input) =>
    typeof input === 'string' ? extensions.installFromStore(input) : null,
  );
  handleSettingsCall(ExtensionsChannel.openStore, (event) => openTab(event.sender, STORE_HOME));
  handleSettingsCall(ExtensionsChannel.remove, (_event, directory) => {
    if (typeof directory === 'string') extensions.remove(directory);
  });
  handleSettingsCall(ExtensionsChannel.setEnabled, async (_event, directory, enabled) => {
    if (typeof directory === 'string' && typeof enabled === 'boolean') await extensions.setEnabled(directory, enabled);
  });
  handleSettingsCall(ExtensionsChannel.openOptions, (event, directory) => {
    const url = typeof directory === 'string' ? extensions.optionsUrl(directory) : null;
    if (url) openTab(event.sender, url);
  });
}
