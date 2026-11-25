import { accentCss } from '../../shared/accent.js';
import { t } from '../../shared/i18n.js';
import { NEW_TAB_URL, type AddressSuggestion } from '../../shared/types.js';
import { FORGET_ICON, escapeHtml, fillSlot } from './html.js';
import { htmlResponse, notFound, scriptResponse } from './responses.js';

const NEW_TAB_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:; script-src 'self'; connect-src 'self'";
const UPDATE_MARKER = '__YALQEN_UPDATE_SLOT__';
const REPO_PROMPT_MARKER = '__YALQEN_REPO_PROMPT_SLOT__';
const ENGINE_MARKER = '__YALQEN_ENGINE_SLOT__';
const SMALL_FORGET_ICON = FORGET_ICON.replace('width="14" height="14"', 'width="11" height="11"');

export interface NewTabAssets {
  template: string;
  script: string;
  mark: Buffer<ArrayBuffer>;
}

export interface NewTabSources {
  readyUpdate: () => string | null;
  showRepoPrompt: () => boolean;
  engine?: () => string;
  accent?: () => string;
  suggestions: (query: string) => AddressSuggestion[];
}

function renderUpdate(version: string): string {
  return `<aside class="repo-prompt update" aria-labelledby="update-title">
    <a class="icon-btn sm tone-muted repo-prompt-close" href="${NEW_TAB_URL}update?action=close" aria-label="${t('internalPages.close')}">${SMALL_FORGET_ICON}</a>
    <strong id="update-title">${t('internalPages.updateTitle', { version: escapeHtml(version) })}</strong>
    <p>${t('internalPages.updateText')}</p>
    <div class="repo-prompt-actions">
      <a class="btn primary" href="${NEW_TAB_URL}update?action=install">${t('internalPages.updateInstall')}</a>
    </div>
  </aside>`;
}

function renderRepoPrompt(): string {
  return `<aside class="repo-prompt" aria-labelledby="repo-prompt-title">
    <a class="icon-btn sm tone-muted repo-prompt-close" href="${NEW_TAB_URL}repo?action=close" aria-label="${t('internalPages.close')}">${SMALL_FORGET_ICON}</a>
    <strong id="repo-prompt-title">${t('internalPages.repoTitle')}</strong>
    <p>${t('internalPages.repoText')}</p>
    <div class="repo-prompt-actions">
      <a class="btn primary" href="${NEW_TAB_URL}repo?action=star">${t('internalPages.repoStar')}</a>
      <a class="btn ghost" href="${NEW_TAB_URL}repo?action=later">${t('internalPages.repoLater')}</a>
    </div>
  </aside>`;
}

export function serveNewTab(url: URL, assets: NewTabAssets, sources: NewTabSources): Response {
  switch (url.pathname) {
    case '/suggestions.js':
      return scriptResponse(assets.script);
    case '/mark.png':
      return new Response(assets.mark, {
        headers: { 'content-type': 'image/png', 'cache-control': 'max-age=86400' },
      });
    case '/suggestions':
      return Response.json(sources.suggestions(url.searchParams.get('q') ?? ''), {
        headers: { 'cache-control': 'no-store' },
      });
    case '/': {
      const readyUpdate = sources.readyUpdate();
      const slots: [string, string][] = [
        [UPDATE_MARKER, readyUpdate ? renderUpdate(readyUpdate) : ''],
        [ENGINE_MARKER, escapeHtml(sources.engine?.() ?? '')],
        [REPO_PROMPT_MARKER, !readyUpdate && sources.showRepoPrompt() ? renderRepoPrompt() : ''],
      ];
      const accent = sources.accent?.();
      const template = accent
        ? assets.template.replace('<html ', `<html style="--accent: ${escapeHtml(accentCss(accent))}" `)
        : assets.template;
      const body = slots.reduce((page, [marker, content]) => fillSlot(page, marker, content), template);
      return htmlResponse(body, NEW_TAB_CSP, false);
    }
    default:
      return notFound();
  }
}
