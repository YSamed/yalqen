import fs from 'node:fs';
import path from 'node:path';
import { JsonFile } from '../storage/json-file.js';

export const ZOOM_FACTORS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const MIN_FACTOR = ZOOM_FACTORS[0];
const MAX_FACTOR = ZOOM_FACTORS[ZOOM_FACTORS.length - 1];
const EPSILON = 0.001;

export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_FACTORS.find((factor) => factor > current + EPSILON) ?? MAX_FACTOR;
  return ZOOM_FACTORS.findLast((factor) => factor < current - EPSILON) ?? MIN_FACTOR;
}

export function zoomKey(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url);
    return (protocol === 'http:' || protocol === 'https:') && hostname !== '' ? hostname : null;
  } catch {
    return null;
  }
}

interface SavedZoom {
  version: 1;
  sites: Record<string, number>;
}

export class ZoomStore {
  readonly file: string | null;
  private readonly json: JsonFile | null;
  private readonly sites = new Map<string, number>();

  constructor(
    directory: string | null,
    private readonly defaultFactor: () => number = () => 1,
  ) {
    this.file = directory === null ? null : path.join(directory, 'zoom.json');
    this.json = this.file === null ? null : new JsonFile(this.file, 'zoom');
    this.load();
  }

  get(url: string): number {
    const key = zoomKey(url);
    return (key === null ? undefined : this.sites.get(key)) ?? this.defaultFactor();
  }

  has(url: string): boolean {
    const key = zoomKey(url);
    return key !== null && this.sites.has(key);
  }

  set(url: string, factor: number): void {
    const key = zoomKey(url);
    if (!key || !Number.isFinite(factor)) return;
    const clamped = Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, factor));
    if (Math.abs(clamped - this.defaultFactor()) < EPSILON) {
      if (!this.sites.delete(key)) return;
    } else {
      if (this.sites.get(key) === clamped) return;
      this.sites.set(key, clamped);
    }
    this.save();
  }

  private load(): void {
    if (this.file === null) return;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as SavedZoom;
      if (data.version !== 1 || typeof data.sites !== 'object' || data.sites === null) return;
      for (const [key, factor] of Object.entries(data.sites)) {
        if (typeof factor === 'number' && factor >= MIN_FACTOR && factor <= MAX_FACTOR) {
          this.sites.set(key, factor);
        }
      }
    } catch {}
  }

  saveNow(): void {
    this.json?.flush();
  }

  private save(): void {
    this.json?.schedule((): SavedZoom => ({ version: 1, sites: Object.fromEntries(this.sites) }));
  }
}
