export const MEDIA_WORLD_ID = 1030;

// Finds the page's media elements, including those inside open shadow roots, and picks the one
// the player follows: sound-making media first, so a muted preview or ad loop does not take over.
// Between runs the isolated world remembers that element, so the player keeps it after a pause or
// a seek back to the start.
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

// Reads the page's Media Session metadata and the element that plays or played last.
export const MEDIA_READ_SCRIPT = `(() => {${FIND_MEDIA}
  const meta = navigator.mediaSession?.metadata ?? null;
  return {
    title: meta?.title ?? '',
    artist: meta?.artist ?? '',
    artwork: [...(meta?.artwork ?? [])].map((image) => ({ src: image.src, sizes: image.sizes ?? '' })),
    duration: main ? main.duration : null,
    position: main ? main.currentTime : null,
    paused: main ? main.paused : true,
  };
})()`;

// Mirrors the button the player shows for the followed element: pauses everything that plays, or
// resumes that element. It settles once playback has started, so the next read shows the new state.
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

export function mediaSeekScript(seconds: number): string {
  return `(() => {${FIND_MEDIA}
  if (!main) return;
  const end = Number.isFinite(main.duration) ? main.duration : Infinity;
  main.currentTime = Math.min(end, Math.max(0, main.currentTime + ${seconds}));
})()`;
}

export interface PageMedia {
  title: string;
  artist: string;
  artwork: string | null;
  duration: number | null;
  position: number | null;
  paused: boolean;
}

const MAX_TEXT = 300;
const MAX_ARTWORK_URL = 4096;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_TEXT) : '';
}

function seconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function artworkUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_ARTWORK_URL) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function area(sizes: unknown): number {
  if (typeof sizes !== 'string') return 0;
  return Math.max(
    0,
    ...sizes.split(/\s+/).map((size) => {
      const [width, height] = size.toLowerCase().split('x').map(Number);
      return Number.isFinite(width) && Number.isFinite(height) ? width * height : 0;
    }),
  );
}

// Page script output is untrusted: keep short text, finite times and the largest web artwork.
export function parsePageMedia(raw: unknown): PageMedia | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const artwork = (Array.isArray(value.artwork) ? value.artwork : [])
    .slice(0, 16)
    .map((image) => {
      const item = image && typeof image === 'object' ? (image as Record<string, unknown>) : {};
      return { src: artworkUrl(item.src), area: area(item.sizes) };
    })
    .filter((image): image is { src: string; area: number } => image.src !== null)
    .sort((a, b) => b.area - a.area)[0];
  return {
    title: text(value.title),
    artist: text(value.artist),
    artwork: artwork?.src ?? null,
    duration: seconds(value.duration),
    position: seconds(value.position),
    paused: value.paused !== false,
  };
}
