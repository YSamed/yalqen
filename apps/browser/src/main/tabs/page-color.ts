// Picks the color most of the page's top edge shows, so the toolbar can blend into the page the way Dia's does.
export function edgeColor(bitmap: Uint8Array, width: number, height: number, samples = 24): string | null {
  if (width <= 0 || height <= 0 || bitmap.length < width * height * 4) return null;
  const row = Math.min(1, height - 1);
  const counts = new Map<string, number>();
  for (let index = 0; index < samples; index++) {
    const x = Math.min(width - 1, Math.floor(((index + 0.5) * width) / samples));
    const at = (row * width + x) * 4;
    if (bitmap[at + 3]! < 250) continue;
    const hex = `#${[bitmap[at + 2]!, bitmap[at + 1]!, bitmap[at]!].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [hex, count] of counts) {
    if (count > bestCount) [best, bestCount] = [hex, count];
  }
  // A busy edge (a photo or a gradient header) gives no clear color, so the toolbar keeps the card's own.
  return bestCount * 2 >= samples ? best : null;
}
