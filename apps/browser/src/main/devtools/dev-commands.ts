import {
  AUTO_RELOAD_SECONDS,
  NETWORK_PRESETS,
  USER_AGENT_PRESETS,
  type AddressSuggestion,
  type AutoReloadSeconds,
  type DevCommandId,
  type PageOverrides,
} from '../../shared/types.js';
import { NETWORK_CONDITIONS, NO_OVERRIDES, USER_AGENTS } from './page-overrides.js';
import { getLocale, t } from '../../shared/i18n.js';

const DEV_COMMAND_PREFIX = '>';

interface DevCommand {
  id: DevCommandId;
  title: string;
  shortcut?: string;
  keywords: string;
}

function autoReloadLabel(seconds: AutoReloadSeconds): string {
  return seconds < 60
    ? t('devCommands.intervalSeconds', { seconds })
    : t('devCommands.intervalMinutes', { minutes: seconds / 60 });
}

export function devCommands(): readonly DevCommand[] {
  return [
    {
      id: 'hard-reload',
      title: t('devCommands.hardReload'),
      shortcut: '⇧⌘R',
      keywords: t('devCommands.hardReloadKeywords'),
    },
    { id: 'toggle-cache', title: t('devCommands.toggleCache'), keywords: t('devCommands.toggleCacheKeywords') },
    ...AUTO_RELOAD_SECONDS.map((seconds): DevCommand => ({
      id: `auto-reload-${seconds}`,
      title: t('devCommands.autoReload', { interval: autoReloadLabel(seconds) }),
      keywords: t('devCommands.autoReloadKeywords'),
    })),
    { id: 'auto-reload-off', title: t('devCommands.autoReloadOff'), keywords: t('devCommands.autoReloadOffKeywords') },
    ...NETWORK_PRESETS.map((preset): DevCommand => ({
      id: `network-${preset}`,
      title: t('devCommands.network', { label: NETWORK_CONDITIONS[preset].label }),
      keywords: t('devCommands.networkKeywords'),
    })),
    { id: 'network-online', title: t('devCommands.networkOnline'), keywords: t('devCommands.networkOnlineKeywords') },
    {
      id: 'color-scheme-dark',
      title: t('devCommands.colorSchemeDark'),
      keywords: t('devCommands.colorSchemeDarkKeywords'),
    },
    {
      id: 'color-scheme-light',
      title: t('devCommands.colorSchemeLight'),
      keywords: t('devCommands.colorSchemeLightKeywords'),
    },
    {
      id: 'color-scheme-auto',
      title: t('devCommands.colorSchemeAuto'),
      keywords: t('devCommands.colorSchemeAutoKeywords'),
    },
    {
      id: 'toggle-reduced-motion',
      title: t('devCommands.toggleReducedMotion'),
      keywords: t('devCommands.toggleReducedMotionKeywords'),
    },
    {
      id: 'toggle-print-media',
      title: t('devCommands.togglePrintMedia'),
      keywords: t('devCommands.togglePrintMediaKeywords'),
    },
    ...USER_AGENT_PRESETS.map((preset): DevCommand => ({
      id: `user-agent-${preset}`,
      title: t('devCommands.userAgent', { label: USER_AGENTS[preset].label }),
      keywords: t('devCommands.userAgentKeywords'),
    })),
    {
      id: 'user-agent-default',
      title: t('devCommands.userAgentDefault'),
      keywords: t('devCommands.userAgentDefaultKeywords'),
    },
    {
      id: 'developer-window',
      title: t('devCommands.developerWindow'),
      keywords: t('devCommands.developerWindowKeywords'),
    },
    {
      id: 'toggle-request-rules',
      title: t('devCommands.toggleRequestRules'),
      keywords: t('devCommands.toggleRequestRulesKeywords'),
    },
    {
      id: 'edit-request-rules',
      title: t('devCommands.editRequestRules'),
      keywords: t('devCommands.editRequestRulesKeywords'),
    },
    {
      id: 'reset-overrides',
      title: t('devCommands.resetOverrides'),
      keywords: t('devCommands.resetOverridesKeywords'),
    },
    {
      id: 'devtools',
      title: t('devCommands.devtools'),
      shortcut: '⌥⌘I',
      keywords: t('devCommands.devtoolsKeywords'),
    },
    {
      id: 'pick-element',
      title: t('devCommands.pickElement'),
      shortcut: '⌥⌘P',
      keywords: t('devCommands.pickElementKeywords'),
    },
    {
      id: 'view-source',
      title: t('devCommands.viewSource'),
      shortcut: '⌥⌘U',
      keywords: t('devCommands.viewSourceKeywords'),
    },
    { id: 'device', title: t('devCommands.device'), shortcut: '⌥⌘M', keywords: t('devCommands.deviceKeywords') },
    { id: 'responsive', title: t('devCommands.responsive'), keywords: t('devCommands.responsiveKeywords') },
    {
      id: 'rotate-device',
      title: t('devCommands.rotateDevice'),
      shortcut: '⇧⌥⌘M',
      keywords: t('devCommands.rotateDeviceKeywords'),
    },
    { id: 'screenshot', title: t('devCommands.screenshot'), keywords: t('devCommands.screenshotKeywords') },
    {
      id: 'full-page-screenshot',
      title: t('devCommands.fullPageScreenshot'),
      shortcut: '⌥⌘S',
      keywords: t('devCommands.fullPageScreenshotKeywords'),
    },
    { id: 'copy-address', title: t('devCommands.copyAddress'), keywords: t('devCommands.copyAddressKeywords') },
    { id: 'copy-markdown', title: t('devCommands.copyMarkdown'), keywords: t('devCommands.copyMarkdownKeywords') },
    { id: 'copy-curl', title: t('devCommands.copyCurl'), keywords: t('devCommands.copyCurlKeywords') },
    { id: 'clear-cache', title: t('devCommands.clearCache'), keywords: t('devCommands.clearCacheKeywords') },
    { id: 'clear-site-data', title: t('devCommands.clearSiteData'), keywords: t('devCommands.clearSiteDataKeywords') },
  ];
}

export function isDevCommandInput(input: string): boolean {
  return input.trimStart().startsWith(DEV_COMMAND_PREFIX);
}

export function autoReloadSeconds(id: DevCommandId): AutoReloadSeconds | null {
  return AUTO_RELOAD_SECONDS.find((seconds) => id === `auto-reload-${seconds}`) ?? null;
}

export function overridePatch(id: DevCommandId, current: PageOverrides): Partial<PageOverrides> | null {
  const network = NETWORK_PRESETS.find((preset) => id === `network-${preset}`);
  if (network) return { network };
  const userAgent = USER_AGENT_PRESETS.find((preset) => id === `user-agent-${preset}`);
  if (userAgent) return { userAgent };
  switch (id) {
    case 'toggle-cache':
      return { cacheDisabled: !current.cacheDisabled };
    case 'network-online':
      return { network: null };
    case 'color-scheme-dark':
      return { colorScheme: 'dark' };
    case 'color-scheme-light':
      return { colorScheme: 'light' };
    case 'color-scheme-auto':
      return { colorScheme: null };
    case 'toggle-reduced-motion':
      return { reducedMotion: !current.reducedMotion };
    case 'toggle-print-media':
      return { printMedia: !current.printMedia };
    case 'user-agent-default':
      return { userAgent: null };
    case 'toggle-request-rules':
      return { requestRules: !current.requestRules };
    case 'reset-overrides':
      return NO_OVERRIDES;
    default:
      return null;
  }
}

export function isDevCommandId(value: unknown): value is DevCommandId {
  return devCommands().some((command) => command.id === value);
}

export function matchDevCommands(input: string): AddressSuggestion[] {
  const terms = input
    .trimStart()
    .slice(DEV_COMMAND_PREFIX.length)
    .toLocaleLowerCase(getLocale())
    .split(/\s+/)
    .filter(Boolean);
  return devCommands()
    .filter((command) => {
      const text = `${command.title} ${command.keywords}`.toLocaleLowerCase(getLocale());
      return terms.every((term) => text.includes(term));
    })
    .map((command) => ({
      kind: 'command',
      title: command.title,
      url: `${DEV_COMMAND_PREFIX}${command.id}`,
      commandId: command.id,
      ...(command.shortcut ? { hint: command.shortcut } : {}),
    }));
}
