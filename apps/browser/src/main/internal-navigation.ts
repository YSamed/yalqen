import { HISTORY_URL, INTERNAL_SCHEME, NEW_TAB_URL, type CommandPage } from '../shared/types.js';
import { PROCEED_URL } from './certificates.js';
import { PROCEED_HTTP_URL } from './https-only.js';
import type { RepoPromptAction } from './repo-prompt.js';

const NEW_TAB_SEARCH_URL = `${NEW_TAB_URL}search`;
const NEW_TAB_FORGET_URL = `${NEW_TAB_URL}forget`;
const NEW_TAB_REPO_URL = `${NEW_TAB_URL}repo`;
const REPO_ACTIONS = new Set<string>(['star', 'later', 'close'] satisfies RepoPromptAction[]);
const COMMAND_PAGES = new Set<string>(['downloads', 'bookmarks'] satisfies CommandPage[]);

export type InternalNavigation =
  | { type: 'proceed-http'; token: string }
  | { type: 'proceed-certificate'; token: string }
  | { type: 'page-command'; page: CommandPage; name: string; params: URLSearchParams }
  | { type: 'history-delete'; id: string }
  | { type: 'history-clear' }
  | { type: 'new-tab-search'; query: string }
  | { type: 'new-tab-forget'; url: string }
  | { type: 'new-tab-repo'; action: RepoPromptAction };

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

// Internal pages act through links and GET forms, so these addresses are commands for the
// browser rather than places to load.
export function internalNavigation(url: string): InternalNavigation | null {
  if (!url.startsWith(`${INTERNAL_SCHEME}://`)) return null;
  if (url.startsWith(PROCEED_HTTP_URL)) return { type: 'proceed-http', token: url.slice(PROCEED_HTTP_URL.length) };
  if (url.startsWith(PROCEED_URL)) return { type: 'proceed-certificate', token: url.slice(PROCEED_URL.length) };
  if (url.startsWith(`${HISTORY_URL}delete?`)) return { type: 'history-delete', id: param(url, 'id') };
  if (url === `${HISTORY_URL}clear`) return { type: 'history-clear' };
  if (url === NEW_TAB_SEARCH_URL || url.startsWith(`${NEW_TAB_SEARCH_URL}?`)) {
    return { type: 'new-tab-search', query: param(url, 'q') };
  }
  if (url.startsWith(`${NEW_TAB_FORGET_URL}?`)) return { type: 'new-tab-forget', url: param(url, 'url') };
  if (url.startsWith(`${NEW_TAB_REPO_URL}?`)) {
    const action = param(url, 'action');
    return REPO_ACTIONS.has(action) ? { type: 'new-tab-repo', action: action as RepoPromptAction } : null;
  }
  return pageCommand(url);
}

// A command only runs when it comes from the page that offers it, so other pages cannot
// trigger it by linking to its address.
export function isAllowedFrom(navigation: InternalNavigation, currentUrl: string): boolean {
  switch (navigation.type) {
    case 'proceed-http':
    case 'proceed-certificate':
      return true;
    case 'page-command':
      return currentUrl.startsWith(`${INTERNAL_SCHEME}://${navigation.page}/`);
    case 'history-delete':
    case 'history-clear':
      return currentUrl.startsWith(HISTORY_URL);
    case 'new-tab-search':
    case 'new-tab-forget':
    case 'new-tab-repo':
      return currentUrl === NEW_TAB_URL;
  }
}
