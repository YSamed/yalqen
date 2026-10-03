import type { MenuItemConstructorOptions } from 'electron';
import {
  AUTO_RELOAD_SECONDS,
  NETWORK_PRESETS,
  USER_AGENT_PRESETS,
  type DevCommandId,
  type PageOverrides,
} from '../../shared/types.js';
import { NETWORK_CONDITIONS, USER_AGENTS, hasOverrides } from './page-overrides.js';
import { t } from '../../shared/i18n.js';

export interface DevMenuState {
  consoleErrors: number;
  autoReloadSeconds: number | null;
  overrides: PageOverrides;
}

export interface DevMenuActions {
  run(id: DevCommandId): void;
  openDevTools(): void;
}

function radio(label: string, checked: boolean, click: () => void): MenuItemConstructorOptions {
  return { label, type: 'radio', checked, click };
}

export function devMenuTemplate(state: DevMenuState, actions: DevMenuActions): MenuItemConstructorOptions[] {
  const { overrides, consoleErrors } = state;
  const run = (id: DevCommandId) => () => actions.run(id);
  return [
    ...(consoleErrors > 0
      ? [
          {
            label: t('devMenu.consoleErrors', { count: consoleErrors > 99 ? '99+' : consoleErrors }),
            click: actions.openDevTools,
          },
          { type: 'separator' as const },
        ]
      : []),
    { label: t('devMenu.pickElement'), accelerator: 'Alt+CmdOrCtrl+P', click: run('pick-element') },
    { type: 'separator' },
    {
      label: t('devMenu.disableCache'),
      type: 'checkbox',
      checked: overrides.cacheDisabled,
      click: run('toggle-cache'),
    },
    {
      label: t('devMenu.network'),
      submenu: [
        radio(t('devMenu.noThrottling'), overrides.network === null, run('network-online')),
        ...NETWORK_PRESETS.map((preset) =>
          radio(NETWORK_CONDITIONS[preset].label, overrides.network === preset, run(`network-${preset}`)),
        ),
      ],
    },
    {
      label: t('devMenu.autoReload'),
      submenu: [
        radio(t('devMenu.autoReloadOff'), state.autoReloadSeconds === null, run('auto-reload-off')),
        ...AUTO_RELOAD_SECONDS.map((seconds) =>
          radio(
            seconds < 60 ? t('devMenu.seconds', { seconds }) : t('devMenu.minutes', { count: seconds / 60 }),
            state.autoReloadSeconds === seconds,
            run(`auto-reload-${seconds}`),
          ),
        ),
      ],
    },
    { type: 'separator' },
    {
      label: t('devMenu.theme'),
      submenu: [
        radio(t('devMenu.themeSystem'), overrides.colorScheme === null, run('color-scheme-auto')),
        radio(t('devMenu.themeLight'), overrides.colorScheme === 'light', run('color-scheme-light')),
        radio(t('devMenu.themeDark'), overrides.colorScheme === 'dark', run('color-scheme-dark')),
      ],
    },
    {
      label: t('devMenu.reducedMotion'),
      type: 'checkbox',
      checked: overrides.reducedMotion,
      click: run('toggle-reduced-motion'),
    },
    {
      label: t('devMenu.printView'),
      type: 'checkbox',
      checked: overrides.printMedia,
      click: run('toggle-print-media'),
    },
    {
      label: 'User-Agent',
      submenu: [
        radio(t('devMenu.userAgentDefault'), overrides.userAgent === null, run('user-agent-default')),
        ...USER_AGENT_PRESETS.map((preset) =>
          radio(USER_AGENTS[preset].label, overrides.userAgent === preset, run(`user-agent-${preset}`)),
        ),
      ],
    },
    { type: 'separator' },
    {
      label: t('devMenu.applyRequestRules'),
      type: 'checkbox',
      checked: overrides.requestRules,
      click: run('toggle-request-rules'),
    },
    { label: t('devMenu.editRequestRules'), click: run('edit-request-rules') },
    { type: 'separator' },
    { label: t('devMenu.resetOverrides'), enabled: hasOverrides(overrides), click: run('reset-overrides') },
  ];
}
