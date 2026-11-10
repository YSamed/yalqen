import { splitShortcut, type TooltipTheme } from '../../shared/tooltip';
import type { UiAction } from '../../shared/types';

const DELAY_MS = 500;
// Moving straight from one tooltip to the next shows it at once, as the system tooltip does.
const WARM_MS = 300;

// Native title tooltips cannot follow Yalqen's surface and accent colours, so the interface keeps writing
// plain title attributes and this takes them over: the title is held aside while hovered so the system
// tooltip never appears, and the main process draws the styled one above the page.
export function installTooltips(send: (action: UiAction) => void, root: Document = document): () => void {
  let target: HTMLElement | null = null;
  let title = '';
  let timer: number | undefined;
  let shown = false;
  let lastHidden = 0;

  function theme(): TooltipTheme {
    const style = getComputedStyle(root.documentElement);
    const token = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
    return {
      dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
      surface: token('--surface-menu', token('--surface-strong', '#f7f7f8')),
      text: token('--text', '#1a1b1e'),
      accent: token('--accent', '#0a84ff'),
      border: token('--border', 'rgb(16 18 24 / 0.12)'),
    };
  }

  function show(): void {
    if (!target?.isConnected) return;
    const { text, keys } = splitShortcut(title);
    if (!text) return;
    const rect = target.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    shown = true;
    send({
      type: 'show-tooltip',
      tooltip: { text, keys, anchor: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, theme: theme() },
    });
  }

  function release(): void {
    window.clearTimeout(timer);
    timer = undefined;
    if (target && !target.hasAttribute('title') && title) target.setAttribute('title', title);
    target = null;
    title = '';
    if (shown) {
      shown = false;
      lastHidden = Date.now();
      send({ type: 'hide-tooltip' });
    }
  }

  function over(event: PointerEvent): void {
    const element = (event.target as Element | null)?.closest?.<HTMLElement>('[title]');
    if (!element || element === target) return;
    const value = element.getAttribute('title') ?? '';
    release();
    if (!value.trim()) return;
    target = element;
    title = value;
    element.removeAttribute('title');
    if (Date.now() - lastHidden < WARM_MS) show();
    else timer = window.setTimeout(show, DELAY_MS);
  }

  function out(event: PointerEvent): void {
    if (!target) return;
    const next = event.relatedTarget as Node | null;
    if (next && target.contains(next)) return;
    release();
  }

  // Pressing, scrolling or typing means the user has moved on from reading the tooltip.
  const dismiss = () => {
    if (!target) return;
    release();
    lastHidden = 0;
  };

  const listeners: [string, EventListener][] = [
    ['pointerover', over as EventListener],
    ['pointerout', out as EventListener],
    ['pointerdown', dismiss],
    ['wheel', dismiss],
    ['keydown', dismiss],
  ];
  for (const [name, listener] of listeners) root.addEventListener(name, listener, true);
  window.addEventListener('blur', dismiss);
  return () => {
    release();
    for (const [name, listener] of listeners) root.removeEventListener(name, listener, true);
    window.removeEventListener('blur', dismiss);
  };
}
