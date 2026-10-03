import { RequestRulesChannel, SettingsChannel, type ClearDataRequest, type SettingsView } from '../../shared/types.js';
import type { RequestRuleStore } from '../devtools/request-rules.js';
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
  requestRules: RequestRuleStore;
  onRequestRulesSaved(): void;
}

export function registerSettingsIpc(host: SettingsIpcHost): void {
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
  handleSettingsCall(SettingsChannel.processUsage, () => processUsage());
  handleSettingsCall(SettingsChannel.checkForUpdates, () => host.updater.check());
  handleSettingsCall(SettingsChannel.installUpdate, () => host.updater.install());
  handleSettingsCall(RequestRulesChannel.list, () => host.requestRules.list());
  handleSettingsCall(RequestRulesChannel.save, (_event, rules) => {
    const saved = host.requestRules.save(rules);
    host.onRequestRulesSaved();
    return saved;
  });
}
