import { ARCHIVE_URL, HISTORY_URL, INTERNAL_SCHEME, NEW_TAB_URL, type CommandPage } from '../../shared/types.js';
import { PROCEED_URL } from '../privacy/certificates.js';
import { PROCEED_HTTP_URL } from '../privacy/https-only.js';
import { PROCEED_THREAT_URL } from '../privacy/threat-guard.js';
import type { RepoPromptAction } from '../app/repo-prompt.js';

const NEW_TAB_SEARCH_URL = `${NEW_TAB_URL}search`;
const NEW_TAB_REPO_URL = `${NEW_TAB_URL}repo`;
const NEW_TAB_UPDATE_URL = `${NEW_TAB_URL}update`;
const UPDATE_ACTIONS = new Set<string>(['install', 'close'] satisfies UpdateCardAction[]);
const REPO_ACTIONS = new Set<string>(['star', 'later', 'close'] satisfies RepoPromptAction[]);
const COMMAND_PAGES = new Set<string>(['downloads', 'bookmarks'] satisfies CommandPage[]);

export type UpdateCardAction = 'install' | 'close';

export type InternalNavigation =
  | { type: 'proceed-http'; token: string }
  | { type: 'proceed-threat'; token: string }
  | { type: 'proceed-certificate'; token: string }
  | { type: 'page-command'; page: CommandPage; name: string; params: URLSearchParams }
  | { type: 'history-delete'; id: string }
  | { type: 'history-clear' }
  | { type: 'archive-restore'; id: string }
  | { type: 'new-tab-search'; query: string }
  | { type: 'new-tab-repo'; action: RepoPromptAction }
  | { type: 'new-tab-update'; action: UpdateCardAction };

function pageCommand(url: string): InternalNavigation | null {
  try {
    const parsed = new URL(url);
    if (!COMMAND_PAGES.has(parsed.host) || parsed.pathname === '/') return null;
    return {
      type: 'page-command',
      page: parsed.host as CommandPage,
      name: parsed.pathname.slice(1),
      params: parsed.searchParams,
    };
  } catch {
    return null;
  }
}

const param = (url: string, name: string) => new URL(url).searchParams.get(name) ?? '';

export function internalNavigation(url: string): InternalNavigation | null {
  if (!url.startsWith(`${INTERNAL_SCHEME}://`)) return null;
  if (url.startsWith(PROCEED_HTTP_URL)) return { type: 'proceed-http', token: url.slice(PROCEED_HTTP_URL.length) };
  if (url.startsWith(PROCEED_THREAT_URL))
    return { type: 'proceed-threat', token: url.slice(PROCEED_THREAT_URL.length) };
  if (url.startsWith(PROCEED_URL)) return { type: 'proceed-certificate', token: url.slice(PROCEED_URL.length) };
  if (url.startsWith(`${HISTORY_URL}delete?`)) return { type: 'history-delete', id: param(url, 'id') };
  if (url === `${HISTORY_URL}clear`) return { type: 'history-clear' };
  if (url.startsWith(`${ARCHIVE_URL}restore?`)) return { type: 'archive-restore', id: param(url, 'id') };
  if (url === NEW_TAB_SEARCH_URL || url.startsWith(`${NEW_TAB_SEARCH_URL}?`)) {
    return { type: 'new-tab-search', query: param(url, 'q') };
  }
  if (url.startsWith(`${NEW_TAB_REPO_URL}?`)) {
    const action = param(url, 'action');
    return REPO_ACTIONS.has(action) ? { type: 'new-tab-repo', action: action as RepoPromptAction } : null;
  }
  if (url.startsWith(`${NEW_TAB_UPDATE_URL}?`)) {
    const action = param(url, 'action');
    return UPDATE_ACTIONS.has(action) ? { type: 'new-tab-update', action: action as UpdateCardAction } : null;
  }
  return pageCommand(url);
}

export function isAllowedFrom(navigation: InternalNavigation, currentUrl: string): boolean {
  switch (navigation.type) {
    case 'proceed-http':
    case 'proceed-threat':
    case 'proceed-certificate':
      return true;
    case 'page-command':
      return currentUrl.startsWith(`${INTERNAL_SCHEME}://${navigation.page}/`);
    case 'history-delete':
    case 'history-clear':
      return currentUrl.startsWith(HISTORY_URL);
    case 'archive-restore':
      return currentUrl.startsWith(ARCHIVE_URL);
    case 'new-tab-search':
    case 'new-tab-repo':
    case 'new-tab-update':
      return currentUrl === NEW_TAB_URL;
  }
}
