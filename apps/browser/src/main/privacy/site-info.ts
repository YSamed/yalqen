import type { MenuItemConstructorOptions } from 'electron';
import { t } from '../../shared/i18n.js';
import type { SecurityState } from '../../shared/types.js';
import { permissionLabel, type Decision, type SitePermission } from './permissions.js';
import { siteDataItems, type SiteData, type SiteDataActions } from './site-data.js';

export function securityState(url: string, certificateException = false): SecurityState {
  try {
    const { protocol } = new URL(url);
    if (protocol === 'https:') return certificateException ? 'dangerous' : 'secure';
    if (protocol === 'http:') return 'insecure';
  } catch {}
  return 'local';
}

const stateText = (state: SecurityState): string => t(`siteInfo.${state}`);

interface SiteInfo {
  url: string;
  security: SecurityState;
  permissions: { kind: SitePermission; decision: Decision }[];
  data?: SiteData;
}

interface SiteInfoActions extends SiteDataActions {
  revokeCertificateException(): void;
  setPermission(kind: SitePermission, decision: Decision | null): void;
}

const decisionText = (decision: Decision): string => t(decision === 'allow' ? 'siteInfo.allowed' : 'siteInfo.blocked');

export function siteInfoTemplate(info: SiteInfo, actions: SiteInfoActions): MenuItemConstructorOptions[] {
  let host = info.url;
  try {
    host = new URL(info.url).host || info.url;
  } catch {}
  return [
    { label: host, enabled: false },
    { label: stateText(info.security), enabled: false },
    ...(info.security === 'dangerous'
      ? [
          { type: 'separator' as const },
          { label: t('siteInfo.reenableCertificateWarnings'), click: actions.revokeCertificateException },
        ]
      : []),
    ...(info.permissions.length > 0 ? [{ type: 'separator' as const }] : []),
    ...info.permissions.map(({ kind, decision }): MenuItemConstructorOptions => ({
      label: t('siteInfo.permissionStatus', { permission: permissionLabel(kind), decision: decisionText(decision) }),
      submenu: (
        [
          [t('siteInfo.ask'), null],
          [t('siteInfo.allow'), 'allow'],
          [t('siteInfo.block'), 'deny'],
        ] as const
      ).map(([label, choice]) => ({
        label: choice === null && kind === 'popups' ? t('siteInfo.defaultBlock') : label,
        type: 'radio' as const,
        checked: choice === decision,
        click: () => actions.setPermission(kind, choice),
      })),
    })),
    ...(info.data ? siteDataItems(info.data, actions) : []),
  ];
}
