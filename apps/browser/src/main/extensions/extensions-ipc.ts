import { dialog, type BaseWindow, type OpenDialogOptions, type WebContents } from 'electron';
import { t } from '../../shared/i18n.js';
import { ExtensionsChannel } from '../../shared/types.js';
import { handleSettingsCall } from '../app/settings-page.js';
import { STORE_HOME } from './chrome-web-store.js';
import type { ExtensionManager } from './extensions.js';

export interface ExtensionsIpcHost {
  extensions: ExtensionManager;
  parentWindow(contents: WebContents): BaseWindow | undefined;
  openTab(contents: WebContents, url: string): void;
}

export function registerExtensionsIpc({ extensions, parentWindow, openTab }: ExtensionsIpcHost): void {
  handleSettingsCall(ExtensionsChannel.list, () => extensions.list());
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
