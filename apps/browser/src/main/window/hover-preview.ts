import type { BaseWindow, WebContentsView } from 'electron';
import { placePreview, type PreviewSize, type PreviewView } from '../../shared/previews.js';
import type { AnchorRect } from '../../shared/types.js';
import type { TooltipTheme } from '../../shared/tooltip.js';
import { createOverlayView, raiseToTop } from './overlay-view.js';

// Room around the card for its shadow; the view is this much larger than the card on every side.
const PAD = 14;
const CARD_WIDTH = 300;
const MAX_HEIGHT = 360;
// Long enough to move the pointer from the tile across the gap onto the card.
const LEAVE_ANCHOR_MS = 300;
const LEAVE_CARD_MS = 250;

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
    box-shadow: 0 0 0 0.5px var(--border), 0 10px 30px var(--drop);
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
  @media (prefers-reduced-motion: reduce) { .card, .card.on { transform: none; transition: none; } }
</style>
</head>
<body>
<div class="card" id="card">
  <div class="heading" id="heading"></div>
  <div class="items" id="items"></div>
  <div class="message" id="message"></div>
  <div class="footer" id="footer"></div>
</div>
<script>
  const root = document.documentElement;
  const card = document.getElementById('card');
  const node = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text });
  // The overlay has no channel to the browser; it reports through its title, which the browser watches.
  let count = 0;
  const report = (event) => { document.title = event + ':' + count++; };
  card.addEventListener('mouseenter', () => report('enter'));
  card.addEventListener('mouseleave', () => report('leave'));
  card.addEventListener('click', (event) => {
    const item = event.target.closest('.item');
    report(item ? 'open-' + item.dataset.index : 'open-tab');
  });
  window.show = (view, theme) => {
    card.classList.remove('on');
    root.classList.toggle('dark', theme.dark);
    for (const name of ['surface', 'text', 'accent', 'border']) {
      if (CSS.supports('color', theme[name])) root.style.setProperty('--' + name, theme[name]);
    }
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

// What a click in the preview asks for: one of its items, or the tab it came from.
export type PreviewChoice = number | 'tab';

// Floats above the page like the tooltip overlay, since previews open beside the sidebar over the page. It
// stays while the pointer moves from the tile onto it, so its mail and events can be clicked.
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

  // Each hover takes a ticket; a read that finishes after the pointer left, or after another hover, is dropped.
  begin(): number {
    this.cancelHide();
    return ++this.sequence;
  }

  isCurrent(ticket: number): boolean {
    return ticket === this.sequence;
  }

  // The same tile hovered again while its preview is up keeps it instead of reading again.
  isShowing(key: string): boolean {
    return this.shown && this.key === key;
  }

  keep(): void {
    this.cancelHide();
  }

  // The pointer left the tile; the preview waits for it to arrive on the card.
  release(): void {
    if (!this.onCard) this.hideAfter(LEAVE_ANCHOR_MS);
  }

  show(ticket: number, key: string, view: PreviewView, anchor: AnchorRect, theme: TooltipTheme): void {
    if (ticket !== this.sequence || this.window.isDestroyed()) return;
    this.key = key;
    this.onCard = false;
    const overlay = this.ensureView();
    const area = this.window.getContentBounds();
    // Laid out at full size while invisible, then shrunk to the measured card.
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
        const { x, y } = placePreview(anchor, inner, area);
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
    const event = /^([a-z]+)(?:-(\d+|tab))?:\d+$/.exec(title);
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
