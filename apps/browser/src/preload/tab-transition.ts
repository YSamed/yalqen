import { ipcRenderer } from 'electron';
import { PageChannel } from '../shared/types.js';

const DURATION_MS = 140;

export function setupTabTransition(): void {
  if (window !== window.top) return;
  let animation: Animation | null = null;
  const cancel = () => {
    animation?.cancel();
    animation = null;
  };
  // Set up lazily: most pages are never involved in an animated tab switch.
  let reducedMotion: MediaQueryList | null = null;
  ipcRenderer.on(PageChannel.tabTransition, (_event, startedAt: number | null) => {
    cancel();
    const root = document.documentElement;
    if (
      typeof startedAt !== 'number' ||
      Date.now() - startedAt > DURATION_MS ||
      document.readyState !== 'complete' ||
      document.hidden ||
      !root
    )
      return;
    if (!reducedMotion) {
      reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      reducedMotion.addEventListener('change', cancel);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) cancel();
      });
    }
    if (reducedMotion.matches) return;
    // Opacity only: translating the document would move fixed/sticky controls.
    // No fill mode or inline style changes; the site's own opacity returns automatically.
    const opacity = Number(getComputedStyle(root).opacity);
    const current = root.animate([{ opacity: opacity * 0.88 }, { opacity }], {
      id: 'yalqen-tab-transition',
      duration: DURATION_MS,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
    });
    animation = current;
    void current.finished.then(
      () => {
        if (animation === current) animation = null;
      },
      () => {
        /* Cancellation on another tab switch is expected. */
      },
    );
  });
  window.addEventListener('pagehide', cancel);
}
