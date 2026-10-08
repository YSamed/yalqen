import { dialog, type OpenDialogOptions } from 'electron';
import { t } from '../../shared/i18n.js';
import {
  RequestRulesChannel,
  SettingsChannel,
  SitePermissionsChannel,
  type ClearDataRequest,
  type SettingsView,
  type SitePermissionsView,
} from '../../shared/types.js';
import type { RequestRuleStore } from '../devtools/request-rules.js';
import { isSitePermission, permissionOrigin, type PermissionStore } from '../privacy/permissions.js';
import { isSystemDevice, openSystemSettings, systemAccessStatus } from '../privacy/system-access.js';
import { sanitizeClearRequest } from '../library/clear-data.js';
import { makeDefaultBrowser } from './default-browser.js';
import { processUsage } from './process-metrics.js';
import { handleSettingsCall } from './settings-page.js';
import type { Updater } from './updater.js';

export interface SettingsIpcHost {
  view(): SettingsView;
  update(patch: unknown): void;
  clearData(request: ClearDataRequest): Promise<void>;
  updater: Updater;
  relaunch(): void;
  requestRules: RequestRuleStore;
  permissions: PermissionStore;
  onRequestRulesSaved(): void;
  updateThreatLists(): Promise<void>;
  profiles: import('./profile-controller.js').ProfileController;
}

function sitePermissionsView(store: PermissionStore): SitePermissionsView {
  return {
    sites: store.origins().map((origin) => ({ origin, permissions: store.list(origin) })),
    system: systemAccessStatus(),
  };
}

export function registerSettingsIpc(host: SettingsIpcHost): void {
  handleSettingsCall(SettingsChannel.profiles, () => host.profiles.view());
  handleSettingsCall(SettingsChannel.profileAction, (_event, action, id, name) => host.profiles.run(action, id, name));
  handleSettingsCall(SettingsChannel.get, () => host.view());
  handleSettingsCall(SettingsChannel.update, (_event, patch) => {
    host.update(patch);
    return host.view();
  });
  handleSettingsCall(SettingsChannel.clearData, async (_event, value) => {
    const request = sanitizeClearRequest(value);
    if (request) await host.clearData(request);
  });
  handleSettingsCall(SettingsChannel.makeDefault, () => {
    makeDefaultBrowser();
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
    if (!canceled && filePaths[0]) host.update({ downloadDirectory: filePaths[0] });
    return host.view();
  });
  handleSettingsCall(SitePermissionsChannel.list, () => sitePermissionsView(host.permissions));
  handleSettingsCall(SitePermissionsChannel.set, (_event, origin, kind, decision) => {
    if (
      typeof origin === 'string' &&
      permissionOrigin(origin) === origin &&
      isSitePermission(kind) &&
      (decision === 'allow' || decision === 'deny' || decision === null)
    ) {
      host.permissions.set(origin, [kind], decision);
    }
    return sitePermissionsView(host.permissions);
  });
  handleSettingsCall(SitePermissionsChannel.forget, (_event, origin) => {
    if (typeof origin === 'string') host.permissions.forget(origin);
    return sitePermissionsView(host.permissions);
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
