import { app, dialog, type IpcMainInvokeEvent, type OpenDialogOptions, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { t } from '../../shared/i18n.js';
import {
  RequestRulesChannel,
  SettingsChannel,
  SitePermissionsChannel,
  type ClearDataRequest,
  type SettingsSaveResult,
  type SettingsTransferResult,
  type SettingsValues,
  type SettingsView,
  type SitePermissionsView,
} from '../../shared/types.js';
import type { RequestRuleStore } from '../devtools/request-rules.js';
import { isSitePermission, permissionOrigin, type PermissionStore } from '../privacy/permissions.js';
import { isSystemDevice, openSystemSettings, systemAccessStatus } from '../privacy/system-access.js';
import { sanitizeClearRequest } from '../library/clear-data.js';
import { sanitizeIconDomains } from '../library/site-icons.js';
import { makeDefaultBrowser, refreshDefaultBrowser } from './default-browser.js';
import { processUsage } from './process-metrics.js';
import { handleSettingsCall } from './settings-page.js';
import { parseSettingsFile, settingsFileText } from './settings.js';
import type { Updater } from './updater.js';

export interface SettingsIpcHost {
  view(): SettingsView;
  update(patch: unknown): SettingsValues | null;
  clearData(request: ClearDataRequest): Promise<void>;
  showImportMenu(kind: 'bookmarks' | 'history', contents: WebContents): void;
  updater: Updater;
  relaunch(): void;
  requestRules: RequestRuleStore;
  permissionsFor(contents: WebContents): PermissionStore | null;
  onRequestRulesSaved(): void;
  updateThreatLists(): Promise<void>;
  profiles: import('./profile-controller.js').ProfileController;
  siteIcons?(domains: string[]): Record<string, string>;
  setSpaceTheme(id: string, theme: unknown): void;
  spaceAction(action: unknown, id: unknown, value: unknown): Promise<string | null>;
}

const SETTINGS_FILTERS = [{ name: 'Yalqen Settings', extensions: ['json'] }];
const MAX_SETTINGS_FILE_BYTES = 1024 * 1024;

async function transferSettings(host: SettingsIpcHost, mode: 'import' | 'export'): Promise<SettingsTransferResult> {
  try {
    if (mode === 'export') {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: t('settings.exportSettings'),
        defaultPath: path.join(app.getPath('documents'), 'Yalqen Settings.json'),
        filters: SETTINGS_FILTERS,
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (canceled || !filePath) return 'cancelled';
      await fs.promises.writeFile(filePath, settingsFileText(host.view().values), { mode: 0o600 });
      return 'done';
    }
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: t('settings.importSettings'),
      buttonLabel: t('window.import'),
      filters: SETTINGS_FILTERS,
      properties: ['openFile'],
    });
    const file = canceled ? undefined : filePaths[0];
    if (!file) return 'cancelled';
    if ((await fs.promises.stat(file)).size > MAX_SETTINGS_FILE_BYTES) return 'failed';
    const patch = parseSettingsFile(await fs.promises.readFile(file, 'utf8'));
    return patch && host.update(patch) ? 'done' : 'failed';
  } catch (error) {
    console.warn(`[settings] could not ${mode}:`, error);
    return 'failed';
  }
}

function sitePermissionsView(store: PermissionStore | null): SitePermissionsView {
  return {
    sites: store?.origins().map((origin) => ({ origin, permissions: store.list(origin) })) ?? [],
    system: systemAccessStatus(),
  };
}

export function registerSettingsIpc(host: SettingsIpcHost): void {
  const save = (patch: unknown): SettingsSaveResult => {
    const saved = host.update(patch) !== null;
    return { view: host.view(), saved };
  };
  handleSettingsCall(SettingsChannel.profiles, () => host.profiles.view());
  handleSettingsCall(SettingsChannel.profileAction, (_event, action, id, name) => host.profiles.run(action, id, name));
  handleSettingsCall(SettingsChannel.get, async () => {
    await refreshDefaultBrowser();
    return host.view();
  });
  handleSettingsCall(SettingsChannel.update, (_event, patch) => save(patch));
  handleSettingsCall(SettingsChannel.clearData, async (_event, value) => {
    const request = sanitizeClearRequest(value);
    if (request) await host.clearData(request);
  });
  handleSettingsCall(SettingsChannel.showImportMenu, (event, kind) => {
    if (kind === 'bookmarks' || kind === 'history') host.showImportMenu(kind, event.sender);
  });
  handleSettingsCall(SettingsChannel.transfer, (_event, mode) =>
    mode === 'import' || mode === 'export' ? transferSettings(host, mode) : 'failed',
  );
  handleSettingsCall(SettingsChannel.makeDefault, async () => {
    await makeDefaultBrowser();
    await refreshDefaultBrowser();
    return host.view();
  });
  handleSettingsCall(SettingsChannel.relaunch, () => host.relaunch());
  handleSettingsCall(SettingsChannel.processUsage, () => processUsage());
  handleSettingsCall(SettingsChannel.checkForUpdates, () => host.updater.check());
  handleSettingsCall(SettingsChannel.installUpdate, () => host.updater.install());
  handleSettingsCall(SettingsChannel.updateThreatLists, async () => {
    await host.updateThreatLists();
    return host.view();
  });
  handleSettingsCall(SettingsChannel.chooseDownloadDirectory, async () => {
    const options: OpenDialogOptions = {
      title: t('settings.chooseDownloadDirectory'),
      defaultPath: host.view().downloadDirectory,
      properties: ['openDirectory', 'createDirectory'],
    };
    const { canceled, filePaths } = await dialog.showOpenDialog(options);
    return !canceled && filePaths[0] ? save({ downloadDirectory: filePaths[0] }) : null;
  });
  handleSettingsCall(SettingsChannel.setSpaceTheme, (_event, id, theme) => {
    if (typeof id === 'string') host.setSpaceTheme(id, theme);
    return host.view();
  });
  handleSettingsCall(SettingsChannel.spaceAction, (_event, action, id, value) => host.spaceAction(action, id, value));
  handleSettingsCall(
    SettingsChannel.siteIcons,
    (_event, domains) => host.siteIcons?.(sanitizeIconDomains(domains)) ?? {},
  );
  const scoped = (event: IpcMainInvokeEvent) => host.permissionsFor(event.sender);
  handleSettingsCall(SitePermissionsChannel.list, (event) => sitePermissionsView(scoped(event)));
  handleSettingsCall(SitePermissionsChannel.set, (event, origin, kind, decision) => {
    const store = scoped(event);
    if (
      store &&
      typeof origin === 'string' &&
      permissionOrigin(origin) === origin &&
      isSitePermission(kind) &&
      (decision === 'allow' || decision === 'deny' || decision === null)
    ) {
      store.set(origin, [kind], decision);
    }
    return sitePermissionsView(store);
  });
  handleSettingsCall(SitePermissionsChannel.forget, (event, origin) => {
    const store = scoped(event);
    if (store && typeof origin === 'string') store.forget(origin);
    return sitePermissionsView(store);
  });
  handleSettingsCall(SitePermissionsChannel.openSystemSettings, (_event, device) => {
    if (isSystemDevice(device)) openSystemSettings(device);
  });
  handleSettingsCall(RequestRulesChannel.list, () => host.requestRules.list());
  handleSettingsCall(RequestRulesChannel.save, (_event, rules) => {
    const saved = host.requestRules.save(rules);
    host.onRequestRulesSaved();
    return saved;
  });
}
