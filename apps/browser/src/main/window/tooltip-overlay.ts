import type { BaseWindow, WebContentsView } from 'electron';
import {
  placeTooltip,
  TOOLTIP_PAD as PAD,
  TOOLTIP_SHADOW as SHADOW,
  type TooltipRequest,
  type TooltipSize,
} from '../../shared/tooltip.js';
import { createOverlayView, raiseToTop } from './overlay-view.js';

const MAX_WIDTH = 380;
const MAX_HEIGHT = 64;

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<style>
  :root {
    color-scheme: light;
    --surface: #f7f7f8; --text: #1a1b1e; --accent: #0a84ff; --border: rgb(16 18 24 / 0.12);
    --drop: rgb(16 18 24 / 0.14);
  }
  :root.dark { color-scheme: dark; --drop: rgb(0 0 0 / 0.42); }
  html, body { margin: 0; background: transparent; overflow: hidden; }
  body { display: inline-block; padding: ${PAD}px; }
  .tip {
    display: flex; align-items: center; gap: 10px;
    max-width: ${MAX_WIDTH - PAD * 2}px; box-sizing: border-box;
    padding: 5px 10px; border-radius: 9px;
    background: var(--surface); color: var(--text);
    box-shadow: 0 0 0 0.5px var(--border), 0 ${SHADOW.y}px ${SHADOW.blur}px var(--drop);
    font: 500 12px/16px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', 'Helvetica Neue', sans-serif;
    white-space: nowrap; user-select: none; cursor: default;
    opacity: 0; transform: translateY(-2px);
  }
  .tip.keyed { padding-right: 5px; }
  .tip.on { opacity: 1; transform: none; transition: opacity 90ms ease-out, transform 140ms cubic-bezier(0.23, 1, 0.32, 1); }
  .text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .keys { display: flex; flex: none; gap: 3px; }
  .keys:empty { display: none; }
  kbd {
    display: grid; place-items: center; box-sizing: border-box;
    min-width: 18px; height: 18px; padding: 0 4px; border-radius: 5px;
    font-family: inherit; font-size: 11px; font-weight: 600; line-height: 1;
    background: color-mix(in srgb, var(--accent) 14%, var(--surface));
    color: color-mix(in srgb, var(--accent) 72%, var(--text));
    box-shadow: inset 0 0 0 0.5px color-mix(in srgb, var(--accent) 38%, transparent),
      0 1px 0 color-mix(in srgb, var(--accent) 22%, transparent);
  }
  @media (prefers-reduced-motion: reduce) { .tip, .tip.on { transform: none; transition: none; } }
</style>
</head>
<body>
<div class="tip" id="tip"><span class="text" id="text"></span><span class="keys" id="keys"></span></div>
<script>
  const root = document.documentElement;
  const tip = document.getElementById('tip');
  const text = document.getElementById('text');
  const keys = document.getElementById('keys');
  window.show = ({ text: label, keys: caps, theme }) => {
    tip.classList.remove('on');
    root.classList.toggle('dark', theme.dark);
    for (const name of ['surface', 'text', 'accent', 'border']) {
      if (CSS.supports('color', theme[name])) root.style.setProperty('--' + name, theme[name]);
    }
    text.textContent = label;
    keys.replaceChildren(...caps.map((cap) => Object.assign(document.createElement('kbd'), { textContent: cap })));
    tip.classList.toggle('keyed', caps.length > 0);
    const rect = document.body.getBoundingClientRect();
    return { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  };
  window.reveal = () => requestAnimationFrame(() => tip.classList.add('on'));
</script>
</body>
</html>`;

// The interface view sits beneath web pages, so a tooltip drawn there would be hidden by the page under
// the toolbar; this overlay floats above everything instead, like the native tooltip it replaces.
export class TooltipOverlay {
  private view: WebContentsView | null = null;
  private loaded: Promise<void> = Promise.resolve();
  private shown = false;
  private sequence = 0;

  constructor(private readonly window: BaseWindow) {}

  show(request: TooltipRequest): void {
    if (this.window.isDestroyed()) return;
    const view = this.ensureView();
    const id = ++this.sequence;
    const area = this.window.getContentBounds();
    // Laid out at full size while invisible, then shrunk to the measured tooltip.
    view.setBounds({
      x: Math.max(0, Math.round(request.anchor.x)),
      y: Math.round(request.anchor.y + request.anchor.height),
      width: MAX_WIDTH,
      height: MAX_HEIGHT,
    });
    raiseToTop(this.window, view);
    this.shown = true;
    void this.loaded
      .then(async () => {
        if (id !== this.sequence || view.webContents.isDestroyed()) return;
        const size = (await view.webContents.executeJavaScript(
          `window.show(${JSON.stringify(request)})`,
        )) as TooltipSize;
        if (id !== this.sequence || this.window.isDestroyed()) return;
        const inner = { width: size.width - PAD * 2, height: size.height - PAD * 2 };
        const { x, y } = placeTooltip(request.anchor, inner, area);
        view.setBounds({ x: x - PAD, y: y - PAD, width: size.width, height: size.height });
        await view.webContents.executeJavaScript('window.reveal()');
      })
      .catch(() => {});
  }

  hide(): void {
    this.sequence++;
    if (!this.shown || !this.view) return;
    this.shown = false;
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.view);
  }

  destroy(): void {
    this.hide();
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view;
    const view = createOverlayView();
    this.view = view;
    this.loaded = view.webContents
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`)
      .catch((error: unknown) => {
        console.warn('[tooltip] could not load the tooltip:', error);
      });
    return view;
  }
}
