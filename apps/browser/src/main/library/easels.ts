import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { MAX_CLIP_CHARS, type Easel, type EaselClip, type EaselItem, type EaselSummary } from '../../shared/easels.js';
import { readingUrl } from '../../shared/reading-list.js';
import { writeFileAtomic } from '../storage/json-file.js';

const MAX_EASELS = 20;
const MAX_ITEMS = 100;
const MAX_POINTS = 4000;
const MAX_NOTE = 2000;
const MAX_COORDINATE = 20_000;
const MAX_FILE = 8 * 1024 * 1024;
const JPEG_URL = /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
const within = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const easelName = (value: unknown): string | null =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 80) || null : null;

// Clips carry page-derived data, so only the main process may add them.
export function easelItem(value: unknown, allowClip: boolean, id: string = randomUUID()): EaselItem | null {
  const item = record(value);
  if (!item) return null;
  if (item.kind === 'note') {
    const { x, y, w, h, text } = item;
    return within(x, -MAX_COORDINATE, MAX_COORDINATE) &&
      within(y, -MAX_COORDINATE, MAX_COORDINATE) &&
      within(w, 60, 1000) &&
      within(h, 40, 1000) &&
      typeof text === 'string' &&
      text.length <= MAX_NOTE
      ? { id, kind: 'note', x, y, w, h, text }
      : null;
  }
  if (item.kind === 'stroke') {
    const { color, width, points } = item;
    return typeof color === 'string' &&
      /^#[0-9a-f]{6}$/i.test(color) &&
      within(width, 1, 32) &&
      Array.isArray(points) &&
      points.length >= 4 &&
      points.length <= MAX_POINTS &&
      points.length % 2 === 0 &&
      points.every((point) => within(point, -MAX_COORDINATE, MAX_COORDINATE))
      ? {
          id,
          kind: 'stroke',
          color: color.toLowerCase(),
          width,
          points: (points as number[]).map((point) => Math.round(point * 10) / 10),
        }
      : null;
  }
  const { x, y, w, h, src, url, title } = item;
  const page = readingUrl(url);
  return allowClip &&
    item.kind === 'clip' &&
    within(x, -MAX_COORDINATE, MAX_COORDINATE) &&
    within(y, -MAX_COORDINATE, MAX_COORDINATE) &&
    within(w, 20, 4000) &&
    within(h, 20, 4000) &&
    typeof src === 'string' &&
    src.length <= MAX_CLIP_CHARS &&
    JPEG_URL.test(src) &&
    page &&
    typeof title === 'string'
    ? { id, kind: 'clip', x, y, w, h, src, url: page, title: title.slice(0, 512) }
    : null;
}

export class EaselStore {
  readonly file: string;
  private easels: Easel[] = [];
  constructor(directory: string) {
    this.file = path.join(directory, 'easels.json');
    try {
      if (fs.statSync(this.file).size > MAX_FILE) return;
      const data: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(data)) return;
      const ids = new Set<string>();
      for (const value of data.slice(0, MAX_EASELS)) {
        const entry = record(value),
          name = easelName(entry?.name);
        if (!entry || !name || typeof entry.id !== 'string' || entry.id.length > 128 || ids.has(entry.id)) continue;
        if (!Array.isArray(entry.items) || !within(entry.updatedAt, 0, Number.MAX_SAFE_INTEGER)) continue;
        ids.add(entry.id);
        const items = entry.items.slice(0, MAX_ITEMS).flatMap((raw: unknown) => {
          const itemId = record(raw)?.id,
            item = typeof itemId === 'string' && itemId.length <= 128 ? easelItem(raw, true, itemId) : null;
          return item ? [item] : [];
        });
        this.easels.push({ id: entry.id, name, updatedAt: entry.updatedAt, items });
      }
    } catch {}
  }
  list(): EaselSummary[] {
    return this.easels.map(({ id, name, items }) => ({ id, name, count: items.length }));
  }
  get(id: string): Easel | null {
    return this.easels.find((easel) => easel.id === id) ?? null;
  }
  latest(): Easel | null {
    return this.easels.reduce<Easel | null>((a, b) => (a && a.updatedAt > b.updatedAt ? a : b), null);
  }
  create(name: unknown): Easel | null {
    const clean = easelName(name);
    if (!clean || this.easels.length >= MAX_EASELS) return null;
    const easel = { id: randomUUID(), name: clean, updatedAt: Date.now(), items: [] };
    return this.replace([...this.easels, easel]) ? easel : null;
  }
  rename(id: string, name: unknown): boolean {
    const clean = easelName(name);
    return !!clean && this.change(id, (easel) => ({ ...easel, name: clean }));
  }
  remove(id: string): boolean {
    return this.get(id) !== null && this.replace(this.easels.filter((easel) => easel.id !== id));
  }
  add(id: string, value: unknown, allowClip = false): EaselItem | null {
    const item = easelItem(value, allowClip);
    const added =
      !!item &&
      this.change(id, (easel) => (easel.items.length < MAX_ITEMS ? { ...easel, items: [...easel.items, item] } : null));
    return added ? item : null;
  }
  clip(
    clip: Omit<EaselClip, 'id' | 'kind' | 'x' | 'y'>,
    fallbackName: string,
  ): { easel: Easel; item: EaselItem } | null {
    const easel = this.latest() ?? this.create(fallbackName);
    const offset = 40 + ((easel?.items.length ?? 0) % 10) * 30;
    const item = easel && this.add(easel.id, { ...clip, kind: 'clip', x: offset, y: offset }, true);
    return easel && item ? { easel: this.get(easel.id)!, item } : null;
  }
  patch(id: string, itemId: string, value: unknown): boolean {
    const patch = record(value);
    if (!patch) return false;
    const allowed = Object.fromEntries(
      ['x', 'y', 'w', 'h', 'text'].filter((key) => key in patch).map((key) => [key, patch[key]]),
    );
    return this.change(id, (easel) => {
      const target = easel.items.find((item) => item.id === itemId);
      const merged = target && target.kind !== 'stroke' ? easelItem({ ...target, ...allowed }, true, itemId) : null;
      return merged ? { ...easel, items: easel.items.map((item) => (item.id === itemId ? merged : item)) } : null;
    });
  }
  removeItem(id: string, itemId: string): boolean {
    return this.change(id, (easel) =>
      easel.items.some((item) => item.id === itemId)
        ? { ...easel, items: easel.items.filter((item) => item.id !== itemId) }
        : null,
    );
  }
  private change(id: string, update: (easel: Easel) => Easel | null): boolean {
    const easel = this.get(id),
      next = easel && update(easel);
    return (
      !!next && this.replace(this.easels.map((item) => (item === easel ? { ...next, updatedAt: Date.now() } : item)))
    );
  }
  private replace(easels: Easel[]): boolean {
    const json = JSON.stringify(easels);
    const saved = json.length <= MAX_FILE && writeFileAtomic(this.file, json);
    if (saved) this.easels = easels;
    return saved;
  }
}
