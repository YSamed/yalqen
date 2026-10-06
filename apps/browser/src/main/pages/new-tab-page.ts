import { displayHost } from '../../shared/hosts.js';
import { getLocale, t } from '../../shared/i18n.js';
import { NEW_TAB_URL, type AddressSuggestion } from '../../shared/types.js';
import type { RecentPage } from '../tabs/tab.js';
import { FORGET_ICON, escapeHtml, fillSlot } from './html.js';
import { htmlResponse, notFound, scriptResponse } from './responses.js';

const NEW_TAB_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' https: data:; script-src 'self'; connect-src 'self'";
const PINNED_MARKER = '__YALQEN_PINNED_SLOT__';
const WELCOME_MARKER = '__YALQEN_WELCOME_SLOT__';
const TIPS_MARKER = '__YALQEN_TIPS_SLOT__';
const ANNOUNCEMENT_MARKER = '__YALQEN_ANNOUNCEMENT_SLOT__';
const UPDATE_MARKER = '__YALQEN_UPDATE_SLOT__';
const FEEDBACK_MARKER = '__YALQEN_FEEDBACK_SLOT__';
const REPO_PROMPT_MARKER = '__YALQEN_REPO_PROMPT_SLOT__';
const SMALL_FORGET_ICON = FORGET_ICON.replace('width="14" height="14"', 'width="11" height="11"');

export interface NewTabAssets {
  template: string;
  script: string;
  mark: Buffer<ArrayBuffer>;
}

export interface NewTabSources {
  pinned: () => RecentPage[];
  showWelcome: () => boolean;
  readyUpdate: () => string | null;
  showAnnouncement: () => boolean;
  showFeedback: () => boolean;
  showRepoPrompt: () => boolean;
  suggestions: (query: string) => AddressSuggestion[];
}

export function renderPinned(pages: RecentPage[]): string {
  if (pages.length === 0) return '';
  const items = pages
    .map((page) => {
      const host = displayHost(page.url);
      const icon = page.faviconUrl?.startsWith('https:')
        ? `<img src="${escapeHtml(page.faviconUrl)}" alt="" width="24" height="24" />`
        : `<span class="letter">${escapeHtml(host.charAt(0).toLocaleUpperCase(getLocale()))}</span>`;
      return `<li><a href="${escapeHtml(page.url)}" title="${escapeHtml(page.title || host)}"><span class="tile">${icon}</span><span class="name">${escapeHtml(host)}</span></a></li>`;
    })
    .join('');
  return `<nav class="pinned" aria-label="${t('internalPages.pinned')}"><ul>${items}</ul></nav>`;
}

function renderWelcome(): string {
  return `<section class="welcome" aria-labelledby="welcome-title">
    <h1 id="welcome-title">${t('internalPages.welcomeTitle')}</h1>
    <p>${t('internalPages.welcomeText')}</p>
  </section>`;
}

function renderTips(): string {
  return `<ul class="tips" aria-label="${t('internalPages.tips')}">
    <li><strong>${t('internalPages.tipTabsTitle')}</strong><small>${t('internalPages.tipTabsText')}</small></li>
    <li><strong>${t('internalPages.tipPinTitle')}</strong><small>${t('internalPages.tipPinText')}</small></li>
    <li><strong>${t('internalPages.tipAdsTitle')}</strong><small>${t('internalPages.tipAdsText')}</small></li>
  </ul>`;
}

function renderAnnouncement(): string {
  return `<aside class="repo-prompt announcement" aria-labelledby="announcement-title">
    <a class="icon-btn sm tone-muted repo-prompt-close" href="${NEW_TAB_URL}announcement?action=close" aria-label="${t('internalPages.close')}">${SMALL_FORGET_ICON}</a>
    <strong id="announcement-title">${t('internalPages.announcementTitle')}</strong>
    <p>${t('internalPages.announcementText')}</p>
    <div class="repo-prompt-actions">
      <a class="btn primary" href="${NEW_TAB_URL}announcement?action=try">${t('internalPages.announcementTry')}</a>
    </div>
  </aside>`;
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

function renderFeedback(): string {
  return `<aside class="repo-prompt feedback" aria-labelledby="feedback-title">
    <a class="icon-btn sm tone-muted repo-prompt-close" href="${NEW_TAB_URL}feedback?action=close" aria-label="${t('internalPages.close')}">${SMALL_FORGET_ICON}</a>
    <strong id="feedback-title">${t('internalPages.feedbackTitle')}</strong>
    <p>${t('internalPages.feedbackText')}</p>
    <div class="repo-prompt-actions">
      <a class="btn primary" href="${NEW_TAB_URL}feedback?action=open">${t('internalPages.feedbackOpen')}</a>
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
      const welcomeVisible = sources.showWelcome();
      const readyUpdate = sources.readyUpdate();
      const announcementVisible = sources.showAnnouncement();
      const feedbackVisible = !welcomeVisible && sources.showFeedback();
      const slots: [string, string][] = [
        [WELCOME_MARKER, welcomeVisible ? renderWelcome() : ''],
        [PINNED_MARKER, renderPinned(sources.pinned())],
        [TIPS_MARKER, welcomeVisible ? renderTips() : ''],
        [UPDATE_MARKER, readyUpdate ? renderUpdate(readyUpdate) : ''],
        [ANNOUNCEMENT_MARKER, announcementVisible ? renderAnnouncement() : ''],
        [FEEDBACK_MARKER, feedbackVisible ? renderFeedback() : ''],
        [
          REPO_PROMPT_MARKER,
          !welcomeVisible && !readyUpdate && !announcementVisible && !feedbackVisible && sources.showRepoPrompt()
            ? renderRepoPrompt()
            : '',
        ],
      ];
      const body = slots.reduce((page, [marker, content]) => fillSlot(page, marker, content), assets.template);
      return htmlResponse(body, NEW_TAB_CSP, false);
    }
    default:
      return notFound();
  }
}
