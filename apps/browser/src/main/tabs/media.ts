import { MediaSessionEvent, type MediaSkip } from '../../shared/sidebar-widgets.js';

export const MEDIA_WORLD_ID = 1030;

const FIND_MEDIA = `
  const media = [...document.querySelectorAll('video, audio')];
  const walker = document.createTreeWalker(document.documentElement ?? document, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.shadowRoot) media.push(...node.shadowRoot.querySelectorAll('video, audio'));
  }
  const audible = media.filter((item) => !item.muted && item.volume > 0);
  const pick = (list) =>
    list.find((item) => !item.paused) ??
    list.find((item) => item.currentTime > 0 && !item.ended) ??
    list.find((item) => item.currentTime > 0);
  const followed = globalThis.yalqenFollowedMedia?.deref();
  const main =
    audible.find((item) => !item.paused) ??
    (followed && audible.includes(followed) ? followed : undefined) ??
    pick(audible) ??
    pick(media) ??
    null;
  if (main) globalThis.yalqenFollowedMedia = new WeakRef(main);`;

export const MEDIA_READ_SCRIPT = `(() => {${FIND_MEDIA}
  const meta = navigator.mediaSession?.metadata ?? null;
  let actions = '';
  const answer = (event) => (actions = String(event.detail));
  window.addEventListener('${MediaSessionEvent.actions}', answer);
  window.dispatchEvent(new CustomEvent('${MediaSessionEvent.query}'));
  window.removeEventListener('${MediaSessionEvent.actions}', answer);
  return {
    actions,
    title: meta?.title ?? '',
    duration: main ? main.duration : null,
    position: main ? main.currentTime : null,
    paused: main ? main.paused : true,
  };
})()`;

export const MEDIA_TOGGLE_SCRIPT = `(() => {${FIND_MEDIA}
  if (main && !main.paused) {
    for (const item of media) if (!item.paused) item.pause();
    return;
  }
  const target = main ?? media[0];
  if (!target) return;
  if (target.ended) target.currentTime = 0;
  const started = target.play().catch(() => {});
  return Promise.race([started, new Promise((resolve) => setTimeout(resolve, 1000))]).then(() => undefined);
})()`;

export const PIP_ENTER_SCRIPT = `(() => {${FIND_MEDIA}
  const video = audible.find(
    (item) => item.tagName === 'VIDEO' && !item.paused && !item.ended && item.readyState > 1 && !item.disablePictureInPicture,
  );
  if (!video || !document.pictureInPictureEnabled || document.pictureInPictureElement) return false;
  return video.requestPictureInPicture().then(() => true, () => false);
})()`;

export const PIP_EXIT_SCRIPT = `(() => {
  if (document.pictureInPictureElement) return document.exitPictureInPicture().then(() => undefined, () => undefined);
})()`;

export interface PipTab {
  id: string;
  playingMedia: number;
  pip: boolean;
}

export function pipSwitch(
  enabled: boolean,
  previous: PipTab | undefined,
  next: PipTab,
): { enter: boolean; exit: boolean } {
  return {
    enter: enabled && !!previous && previous.id !== next.id && previous.playingMedia > 0 && !previous.pip,
    exit: next.pip,
  };
}

export function mediaSeekScript(seconds: number): string {
  return `(() => {${FIND_MEDIA}
  if (!main) return;
  const end = Number.isFinite(main.duration) ? main.duration : Infinity;
  main.currentTime = Math.min(end, Math.max(0, main.currentTime + ${seconds}));
})()`;
}

const SKIP_ACTION = { previous: 'previoustrack', next: 'nexttrack' } as const;

export function mediaSkipScript(direction: MediaSkip): string {
  return `window.dispatchEvent(new CustomEvent('${MediaSessionEvent.run}', { detail: '${SKIP_ACTION[direction]}' }))`;
}

export interface PageMedia {
  title: string;
  duration: number | null;
  position: number | null;
  paused: boolean;
  canPrevious: boolean;
  canNext: boolean;
}

const MAX_TEXT = 300;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '';
}

function seconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parsePageMedia(raw: unknown): PageMedia | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const actions = text(value.actions).split(',');
  return {
    title: text(value.title),
    duration: seconds(value.duration),
    position: seconds(value.position),
    paused: value.paused !== false,
    canPrevious: actions.includes(SKIP_ACTION.previous),
    canNext: actions.includes(SKIP_ACTION.next),
  };
}
