import type { NetworkPreset, PageOverrides, RequestRule, UserAgentPreset } from '../shared/types.js';
import { ANDROID_UA, IOS_UA } from './devices.js';
import { interceptPatterns } from './request-rules.js';
import { t } from '../shared/i18n.js';

export const NO_OVERRIDES: PageOverrides = {
  cacheDisabled: false,
  network: null,
  colorScheme: null,
  reducedMotion: false,
  printMedia: false,
  userAgent: null,
  requestRules: false,
};

interface NetworkConditions {
  offline: boolean;
  latency: number;
  downloadThroughput: number;
  uploadThroughput: number;
}

const UNTHROTTLED: NetworkConditions = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

// Same figures as the Chrome DevTools presets, in milliseconds and bytes per second.
export const NETWORK_CONDITIONS: Record<NetworkPreset, { label: string; conditions: NetworkConditions }> = {
  offline: {
    get label() {
      return t('pageOverrides.offline');
    },
    conditions: { ...UNTHROTTLED, offline: true },
  },
  'slow-3g': {
    get label() {
      return t('pageOverrides.slow3g');
    },
    conditions: { offline: false, latency: 2000, downloadThroughput: 50000, uploadThroughput: 50000 },
  },
  'fast-3g': {
    get label() {
      return t('pageOverrides.fast3g');
    },
    conditions: { offline: false, latency: 562.5, downloadThroughput: 180000, uploadThroughput: 84375 },
  },
  'fast-4g': {
    get label() {
      return t('pageOverrides.fast4g');
    },
    conditions: { offline: false, latency: 165, downloadThroughput: 1012500, uploadThroughput: 168750 },
  },
};

export interface UserAgent {
  userAgent: string;
  platform: string;
}

export const USER_AGENTS: Record<UserAgentPreset, UserAgent & { label: string }> = {
  firefox: {
    label: 'Firefox (macOS)',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:143.0) Gecko/20100101 Firefox/143.0',
    platform: 'MacIntel',
  },
  safari: {
    label: 'Safari (macOS)',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    platform: 'MacIntel',
  },
  edge: {
    label: 'Edge (Windows)',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    platform: 'Win32',
  },
  iphone: { label: 'Safari (iPhone)', userAgent: IOS_UA, platform: 'iPhone' },
  android: { label: 'Chrome (Android)', userAgent: ANDROID_UA, platform: 'Linux armv8l' },
  googlebot: {
    label: 'Googlebot',
    userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    platform: '',
  },
};

export function hasOverrides(overrides: PageOverrides): boolean {
  return (Object.keys(NO_OVERRIDES) as (keyof PageOverrides)[]).some((key) => overrides[key] !== NO_OVERRIDES[key]);
}

export interface ProtocolCommand {
  method: string;
  params?: Record<string, unknown>;
  // Resetting the network domain on a page where it was never enabled may be refused.
  optional?: boolean;
}

export function overrideCommands(
  overrides: PageOverrides,
  fallbackUserAgent: UserAgent,
  rules: readonly RequestRule[] = [],
): ProtocolCommand[] {
  const patterns = overrides.requestRules ? interceptPatterns(rules) : [];
  const fetch: ProtocolCommand =
    patterns.length > 0
      ? { method: 'Fetch.enable', params: { patterns } }
      : { method: 'Fetch.disable', optional: true };
  const conditions = overrides.network ? NETWORK_CONDITIONS[overrides.network].conditions : UNTHROTTLED;
  const network: ProtocolCommand[] =
    overrides.cacheDisabled || overrides.network
      ? [
          // Only the switches are needed, so the protocol keeps no response bodies around.
          { method: 'Network.enable', params: { maxTotalBufferSize: 0, maxResourceBufferSize: 0 } },
          { method: 'Network.setCacheDisabled', params: { cacheDisabled: overrides.cacheDisabled } },
          { method: 'Network.emulateNetworkConditions', params: { ...conditions } },
        ]
      : [
          { method: 'Network.setCacheDisabled', params: { cacheDisabled: false }, optional: true },
          { method: 'Network.emulateNetworkConditions', params: { ...UNTHROTTLED }, optional: true },
          { method: 'Network.disable', optional: true },
        ];
  const userAgent = overrides.userAgent ? USER_AGENTS[overrides.userAgent] : fallbackUserAgent;
  return [
    ...network,
    fetch,
    {
      method: 'Emulation.setEmulatedMedia',
      params: {
        media: overrides.printMedia ? 'print' : '',
        features: [
          { name: 'prefers-color-scheme', value: overrides.colorScheme ?? '' },
          { name: 'prefers-reduced-motion', value: overrides.reducedMotion ? 'reduce' : '' },
        ],
      },
    },
    {
      method: 'Emulation.setUserAgentOverride',
      params: { userAgent: userAgent.userAgent, platform: userAgent.platform },
    },
  ];
}
