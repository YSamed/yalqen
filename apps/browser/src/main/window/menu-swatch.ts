import { nativeImage, type NativeImage } from 'electron';

const SIZE = 28;
const swatches = new Map<string, NativeImage>();

// Native menus cannot draw colored dots, so each color becomes a small anti-aliased circle bitmap.
export function colorSwatch(hex: string): NativeImage {
  const cached = swatches.get(hex);
  if (cached) return cached;
  const [red, green, blue] = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
  const pixels = Buffer.alloc(SIZE * SIZE * 4);
  const radius = SIZE / 2 - 1;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const distance = Math.hypot(x + 0.5 - SIZE / 2, y + 0.5 - SIZE / 2);
      const alpha = Math.min(1, Math.max(0, radius - distance + 0.5));
      const offset = (y * SIZE + x) * 4;
      pixels[offset] = Math.round(blue * alpha);
      pixels[offset + 1] = Math.round(green * alpha);
      pixels[offset + 2] = Math.round(red * alpha);
      pixels[offset + 3] = Math.round(255 * alpha);
    }
  const image = nativeImage.createFromBitmap(pixels, { width: SIZE, height: SIZE, scaleFactor: 2 });
  swatches.set(hex, image);
  return image;
}
