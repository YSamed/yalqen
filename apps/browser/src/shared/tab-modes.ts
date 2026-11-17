export type TabMode = 'normal' | 'private' | 'developer';

export const TAB_MODES: readonly TabMode[] = ['normal', 'developer', 'private'];

export function isTabMode(value: unknown): value is TabMode {
  return (TAB_MODES as readonly unknown[]).includes(value);
}

export function modeOf(tab: { isPrivate: boolean; developer?: boolean }): TabMode {
  if (tab.developer) return 'developer';
  return tab.isPrivate ? 'private' : 'normal';
}

export function modeFlags(mode: TabMode): { isPrivate: boolean; developer: boolean } {
  return { isPrivate: mode !== 'normal', developer: mode === 'developer' };
}
