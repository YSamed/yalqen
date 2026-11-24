import type { BaseWindow, WebContentsView } from 'electron';
import {
  placePreview,
  PREVIEW_PAD as PAD,
  PREVIEW_SHADOW as SHADOW,
  type PreviewSize,
  type PreviewView,
  type TabAction,
} from '../../shared/previews.js';
import type { AnchorRect } from '../../shared/types.js';
import type { TooltipTheme } from '../../shared/tooltip.js';
import { createOverlayView, raiseToTop } from './overlay-view.js';

const CARD_WIDTH = 300;
const MAX_HEIGHT = 360;
const LEAVE_ANCHOR_MS = 300;
const LEAVE_CARD_MS = 250;

const ACTION_ICONS: Record<TabAction, string> = {
  pin: 'M6 2.5h4M6.5 2.5v4L4.5 9h7l-2-2.5v-4M8 9v4.5',
  bookmark: 'M4.5 2.5h7v11L8 11l-3.5 2.5z',
  split: 'M2.5 3.5h11v9h-11zM8 3.5v9',
  copy: 'M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5l-.8.8M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5l.8-.8',
};

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<style>
  :root {
    color-scheme: light;
    --surface: #f7f7f8; --text: #1a1b1e; --accent: #0a84ff; --border: rgb(16 18 24 / 0.12);
    --drop: rgb(16 18 24 / 0.16);
  }
  :root.dark { color-scheme: dark; --drop: rgb(0 0 0 / 0.45); }
  html, body { margin: 0; background: transparent; overflow: hidden; }
  body { display: inline-block; padding: ${PAD}px; }
  .card {
    box-sizing: border-box; width: ${CARD_WIDTH}px; padding: 6px; border-radius: 14px;
    background: var(--surface); color: var(--text);
    box-shadow: 0 0 0 0.5px var(--border), 0 ${SHADOW.y}px ${SHADOW.blur}px var(--drop);
    font: 13px/1.3 -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Helvetica Neue', sans-serif;
    user-select: none; cursor: default;
    opacity: 0; transform: translateY(-2px) scale(0.985); transform-origin: top left;
  }
  .card.on { opacity: 1; transform: none; transition: opacity 110ms ease-out, transform 160ms cubic-bezier(0.23, 1, 0.32, 1); }
  .heading {
    display: flex; align-items: center; gap: 6px; padding: 6px 8px 4px;
    color: color-mix(in srgb, var(--text) 62%, transparent); font-size: 11px; font-weight: 600;
  }
  .heading::before { content: ''; width: 6px; height: 6px; border-radius: 50%; background: var(--accent); }
  .heading:empty { display: none; }
  .item {
    display: grid; grid-template-columns: 1fr auto; column-gap: 10px; row-gap: 1px;
    padding: 7px 8px; border-radius: 9px;
  }
  .item + .item { margin-top: 1px; }
  .item, .heading, .footer, .message { cursor: pointer; }
  .item:hover { background: color-mix(in srgb, var(--text) 7%, transparent); }
  .item.live:hover { background: color-mix(in srgb, var(--accent) 16%, transparent); }
  .heading:hover, .footer:hover { text-decoration: underline; }
  .item.live { background: color-mix(in srgb, var(--accent) 10%, transparent); box-shadow: inset 3px 0 0 var(--accent); }
  .primary, .secondary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .primary { font-weight: 600; }
  .secondary { grid-column: 1 / -1; color: color-mix(in srgb, var(--text) 66%, transparent); font-size: 12px; }
  .meta { color: color-mix(in srgb, var(--text) 55%, transparent); font-size: 11px; font-variant-numeric: tabular-nums; }
  .item.live .meta { color: var(--accent); font-weight: 600; }
  .message {
    padding: 14px 12px; text-align: center; text-wrap: balance;
    color: color-mix(in srgb, var(--text) 75%, transparent);
  }
  .footer { padding: 4px 8px 4px; color: var(--accent); font-size: 11.5px; font-weight: 600; }
  .message:empty, .footer:empty, .items:empty { display: none; }
  .card.tab-only { width: 170px; padding: 11px 9px 4px; }
  .tab { padding: 0 5px; }
  .card:not(.tab-only) .tab { padding: 6px 8px 4px; }
  .tab[hidden], .actions:empty { display: none; }
  .tab-title, .tab-host { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; line-height: 18px; font-size: 14px; }
  .tab-title { font-weight: 600; }
  .tab-host { margin-top: 3px; color: color-mix(in srgb, var(--text) 55%, transparent); }
  .actions { display: flex; justify-content: space-between; margin-top: 8px; }
  .act {
    display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px;
    background: transparent; color: color-mix(in srgb, var(--text) 62%, transparent); cursor: pointer;
  }
  .act:hover:not(:disabled) { background: color-mix(in srgb, var(--text) 8%, transparent); color: var(--text); }
  .act:disabled { opacity: 0.35; cursor: default; }
  .act.on { color: var(--text); }
  .act.on.fill svg { fill: currentColor; }
  .act svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; }
  @media (prefers-reduced-motion: reduce) { .card, .card.on { transform: none; transition: none; } }
</style>
</head>
<body>
<div class="card" id="card">
  <div class="tab" id="tab" hidden><div class="tab-title" id="tab-title"></div><div class="tab-host" id="tab-host"></div></div>
  <div class="heading" id="heading"></div>
  <div class="items" id="items"></div>
  <div class="message" id="message"></div>
  <div class="footer" id="footer"></div>
  <div class="actions" id="actions"></div>
</div>
<script>
  const root = document.documentElement;
  const card = document.getElementById('card');
  const node = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text });
  let count = 0;
  const report = (event) => { document.title = event + ':' + count++; };
  card.addEventListener('mouseenter', () => report('enter'));
  card.addEventListener('mouseleave', () => report('leave'));
  const icons = ${JSON.stringify(ACTION_ICONS)};
  card.addEventListener('click', (event) => {
    const act = event.target.closest('[data-act]');
    if (act) {
      if (!act.disabled) report('act-' + act.dataset.act);
      return;
    }
    const item = event.target.closest('.item');
    report(item ? 'open-' + item.dataset.index : 'open-tab');
  });
  window.show = (view, theme) => {
    card.classList.remove('on');
    root.classList.toggle('dark', theme.dark);
    for (const name of ['surface', 'text', 'accent', 'border']) {
      if (CSS.supports('color', theme[name])) root.style.setProperty('--' + name, theme[name]);
    }
    const tab = view.tab;
    card.classList.toggle('tab-only', Boolean(tab) && view.items.length === 0 && !view.message);
    document.getElementById('tab').hidden = !tab;
    document.getElementById('tab-title').textContent = tab ? tab.title : '';
    document.getElementById('tab-host').textContent = tab ? tab.host : '';
    document.getElementById('actions').replaceChildren(
      ...(tab ? tab.actions : []).map((action) => {
        const button = node('button', 'act' + (action.on ? ' on' : '') + (action.id === 'pin' || action.id === 'bookmark' ? ' fill' : ''), '');
        button.type = 'button';
        button.dataset.act = action.id;
        button.disabled = !action.enabled;
        button.title = action.label;
        button.setAttribute('aria-label', action.label);
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 16 16');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', icons[action.id]);
        svg.append(path);
        button.append(svg);
        return button;
      }),
    );
    document.getElementById('heading').textContent = view.heading || '';
    document.getElementById('message').textContent = view.message || '';
    document.getElementById('footer').textContent = view.footer || '';
    document.getElementById('items').replaceChildren(
      ...view.items.map((item, index) => {
        const row = node('div', item.live ? 'item live' : 'item', '');
        row.dataset.index = String(index);
        row.append(node('span', 'primary', item.primary), node('span', 'meta', item.meta), node('span', 'secondary', item.secondary));
        return row;
      }),
    );
    const rect = document.body.getBoundingClientRect();
    return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  };
  window.reveal = () => requestAnimationFrame(() => card.classList.add('on'));
</script>
</body>
</html>`;

export type PreviewChoice = number | 'tab' | TabAction;

export class HoverPreview {
  private view: WebContentsView | null = null;
  private loaded: Promise<void> = Promise.resolve();
  private shown = false;
  private sequence = 0;
  private key: string | null = null;
  private onCard = false;
  private hideTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly window: BaseWindow,
    private readonly onChoose: (choice: PreviewChoice) => void,
  ) {}

  begin(): number {
    this.cancelHide();
    return ++this.sequence;
  }

  isCurrent(ticket: number): boolean {
    return ticket === this.sequence;
  }

  isShowing(key: string): boolean {
    return this.shown && this.key === key;
  }

  keep(): void {
    this.cancelHide();
  }

  release(): void {
    if (!this.onCard) this.hideAfter(LEAVE_ANCHOR_MS);
  }

  show(ticket: number, key: string, view: PreviewView, anchor: AnchorRect, theme: TooltipTheme): void {
    if (ticket !== this.sequence || this.window.isDestroyed()) return;
    this.key = key;
    this.onCard = false;
    const overlay = this.ensureView();
    const area = this.window.getContentBounds();
    overlay.setBounds({ x: -10000, y: 0, width: CARD_WIDTH + PAD * 2, height: MAX_HEIGHT });
    raiseToTop(this.window, overlay);
    this.shown = true;
    void this.loaded
      .then(async () => {
        if (ticket !== this.sequence || overlay.webContents.isDestroyed()) return;
        const size = (await overlay.webContents.executeJavaScript(
          `window.show(${JSON.stringify(view)}, ${JSON.stringify(theme)})`,
        )) as PreviewSize;
        if (ticket !== this.sequence || this.window.isDestroyed()) return;
        const inner = { width: size.width - PAD * 2, height: Math.min(size.height, MAX_HEIGHT) - PAD * 2 };
        const { x, y } = placePreview(anchor, inner, area, view.tab !== undefined);
        overlay.setBounds({ x: x - PAD, y: y - PAD, width: size.width, height: Math.min(size.height, MAX_HEIGHT) });
        await overlay.webContents.executeJavaScript('window.reveal()');
      })
      .catch(() => {});
  }

  hide(): void {
    this.sequence++;
    this.cancelHide();
    this.key = null;
    this.onCard = false;
    if (!this.shown || !this.view) return;
    this.shown = false;
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.view);
  }

  destroy(): void {
    this.hide();
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
  }

  private hideAfter(ms: number): void {
    this.cancelHide();
    this.hideTimer = setTimeout(() => this.hide(), ms);
  }

  private cancelHide(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
    this.hideTimer = null;
  }

  private report(title: string): void {
    const event = /^([a-z]+)(?:-(\d+|tab|pin|bookmark|split|copy))?:\d+$/.exec(title);
    if (!event || !this.shown) return;
    if (event[1] === 'enter') {
      this.onCard = true;
      this.cancelHide();
    } else if (event[1] === 'leave') {
      this.onCard = false;
      this.hideAfter(LEAVE_CARD_MS);
    } else if (event[1] === 'open' && event[2]) {
      const choice: PreviewChoice = event[2] === 'tab' ? 'tab' : Number(event[2]);
      this.hide();
      this.onChoose(choice);
    } else if (event[1] === 'act' && event[2]) {
      this.hide();
      this.onChoose(event[2] as TabAction);
    }
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view;
    const view = createOverlayView();
    this.view = view;
    view.webContents.on('page-title-updated', (_event, title) => this.report(title));
    this.loaded = view.webContents
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`)
      .catch((error: unknown) => {
        console.warn('[hover-preview] could not load the preview:', error);
      });
    return view;
  }
}
