// Picks the color most of the page's top edge shows, so the toolbar can blend into the page the way Dia's does.
export function edgeColor(bitmap: Uint8Array, width: number, height: number, samples = 48): string | null {
  if (width <= 0 || height <= 0 || bitmap.length < width * height * 4) return null;
  const row = Math.min(1, height - 1);
  const buckets = new Map<number, { count: number; at: number }>();
  let opaque = 0;
  for (let index = 0; index < samples; index++) {
    const x = Math.min(width - 1, Math.floor(((index + 0.5) * width) / samples));
    const at = (row * width + x) * 4;
    if (bitmap[at + 3]! < 250) continue;
    opaque++;
    const key = ((bitmap[at + 2]! >> 3) << 10) | ((bitmap[at + 1]! >> 3) << 5) | (bitmap[at]! >> 3);
    const bucket = buckets.get(key);
    if (bucket) bucket.count++;
    else buckets.set(key, { count: 1, at });
  }
  let best: { count: number; at: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  // A busy edge (a photo or a gradient header) gives no clear color, so the toolbar keeps the card's own.
  if (!best || best.count * 2 < opaque || opaque * 2 < samples) return null;
  return `#${[bitmap[best.at + 2]!, bitmap[best.at + 1]!, bitmap[best.at]!].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}
