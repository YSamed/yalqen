// A tab browses in one of three modes. Private and developer tabs keep nothing after they close: no history,
// no cookies and no cache. Developer tabs also skip ad blocking and third-party cookie blocking and open DevTools.
export type TabMode = 'normal' | 'private' | 'developer';

export const TAB_MODES: readonly TabMode[] = ['normal', 'developer', 'private'];

export function isTabMode(value: unknown): value is TabMode {
  return (TAB_MODES as readonly unknown[]).includes(value);
}

export function modeOf(tab: { isPrivate: boolean; developer?: boolean }): TabMode {
  if (tab.developer) return 'developer';
  return tab.isPrivate ? 'private' : 'normal';
}

// Developer tabs are off the record too, so code that only asks "is this private?" keeps them out of history.
export function modeFlags(mode: TabMode): { isPrivate: boolean; developer: boolean } {
  return { isPrivate: mode !== 'normal', developer: mode === 'developer' };
}
