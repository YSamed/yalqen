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
      () => {},
    );
  });
  window.addEventListener('pagehide', cancel);
}
