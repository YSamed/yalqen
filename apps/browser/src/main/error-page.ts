import { NEW_TAB_URL } from '../shared/types.js';
import { hostOf } from '../shared/hosts.js';
import { t } from '../shared/i18n.js';
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

export function describeHttpsOnly(url: string): ErrorText {
  return {
    title: t('errorPage.httpsOnlyTitle'),
    message: t('errorPage.httpsOnlyMessage', { host: hostOf(url) ?? url }),
  };
}

export function errorPageHtml(
  code: number,
  name: string,
  url: string,
  proceedUrl: string | null = null,
  httpsOnly = false,
): string {
  const { title, message } = httpsOnly ? describeHttpsOnly(url) : describeError(code, url);
  const proceedLabel = escapeHtml(httpsOnly ? t('errorPage.continueHttp') : t('errorPage.continueAnyway'));
  return `<head><meta charset="utf-8"><title>${escapeHtml(hostOf(url) ?? url)}</title><style>
:root { color-scheme: light dark; --text: #1a1b1e; --muted: #6b6e75; --accent: #f28c28; --page: #fff; }
@media (prefers-color-scheme: dark) { :root { --text: #eceef1; --muted: #9a9ea6; --page: #1f2124; } }
html, body { height: 100%; margin: 0; }
body { display: grid; place-items: center; padding: 24px; box-sizing: border-box; background: var(--page); color: var(--text);
  font: 14px/1.5 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', sans-serif; -webkit-font-smoothing: antialiased; }
main { max-width: 520px; }
h1 { margin: 0 0 8px; font-size: 24px; letter-spacing: -.02em; }
p { margin: 0 0 6px; color: var(--muted); overflow-wrap: anywhere; }
code { font-size: 12px; color: var(--muted); }
button { margin-top: 20px; padding: 8px 16px; border: 0; border-radius: 999px; background: var(--accent); color: #fff; font: inherit; font-weight: 600; }
button:hover { filter: brightness(1.05); }
button.link { display: block; margin-top: 12px; padding: 0; background: none; color: var(--muted); font-weight: 400; text-decoration: underline; }
</style></head><body><main>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(message)}</p>
<code>${escapeHtml(name)}</code><br>
${
  proceedUrl
    ? `<button id="back" type="button">${escapeHtml(t('errorPage.backToSafety'))}</button><button id="proceed" class="link" type="button">${proceedLabel}</button>`
    : `<button id="retry" type="button">${escapeHtml(t('errorPage.retry'))}</button>`
}
</main></body>`;
}

export function errorPageScript(
  code: number,
  name: string,
  url: string,
  proceedUrl: string | null = null,
  httpsOnly = false,
): string {
  return `(() => {
  if (location.protocol !== 'chrome-error:') return;
  document.documentElement.innerHTML = ${JSON.stringify(errorPageHtml(code, name, url, proceedUrl, httpsOnly))};
  const on = (id, listener) => document.getElementById(id)?.addEventListener('click', listener);
  on('retry', () => location.replace(${JSON.stringify(url)}));
  on('back', () => (history.length > 1 ? history.back() : location.replace(${JSON.stringify(NEW_TAB_URL)})));
  on('proceed', () => location.assign(${JSON.stringify(proceedUrl)}));
})();`;
}
