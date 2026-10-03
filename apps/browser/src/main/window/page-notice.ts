import { type BaseWindow, type Rectangle, type WebContentsView } from 'electron';
import { createOverlayView } from './overlay-view.js';

const WIDTH = 460;
const HEIGHT = 76;
const TOP_INSET = 12;
const VISIBLE_MS = 2600;

const PAGE = `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<style>
  :root { color-scheme: light dark; --chip: rgb(255 255 255 / 0.96); --ink: #1a1b1e; --muted: #5d6068; --rim: rgb(16 18 24 / 0.1); }
  @media (prefers-color-scheme: dark) { :root { --chip: rgb(38 40 45 / 0.96); --ink: #f2f3f5; --muted: #a9adb5; --rim: rgb(255 255 255 / 0.14); } }
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
  body { display: flex; justify-content: center; align-items: flex-start; padding-top: 4px; font: 13px/1.4 -apple-system, system-ui, sans-serif; }
  .chip {
    max-width: calc(100% - 24px); padding: 8px 14px; border-radius: 12px;
    background: var(--chip); color: var(--ink);
    box-shadow: 0 0 0 1px var(--rim), 0 6px 18px rgb(0 0 0 / 0.2);
    opacity: 0;
  }
  .line { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .line + .line { color: var(--muted); font-size: 12px; }
  .chip.play { animation: notice ${VISIBLE_MS}ms ease-out both; }
  @keyframes notice {
    0% { opacity: 0; transform: translateY(-6px); }
    8%, 85% { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .chip.play { animation-name: fade; }
    @keyframes fade { 0%, 100% { opacity: 0; } 8%, 85% { opacity: 1; } }
  }
</style>
</head>
<body>
<div class="chip" id="chip" role="status"></div>
<script>
  const chip = document.getElementById('chip');
  window.show = (lines) => {
    chip.replaceChildren(...lines.map((text) => {
      const line = document.createElement('div');
      line.className = 'line';
      line.textContent = text;
      return line;
    }));
    chip.classList.remove('play');
    void chip.offsetWidth;
    chip.classList.add('play');
  };
</script>
</body>
</html>`;

export interface PageNoticeHost {
  window: BaseWindow;
  area: () => Rectangle;
}

export class PageNotice {
  private view: WebContentsView | null = null;
  private loaded: Promise<void> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private shown = false;

  constructor(private readonly host: PageNoticeHost) {}

  show(lines: string[]): void {
    const { window } = this.host;
    if (window.isDestroyed()) return;
    const view = this.ensureView();
    const area = this.host.area();
    const width = Math.min(WIDTH, area.width);
    view.setBounds({ x: Math.round(area.x + (area.width - width) / 2), y: area.y + TOP_INSET, width, height: HEIGHT });
    window.contentView.addChildView(view);
    this.shown = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.hide(), VISIBLE_MS + 50);
    void this.loaded.then(() => {
      if (this.shown && this.view === view && !view.webContents.isDestroyed()) {
        void view.webContents.executeJavaScript(`window.show(${JSON.stringify(lines)})`).catch(() => {});
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
        console.warn('[page-notice] could not load the notice:', error);
      });
    return view;
  }
}
