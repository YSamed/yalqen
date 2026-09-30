import fs from 'node:fs';
import path from 'node:path';
import type { MenuItemConstructorOptions } from 'electron';
import { hostOf } from '../shared/hosts.js';
import { DOWNLOADS_URL, type DownloadsSummary } from '../shared/types.js';
import { JsonFile } from './json-file.js';
import { escapeHtml } from './html.js';

export type DownloadState = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted';

export interface DownloadEntry {
  id: string;
  url: string;
  filename: string;
  savePath: string;
  state: DownloadState;
  receivedBytes: number;
  totalBytes: number;
  startedAt: number;
  private?: boolean;
}

const MAX_ENTRIES = 200;
const MENU_ENTRIES = 8;
const STATES = new Set<string>(['progressing', 'paused', 'completed', 'cancelled', 'interrupted']);

export function uniquePath(directory: string, filename: string, taken: (file: string) => boolean): string {
  const name = path.basename(filename).replace(/^\.+/, '') || 'indirme';
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = path.join(directory, name);
  for (let i = 1; taken(candidate); i++) candidate = path.join(directory, `${stem} (${i})${ext}`);
  return candidate;
}

const number = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${number.format(unit === 0 ? value : Math.round(value * 10) / 10)} ${units[unit]}`;
}

export function downloadStatus(entry: DownloadEntry): string {
  const size =
    entry.totalBytes > 0
      ? `${formatBytes(entry.receivedBytes)} / ${formatBytes(entry.totalBytes)}`
      : formatBytes(entry.receivedBytes);
  switch (entry.state) {
    case 'progressing':
      return entry.totalBytes > 0 ? `%${Math.floor((entry.receivedBytes / entry.totalBytes) * 100)} · ${size}` : size;
    case 'paused':
      return `Duraklatıldı · ${size}`;
    case 'completed':
      return `Tamamlandı · ${formatBytes(entry.totalBytes || entry.receivedBytes)}`;
    case 'cancelled':
      return 'İptal edildi';
    case 'interrupted':
      return 'Başarısız';
  }
}

export function isActive(entry: DownloadEntry): boolean {
  return entry.state === 'progressing' || entry.state === 'paused';
}

export function downloadsSummary(entries: readonly DownloadEntry[]): Omit<DownloadsSummary, 'started'> {
  const active = entries.filter(isActive);
  const known = active.every((entry) => entry.totalBytes > 0);
  const total = active.reduce((sum, entry) => sum + entry.totalBytes, 0);
  const received = active.reduce((sum, entry) => sum + entry.receivedBytes, 0);
  return { active: active.length, progress: active.length > 0 && known && total > 0 ? received / total : null };
}

function isEntry(value: unknown): value is DownloadEntry {
  const entry = value as DownloadEntry;
  return (
    typeof entry === 'object' &&
    entry !== null &&
    typeof entry.id === 'string' &&
    typeof entry.url === 'string' &&
    typeof entry.filename === 'string' &&
    typeof entry.savePath === 'string' &&
    STATES.has(entry.state) &&
    Number.isFinite(entry.receivedBytes) &&
    Number.isFinite(entry.totalBytes) &&
    Number.isFinite(entry.startedAt)
  );
}

export class DownloadStore {
  readonly file: string;
  private readonly json: JsonFile;
  private entries: DownloadEntry[] = [];
  private started = 0;

  constructor(directory: string) {
    this.file = path.join(directory, 'downloads.json');
    this.json = new JsonFile(this.file, 'downloads');
    try {
      const data: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(data)) {
        this.entries = data
          .filter(isEntry)
          .slice(0, MAX_ENTRIES)
          .map((entry) => (isActive(entry) ? { ...entry, state: 'interrupted' } : entry));
      }
    } catch {}
  }

  list(): DownloadEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  summary(): DownloadsSummary {
    return { ...downloadsSummary(this.entries), started: this.started };
  }

  get(id: string): DownloadEntry | undefined {
    const entry = this.entries.find((item) => item.id === id);
    return entry && { ...entry };
  }

  add(entry: DownloadEntry): void {
    this.started++;
    this.entries.unshift({ ...entry });
    if (this.entries.length > MAX_ENTRIES) this.entries.length = MAX_ENTRIES;
    this.save();
  }

  update(id: string, patch: Partial<Omit<DownloadEntry, 'id'>>): void {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry) return;
    const stateChanged = patch.state !== undefined && patch.state !== entry.state;
    Object.assign(entry, patch);
    if (stateChanged) this.save();
  }

  remove(id: string): void {
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.id !== id);
    if (this.entries.length !== before) this.save();
  }

  removeSince(since: number): void {
    this.entries = this.entries.filter((entry) => isActive(entry) || entry.startedAt < since);
    this.save();
    this.saveNow();
  }

  removePrivate(): void {
    this.entries = this.entries.filter((entry) => !entry.private || isActive(entry));
  }

  clearFinished(): void {
    this.entries = this.entries.filter(isActive);
    this.save();
  }

  saveNow(): void {
    this.json.flush();
  }

  private save(): void {
    this.json.schedule(() => this.entries.filter((entry) => !entry.private));
  }
}

export interface DownloadActions {
  open(id: string): void;
  show(id: string): void;
  pause(id: string): void;
  resume(id: string): void;
  cancel(id: string): void;
  retry(id: string): void;
  remove(id: string): void;
  showAll(): void;
  openFolder(): void;
}

export function downloadCommands(entry: DownloadEntry): [keyof DownloadActions & string, string][] {
  switch (entry.state) {
    case 'progressing':
      return [
        ['pause', 'Duraklat'],
        ['cancel', 'İptal et'],
      ];
    case 'paused':
      return [
        ['resume', 'Devam et'],
        ['cancel', 'İptal et'],
      ];
    case 'completed':
      return [
        ['open', 'Aç'],
        ['show', 'Klasörde göster'],
        ['remove', 'Listeden kaldır'],
      ];
    case 'cancelled':
    case 'interrupted':
      return [
        ['retry', 'Yeniden dene'],
        ['remove', 'Listeden kaldır'],
      ];
  }
}

export function downloadsMenuTemplate(
  entries: readonly DownloadEntry[],
  actions: DownloadActions,
): MenuItemConstructorOptions[] {
  const recent = entries.slice(0, MENU_ENTRIES);
  return [
    ...(recent.length === 0
      ? [{ label: 'Henüz indirme yok', enabled: false }]
      : recent.map((entry) => ({
          label: `${entry.filename} — ${downloadStatus(entry)}`,
          submenu: downloadCommands(entry).map(([action, label]) => ({
            label,
            click: () => (actions[action] as (id: string) => void)(entry.id),
          })),
        }))),
    { type: 'separator' },
    { label: 'Tüm indirilenler', click: actions.showAll },
    { label: 'İndirilenler klasörünü aç', click: actions.openFolder },
  ];
}

export function renderDownloads(entries: readonly DownloadEntry[]): string {
  if (entries.length === 0) return '<p class="empty">Henüz indirilen bir dosya yok.</p>';
  const rows = entries
    .map((entry) => {
      const commands = downloadCommands(entry)
        .map(
          ([action, label]) =>
            `<a class="btn tonal" href="${DOWNLOADS_URL}${action}?id=${encodeURIComponent(entry.id)}">${label}</a>`,
        )
        .join('');
      return (
        `<li class="${entry.state}"><div class="file"><strong>${escapeHtml(entry.filename)}</strong>` +
        `<span>${escapeHtml(downloadStatus(entry))} · ${escapeHtml(hostOf(entry.url) ?? entry.url)}</span></div>` +
        `<div class="commands">${commands}</div></li>`
      );
    })
    .join('');
  const finished = entries.some((entry) => !isActive(entry));
  const clear = finished ? `<a class="clear" href="${DOWNLOADS_URL}clear">Listeyi temizle</a>` : '';
  return `<div class="summary"><span>${entries.length} indirme</span>${clear}</div><ol>${rows}</ol>`;
}
