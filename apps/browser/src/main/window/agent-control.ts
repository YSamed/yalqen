import { WebContentsView, type BaseWindow, type Rectangle } from 'electron';
import { createOverlayView, raiseToTop } from './overlay-view.js';

const EDGE = 3;
const BANNER_WIDTH = 260;
const BANNER_HEIGHT = 40;
const COLOR = '#f28c28';
// The banner has no preload; its Stop button asks to open this address, which is never loaded.
const STOP_URL = 'https://stop.yalqen.invalid/';

function bannerPage(label: string, stop: string): string {
  return `<!doctype html>
<html>
<head>
<meta charset="UTF-8">
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
  body { display: flex; justify-content: center; align-items: flex-start; font: 12px/1 -apple-system, system-ui, sans-serif; }
  .bar {
    display: flex; align-items: center; gap: 10px; padding: 6px 6px 6px 12px;
    border-radius: 0 0 10px 10px; background: ${COLOR}; color: #fff; font-weight: 600;
    box-shadow: 0 4px 12px rgb(0 0 0 / 0.18);
  }
  button {
    border: 0; border-radius: 6px; padding: 5px 10px; font: inherit; cursor: pointer;
    background: rgb(255 255 255 / 0.92); color: #1a1b1e;
  }
  button:hover { background: #fff; }
</style>
</head>
<body>
<div class="bar" role="status"><span id="label"></span><button id="stop" type="button"></button></div>
<script>
  document.getElementById('label').textContent = ${JSON.stringify(label)};
  const stop = document.getElementById('stop');
  stop.textContent = ${JSON.stringify(stop)};
  stop.addEventListener('click', () => { location.href = ${JSON.stringify(STOP_URL)}; });
</script>
</body>
</html>`;
}

function strip(): WebContentsView {
  const view = new WebContentsView();
  view.setBackgroundColor(COLOR);
  return view;
}

export interface AgentControlHost {
  window: BaseWindow;
  area: () => Rectangle;
  labels: () => { inControl: string; stop: string };
}

export class AgentControl {
  private views: { banner: WebContentsView; edges: WebContentsView[] } | null = null;
  private onStop: (() => void) | null = null;

  constructor(private readonly host: AgentControlHost) {}

  get active(): boolean {
    return this.onStop !== null;
  }

  show(onStop: () => void): void {
    if (this.host.window.isDestroyed()) return;
    this.onStop = onStop;
    const views = this.ensureViews();
    for (const view of [...views.edges, views.banner]) raiseToTop(this.host.window, view);
    this.layout();
  }

  hide(): void {
    this.onStop = null;
    if (!this.views || this.host.window.isDestroyed()) return;
    for (const view of [...this.views.edges, this.views.banner]) this.host.window.contentView.removeChildView(view);
  }

  layout(): void {
    if (!this.views || !this.onStop) return;
    const { x, y, width, height } = this.host.area();
    const [top, right, bottom, left] = this.views.edges;
    top.setBounds({ x, y, width, height: EDGE });
    bottom.setBounds({ x, y: y + height - EDGE, width, height: EDGE });
    left.setBounds({ x, y, width: EDGE, height });
    right.setBounds({ x: x + width - EDGE, y, width: EDGE, height });
    const bannerWidth = Math.min(BANNER_WIDTH, width);
    this.views.banner.setBounds({
      x: Math.round(x + (width - bannerWidth) / 2),
      y,
      width: bannerWidth,
      height: BANNER_HEIGHT,
    });
  }

  destroy(): void {
    this.hide();
    for (const view of this.views ? [...this.views.edges, this.views.banner] : []) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    this.views = null;
  }

  private ensureViews(): { banner: WebContentsView; edges: WebContentsView[] } {
    if (this.views) return this.views;
    const banner = createOverlayView();
    banner.webContents.on('will-navigate', (_event, url) => {
      if (url === STOP_URL) this.onStop?.();
    });
    const { inControl, stop } = this.host.labels();
    void banner.webContents
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(bannerPage(inControl, stop))}`)
      .catch((error: unknown) => console.warn('[agent-control] could not load the banner:', error));
    this.views = { banner, edges: [strip(), strip(), strip(), strip()] };
    return this.views;
  }
}
