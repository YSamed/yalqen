export const MEDIA_WORLD_ID = 1030;

// Reads the page's Media Session metadata and the element that plays or played last.
export const MEDIA_READ_SCRIPT = `(() => {
  const meta = navigator.mediaSession?.metadata ?? null;
  const media = [...document.querySelectorAll('video, audio')];
  const element = media.find((item) => !item.paused) ?? media.find((item) => item.currentTime > 0) ?? null;
  return {
    title: meta?.title ?? '',
    artist: meta?.artist ?? '',
    artwork: [...(meta?.artwork ?? [])].map((image) => ({ src: image.src, sizes: image.sizes ?? '' })),
    duration: element ? element.duration : null,
    position: element ? element.currentTime : null,
    paused: element ? element.paused : true,
  };
})()`;

// Pauses whatever is playing, or resumes the media that was playing last.
export const MEDIA_TOGGLE_SCRIPT = `(() => {
  const media = [...document.querySelectorAll('video, audio')];
  const playing = media.filter((item) => !item.paused);
  if (playing.length > 0) {
    for (const item of playing) item.pause();
    return;
  }
  const last = media.find((item) => item.currentTime > 0 && !item.ended) ?? media[0];
  void last?.play().catch(() => {});
})()`;

export function mediaSeekScript(seconds: number): string {
  return `(() => {
  const media = [...document.querySelectorAll('video, audio')];
  const element = media.find((item) => !item.paused) ?? media.find((item) => item.currentTime > 0);
  if (!element) return;
  const end = Number.isFinite(element.duration) ? element.duration : Infinity;
  element.currentTime = Math.min(end, Math.max(0, element.currentTime + ${seconds}));
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
