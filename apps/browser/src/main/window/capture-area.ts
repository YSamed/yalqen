import type { Rectangle } from 'electron';

export const CAPTURE_AREA_WORLD_ID = 1060;
const MIN_EDGE = 4;

export const CAPTURE_AREA_SCRIPT = `new Promise((resolve) => {
  const layer = document.createElement('div');
  const box = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;background:rgba(0,0,0,.25)';
  box.style.cssText = 'position:fixed;display:none;pointer-events:none;outline:1px solid #fff;box-shadow:0 0 0 100vmax rgba(0,0,0,.35)';
  layer.append(box);
  document.documentElement.append(layer);
  let start = null;
  const area = (event) => ({
    x: Math.min(start.x, event.clientX),
    y: Math.min(start.y, event.clientY),
    width: Math.abs(event.clientX - start.x),
    height: Math.abs(event.clientY - start.y),
  });
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    finish(null);
  };
  const finish = (rect) => {
    removeEventListener('keydown', onKey, true);
    layer.remove();
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(rect)));
  };
  addEventListener('keydown', onKey, true);
  layer.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return finish(null);
    event.preventDefault();
    start = { x: event.clientX, y: event.clientY };
    layer.setPointerCapture(event.pointerId);
    layer.style.background = 'transparent';
  });
  layer.addEventListener('pointermove', (event) => {
    if (!start) return;
    const rect = area(event);
    Object.assign(box.style, {
      display: 'block',
      left: rect.x + 'px',
      top: rect.y + 'px',
      width: rect.width + 'px',
      height: rect.height + 'px',
    });
  });
  layer.addEventListener('pointerup', (event) => {
    if (start) finish(area(event));
  });
})`;

export function captureRect(value: unknown, zoom: number): Rectangle | null {
  if (!value || typeof value !== 'object' || !(zoom > 0)) return null;
  const { x, y, width, height } = value as Record<string, unknown>;
  const numbers = [x, y, width, height];
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const [left, top, w, h] = numbers as number[];
  if (left < 0 || top < 0 || w < MIN_EDGE || h < MIN_EDGE) return null;
  return {
    x: Math.round(left * zoom),
    y: Math.round(top * zoom),
    width: Math.round(w * zoom),
    height: Math.round(h * zoom),
  };
}
