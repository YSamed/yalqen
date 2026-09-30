export const UPDATE_POPUP_URL = 'yalqen://update/';

export type UpdatePopupCommand = 'install' | 'notes' | 'later';

const COMMANDS = new Set<string>(['install', 'notes', 'later'] satisfies UpdatePopupCommand[]);
const VERSION = /^[\w.+-]{1,32}$/;

export function updatePopupUrl(version: string): string {
  return `${UPDATE_POPUP_URL}?version=${encodeURIComponent(version)}`;
}

export function updatePopupVersion(query: string | null): string {
  return query !== null && VERSION.test(query) ? query : '';
}

export function updatePopupCommand(url: string): UpdatePopupCommand | null {
  if (!url.startsWith(UPDATE_POPUP_URL)) return null;
  const name = new URL(url).pathname.slice(1);
  return COMMANDS.has(name) ? (name as UpdatePopupCommand) : null;
}

export function releaseNotesUrl(version: string): string {
  return `https://github.com/YSamed/yalqen/releases/tag/v${version}`;
}
