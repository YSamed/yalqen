import { type BaseWindow, type Rectangle, type WebContentsView } from 'electron';
import { createOverlayView } from './overlay-view.js';

export type HistoryDirection = 'back' | 'forward';

const SIZE = 72;
const EDGE_INSET = 8;
const VISIBLE_MS = 750;

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<style>
  :root { color-scheme: light dark; --chip: rgb(255 255 255 / 0.94); --ink: #1a1b1e; --rim: rgb(16 18 24 / 0.1); }
  @media (prefers-color-scheme: dark) { :root { --chip: rgb(38 40 45 / 0.94); --ink: #f2f3f5; --rim: rgb(255 255 255 / 0.14); } }
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
  body { display: grid; place-items: center; }
  .chip {
    width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center;
    background: var(--chip); color: var(--ink);
    box-shadow: 0 0 0 1px var(--rim), 0 6px 18px rgb(0 0 0 / 0.22);
    opacity: 0;
  }
  svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
  .chip.back { --from: -18px; }
  .chip.forward { --from: 18px; }
  .chip.forward svg { transform: scaleX(-1); }
  .chip.play { animation: hint ${VISIBLE_MS}ms cubic-bezier(0.22, 1, 0.36, 1) both; }
  @keyframes hint {
    0% { opacity: 0; transform: translateX(var(--from)) scale(0.8); }
    22% { opacity: 1; transform: translateX(0) scale(1); }
    70% { opacity: 1; transform: translateX(0) scale(1); }
    100% { opacity: 0; transform: translateX(0) scale(0.94); }
  }
  @media (prefers-reduced-motion: reduce) {
    .chip.play { animation-name: fade; }
    @keyframes fade { 0%, 100% { opacity: 0; } 15%, 70% { opacity: 1; } }
  }
</style>
</head>
<body>
<div class="chip" id="chip"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></div>
<script>
  const chip = document.getElementById('chip');
  window.show = (direction) => {
    chip.className = 'chip ' + direction;
    void chip.offsetWidth;
    chip.classList.add('play');
  };
</script>
</body>
</html>`;

export interface NavigationHintHost {
  window: BaseWindow;
  area: () => Rectangle;
}

export class NavigationHint {
  private view: WebContentsView | null = null;
  private loaded: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private shown = false;

  constructor(private readonly host: NavigationHintHost) {}

  show(direction: HistoryDirection): void {
    const { window } = this.host;
    if (window.isDestroyed()) return;
    const view = this.ensureView();
    const area = this.host.area();
    const x = direction === 'back' ? area.x + EDGE_INSET : area.x + area.width - SIZE - EDGE_INSET;
    view.setBounds({ x, y: Math.round(area.y + (area.height - SIZE) / 2), width: SIZE, height: SIZE });
    window.contentView.addChildView(view);
    this.shown = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), VISIBLE_MS + 50);
    void this.loaded.then(() => {
      if (this.shown && this.view === view && !view.webContents.isDestroyed()) {
        void view.webContents.executeJavaScript(`window.show(${JSON.stringify(direction)})`).catch(() => {});
      }
    });
  }

  destroy(): void {
    this.hide();
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
  }

  private hide(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.shown || !this.view) return;
    this.shown = false;
    if (!this.host.window.isDestroyed()) this.host.window.contentView.removeChildView(this.view);
  }

  private ensureView(): WebContentsView {
    if (this.view) return this.view;
    const view = createOverlayView();
    this.view = view;
    this.loaded = view.webContents
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`)
      .catch((error: unknown) => {
        console.warn('[navigation-hint] could not load the hint:', error);
      });
    return view;
  }
}
