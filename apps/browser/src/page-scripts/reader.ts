import { Readability, isProbablyReaderable } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import type { ReaderLabels } from '../shared/reader.js';

interface Article {
  title: string;
  byline: string;
  fragment: DocumentFragment;
  dir: string;
}
let pending: { token: string; article: Article | null } | null = null;
let dialog: HTMLDialogElement | null = null;
let host: HTMLDivElement | null = null;
let previousFocus: Element | null = null;

export function prepare(token: string): boolean {
  pending = null;
  if (dialog?.isConnected && dialog.open) {
    pending = { token, article: null };
    return true;
  }
  if (
    !['http:', 'https:'].includes(location.protocol) ||
    document.getElementsByTagName('*').length > 50_000 ||
    !isProbablyReaderable(document)
  )
    return false;
  const clone = document.cloneNode(true) as Document;
  // Remove user-entered data and active embeds before extracting the article.
  clone
    .querySelectorAll('form,input,textarea,select,iframe,object,embed,script,style,noscript')
    .forEach((node) => node.remove());
  const article = new Readability<Node>(clone, {
    maxElemsToParse: 50_000,
    charThreshold: 500,
    disableJSONLD: true,
    serializer: (node) => node,
  }).parse();
  if (!article?.content || (article.length ?? 0) > 4 * 1024 * 1024 || (article.length ?? 0) < 500) return false;
  const clean = DOMPurify.sanitize(article.content, {
    IN_PLACE: true,
    RETURN_DOM: true,
    ALLOWED_TAGS: [
      'p',
      'div',
      'span',
      'br',
      'hr',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'blockquote',
      'pre',
      'code',
      'em',
      'strong',
      'b',
      'i',
      's',
      'sub',
      'sup',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'th',
      'td',
      'a',
      'figure',
      'figcaption',
      'img',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'dir', 'lang', 'colspan', 'rowspan'],
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
  });
  const fragment = document.createDocumentFragment();
  fragment.append(clean);
  for (const element of fragment.querySelectorAll('a,img')) {
    const attribute = element.localName === 'a' ? 'href' : 'src';
    const raw = element.getAttribute(attribute);
    if (!raw) continue;
    try {
      const url = new URL(raw, location.href);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
        element.removeAttribute(attribute);
      else element.setAttribute(attribute, url.href);
    } catch {
      element.removeAttribute(attribute);
    }
  }
  pending = {
    token,
    article: {
      title: (article.title || document.title).slice(0, 1024),
      byline: (article.byline ?? '').slice(0, 512),
      fragment,
      dir: article.dir === 'rtl' ? 'rtl' : 'ltr',
    },
  };
  return true;
}

function close(): void {
  dialog?.close();
  host?.remove();
  host = null;
  dialog = null;
  if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
  previousFocus = null;
}
export function apply(token: string, labels: ReaderLabels): boolean {
  if (!pending || pending.token !== token) return false;
  const article = pending.article;
  pending = null;
  if (!article) {
    close();
    return true;
  }
  previousFocus = document.activeElement;
  host = document.createElement('div');
  host.dataset.yalqenReader = '';
  host.style.cssText =
    'all:initial !important;position:fixed !important;inset:0 !important;z-index:2147483647 !important;';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = new CSSStyleSheet();
  style.replaceSync(
    `:host{color-scheme:light dark}dialog{box-sizing:border-box;border:0;margin:0;padding:0;width:100vw;max-width:none;height:100vh;max-height:none;background:#faf8f3;color:#252525;font:20px/1.65 Georgia,serif;overflow:auto}dialog::backdrop{background:#faf8f3}.controls{position:sticky;top:0;display:flex;gap:8px;align-items:center;padding:12px 20px;background:inherit;border-bottom:1px solid #8885;font:14px system-ui;z-index:1}.controls span{flex:1}button{font:inherit;color:inherit;background:transparent;border:1px solid #8888;border-radius:6px;padding:6px 12px;cursor:pointer}button:focus-visible,a:focus-visible{outline:2px solid #2675dc;outline-offset:3px}main{box-sizing:border-box;max-width:760px;padding:32px 24px 80px;margin:auto;font-size:var(--reader-font-size,20px)}h1{font-size:1.8em;line-height:1.2}.byline{font:15px system-ui;color:#777}img{max-width:100%;height:auto}pre,table{max-width:100%;overflow:auto}pre{white-space:pre-wrap}blockquote{border-left:3px solid #8886;margin-left:0;padding-left:20px}a{color:#176cc7}@media(prefers-color-scheme:dark){dialog,dialog::backdrop{background:#202124;color:#e1e1e1}a{color:#82b4ef}.byline{color:#aaa}}`,
  );
  shadow.adoptedStyleSheets = [style];
  dialog = document.createElement('dialog');
  dialog.ariaLabel = labels.title;
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    close();
  });
  const controls = document.createElement('div');
  controls.className = 'controls';
  const label = document.createElement('span');
  label.textContent = labels.title;
  controls.append(label);
  const main = document.createElement('main');
  main.dir = article.dir;
  let fontSize = 20;
  const action = (label: string, run: () => void) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', (event) => {
      if (event.isTrusted) run();
    });
    controls.append(button);
    return button;
  };
  const smaller = action(labels.smaller, () => {
    fontSize = Math.max(16, fontSize - 2);
    main.style.setProperty('--reader-font-size', `${fontSize}px`);
    smaller.disabled = fontSize === 16;
    larger.disabled = false;
  });
  const larger = action(labels.larger, () => {
    fontSize = Math.min(32, fontSize + 2);
    main.style.setProperty('--reader-font-size', `${fontSize}px`);
    larger.disabled = fontSize === 32;
    smaller.disabled = false;
  });
  const exit = action(labels.close, close);
  const title = document.createElement('h1');
  title.textContent = article.title;
  main.append(title);
  if (article.byline) {
    const byline = document.createElement('p');
    byline.className = 'byline';
    byline.textContent = article.byline;
    main.append(byline);
  }
  main.append(article.fragment);
  dialog.append(controls, main);
  shadow.append(dialog);
  document.documentElement.append(host);
  dialog.showModal();
  exit.focus();
  return true;
}
