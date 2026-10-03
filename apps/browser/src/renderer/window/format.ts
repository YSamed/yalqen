import { t } from '../../shared/i18n';
import { NEW_TAB_URL, type TabSnapshot } from '../../shared/types';

export function isNewTab(url: string): boolean {
  return url === NEW_TAB_URL || url === 'about:blank';
}

export function siteLabel(tab: TabSnapshot): string {
  if (isNewTab(tab.url)) return t('format.newTab');
  try {
    const url = new URL(tab.url);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.host.replace(/^www\./, '');
  } catch {}
  return tab.title;
}

export function consoleErrorCount(tab: TabSnapshot): string {
  return tab.consoleErrors > 99 ? '99+' : String(tab.consoleErrors);
}

export function devStates(tab: TabSnapshot): string[] {
  const { overrides } = tab;
  return [
    tab.consoleErrors > 0
      ? t('format.consoleErrors', { count: tab.consoleErrors > 99 ? '99+' : tab.consoleErrors })
      : null,
    overrides.cacheDisabled ? t('format.cacheOff') : null,
    overrides.network === 'offline' ? t('format.offline') : overrides.network ? t('format.networkThrottled') : null,
    tab.autoReloadSeconds ? t('format.autoReloading') : null,
    overrides.colorScheme
      ? t(overrides.colorScheme === 'dark' ? 'format.darkThemeEmulated' : 'format.lightThemeEmulated')
      : null,
    overrides.reducedMotion ? t('format.reducedMotion') : null,
    overrides.printMedia ? t('format.printView') : null,
    overrides.userAgent ? t('format.userAgentChanged') : null,
    overrides.requestRules ? t('format.requestRulesApplied') : null,
    tab.agentObserved ? t('format.agentObserved') : null,
    tab.agentRules > 0 ? t('format.agentRules', { count: tab.agentRules }) : null,
  ].filter((state) => state !== null);
}
