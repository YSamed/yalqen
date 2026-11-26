import { previewKind } from '../../shared/previews';
import type { AnchorRect, UiAction } from '../../shared/types';
import { interfaceTheme } from './tooltips';
import { anchorRect } from './anchor';

const DELAY_MS = 450;
const RETURN_MS = 600;

// The card opens beside the sidebar, not beside the hovered element: a tile in the pinned or favorites grid has
// other tiles to its right, and the top row sits under the window's buttons, so a card placed next to the tile
// covered both. Stretching the anchor to the sidebar's right edge keeps the card clear of the whole sidebar.
function sidebarAnchor(element: HTMLElement): AnchorRect {
  const anchor = anchorRect(element);
  const panel = element.closest('aside');
  if (!panel) return anchor;
  const right = panel.getBoundingClientRect().right;
  return right > anchor.x + anchor.width ? { ...anchor, width: right - anchor.x } : anchor;
}

export function createHoverPreviews(send: (action: UiAction) => void) {
  let timer: number | undefined;
  let requested: Element | null = null;
  let leftAt = 0;

  function request(element: HTMLElement, tabId: string | null, url: string): void {
    if (!element.isConnected) return;
    const anchor = sidebarAnchor(element);
    if (anchor.width === 0 || anchor.height === 0) return;
    requested = element;
    const align = element.classList.contains('favorite') ? 'top' : 'center';
    send({ type: 'show-preview', preview: { tabId, url, anchor, theme: interfaceTheme(), align } });
  }

  function enter(element: HTMLElement, tabId: string | null, url: string): void {
    window.clearTimeout(timer);
    timer = undefined;
    if (!tabId && !previewKind(url)) return;
    // Moving straight from one card's row to the next shows it at once instead of waiting again.
    if (requested && Date.now() - leftAt < RETURN_MS) request(element, tabId, url);
    else timer = window.setTimeout(() => request(element, tabId, url), DELAY_MS);
  }

  function leave(): void {
    window.clearTimeout(timer);
    timer = undefined;
    if (!requested) return;
    leftAt = Date.now();
    send({ type: 'leave-preview' });
  }

  function dismiss(): void {
    window.clearTimeout(timer);
    timer = undefined;
    if (!requested) return;
    requested = null;
    send({ type: 'hide-preview' });
  }

  return { enter, leave, dismiss, has: (url: string) => previewKind(url) !== null };
}
