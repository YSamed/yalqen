export const NETWORK_PRESETS = ['offline', 'slow-3g', 'fast-3g', 'fast-4g'] as const;
export type NetworkPreset = (typeof NETWORK_PRESETS)[number];

export const USER_AGENT_PRESETS = ['firefox', 'safari', 'edge', 'iphone', 'android', 'googlebot'] as const;
export type UserAgentPreset = (typeof USER_AGENT_PRESETS)[number];

export interface PageOverrides {
  cacheDisabled: boolean;
  network: NetworkPreset | null;
  colorScheme: 'light' | 'dark' | null;
  reducedMotion: boolean;
  printMedia: boolean;
  userAgent: UserAgentPreset | null;
  requestRules: boolean;
}

export type RequestRuleAction = 'block' | 'mock' | 'redirect' | 'headers';

export interface RequestRule {
  id: string;
  enabled: boolean;
  pattern: string;
  action: RequestRuleAction;
  status: number;
  contentType: string;
  body: string;
  redirectUrl: string;
  headers: string;
}

export const AUTO_RELOAD_SECONDS = [5, 10, 30, 60] as const;
export type AutoReloadSeconds = (typeof AUTO_RELOAD_SECONDS)[number];

export type DevCommandId =
  | 'hard-reload'
  | 'toggle-cache'
  | `network-${NetworkPreset}`
  | 'network-online'
  | 'color-scheme-light'
  | 'color-scheme-dark'
  | 'color-scheme-auto'
  | 'toggle-reduced-motion'
  | 'toggle-print-media'
  | `user-agent-${UserAgentPreset}`
  | 'user-agent-default'
  | 'reset-overrides'
  | 'developer-window'
  | 'toggle-request-rules'
  | 'edit-request-rules'
  | `auto-reload-${AutoReloadSeconds}`
  | 'auto-reload-off'
  | 'devtools'
  | 'view-source'
  | 'device'
  | 'responsive'
  | 'rotate-device'
  | 'screenshot'
  | 'full-page-screenshot'
  | 'capture-area'
  | 'copy-address'
  | 'copy-markdown'
  | 'copy-curl'
  | 'clear-cache'
  | 'clear-site-data'
  | 'pick-element';
