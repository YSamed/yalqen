import { NEW_TAB_URL } from '../../shared/types.js';
import { hostOf } from '../../shared/hosts.js';
import { t } from '../../shared/i18n.js';
import { escapeHtml } from './html.js';

export const ERR_ABORTED = -3;

export interface ErrorText {
  title: string;
  message: string;
}

export function isCertificateError(code: number): boolean {
  return code <= -200 && code > -300;
}

export function describeError(code: number, url: string): ErrorText {
  const host = hostOf(url) ?? url;
  switch (code) {
    case -106:
      return { title: t('errorPage.noInternetTitle'), message: t('errorPage.noInternetMessage') };
    case -105:
    case -137:
      return { title: t('errorPage.unreachableTitle'), message: t('errorPage.hostNotFound', { host }) };
    case -102:
      return { title: t('errorPage.unreachableTitle'), message: t('errorPage.refused', { host }) };
    case -7:
    case -118:
      return { title: t('errorPage.unreachableTitle'), message: t('errorPage.timedOut', { host }) };
    case -100:
    case -101:
    case -324:
      return { title: t('errorPage.unreachableTitle'), message: t('errorPage.connectionClosed', { host }) };
    case -20:
      return { title: t('errorPage.blockedPageTitle'), message: t('errorPage.blockedByAdBlocker', { host }) };
    case -312:
      return { title: t('errorPage.blockedAddressTitle'), message: t('errorPage.blockedAddressMessage') };
    default:
      if (isCertificateError(code)) {
        return {
          title: t('errorPage.insecureTitle'),
          message: t('errorPage.insecureMessage', { host }),
        };
      }
      return { title: t('errorPage.genericTitle'), message: t('errorPage.genericMessage', { host }) };
  }
}

function describeHttpsOnly(url: string): ErrorText {
  return {
    title: t('errorPage.httpsOnlyTitle'),
    message: t('errorPage.httpsOnlyMessage', { host: hostOf(url) ?? url }),
  };
}

const ICON_PATHS = {
  offline:
    '<path d="M2 8.8a15 15 0 0 1 4.2-2.6M10.7 5.1A15 15 0 0 1 22 8.8M5 12.9a10 10 0 0 1 5.2-2.7M16.8 11.5a10 10 0 0 1 2.2 1.4M8.5 16.4a5 5 0 0 1 7 0"/><path d="M12 20h.01"/><path d="m2 2 20 20"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="M12 8v4"/><path d="M12 16h.01"/>',
  unreachable:
    '<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>',
};

function iconFor(code: number, warning: boolean): string {
  const kind = code === -106 ? 'offline' : warning ? 'shield' : 'unreachable';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[kind]}</svg>`;
}

const RETRY_ICON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>';

export function errorPageHtml(
  theme: string,
  code: number,
  name: string,
  url: string,
  proceedUrl: string | null = null,
  httpsOnly = false,
  text?: ErrorText,
): string {
  const { title, message } = text ?? (httpsOnly ? describeHttpsOnly(url) : describeError(code, url));
  const proceedLabel = escapeHtml(httpsOnly ? t('errorPage.continueHttp') : t('errorPage.continueAnyway'));
  const warning = proceedUrl !== null || isCertificateError(code);
  return `<head><meta charset="utf-8"><title>${escapeHtml(hostOf(url) ?? url)}</title><style>
${theme}
:root { color-scheme: light dark; --tone: ${warning ? 'var(--warn)' : 'var(--accent)'}; }
html, body { height: 100%; margin: 0; }
body { display: grid; place-items: center; padding: 24px; box-sizing: border-box; color: var(--text);
  background: radial-gradient(60% 45% at 50% 42%, color-mix(in srgb, var(--tone) 7%, transparent), transparent 70%), var(--page);
  font: 14px/1.55 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', sans-serif; -webkit-font-smoothing: antialiased; }
main { display: flex; flex-direction: column; align-items: center; max-width: 440px; text-align: center; animation: rise .35s cubic-bezier(.2,.8,.2,1) both; }
.icon { display: grid; place-items: center; width: 64px; height: 64px; margin-bottom: 20px; border-radius: 20px; color: var(--tone);
  background: color-mix(in srgb, var(--tone) 12%, var(--surface)); border: 1px solid color-mix(in srgb, var(--tone) 22%, var(--border)); }
.icon svg { width: 30px; height: 30px; }
h1 { margin: 0 0 8px; font-size: 22px; font-weight: 650; letter-spacing: -.02em; }
p { margin: 0; color: var(--text-muted); overflow-wrap: anywhere; }
code { margin-top: 14px; padding: 3px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface);
  font: 11px/1.6 ui-monospace, 'SF Mono', Menlo, monospace; color: var(--text-muted); letter-spacing: .02em; }
.actions { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 24px; }
button { display: inline-flex; align-items: center; gap: 8px; padding: 9px 18px; border: 0; border-radius: 999px; cursor: pointer;
  background: var(--accent); color: #fff; font: inherit; font-weight: 600; transition: filter .15s, transform .15s; }
button svg { width: 15px; height: 15px; transition: transform .4s; }
button:hover { filter: brightness(1.08); }
button:hover svg { transform: rotate(90deg); }
button:active { transform: scale(.97); }
button:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent) 55%, transparent); outline-offset: 3px; }
button.link { padding: 4px 8px; background: none; color: var(--text-muted); font-weight: 400; font-size: 13px; text-decoration: underline; text-underline-offset: 3px; }
button.link:hover { color: var(--text); filter: none; }
@keyframes rise { from { opacity: 0; transform: translateY(6px); } }
@media (prefers-reduced-motion: reduce) { main, button, button svg { animation: none; transition: none; } }
</style></head><body><main>
<div class="icon">${iconFor(code, warning)}</div>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
<code>${escapeHtml(name)}</code>
<div class="actions">${
    proceedUrl
      ? `<button id="back" type="button">${escapeHtml(t('errorPage.backToSafety'))}</button><button id="proceed" class="link" type="button">${proceedLabel}</button>`
      : `<button id="retry" type="button">${RETRY_ICON}${escapeHtml(t('errorPage.retry'))}</button>`
  }</div>
</main></body>`;
}

export function errorPageScript(
  theme: string,
  code: number,
  name: string,
  url: string,
  proceedUrl: string | null = null,
  httpsOnly = false,
  text?: ErrorText,
): string {
  return `(() => {
  if (location.protocol !== 'chrome-error:') return;
  document.documentElement.innerHTML = ${JSON.stringify(errorPageHtml(theme, code, name, url, proceedUrl, httpsOnly, text))};
  const on = (id, listener) => document.getElementById(id)?.addEventListener('click', listener);
  on('retry', () => location.replace(${JSON.stringify(url)}));
  on('back', () => (history.length > 1 ? history.back() : location.replace(${JSON.stringify(NEW_TAB_URL)})));
  on('proceed', () => location.assign(${JSON.stringify(proceedUrl)}));
})();`;
}
