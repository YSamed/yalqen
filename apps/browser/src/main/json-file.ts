import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { bench } from './bench.js';

export const SAVE_DELAY_MS = 500;
export const LAZY_SAVE_DELAY_MS = 5000;
export const MAX_SAVE_WAIT_MS = 5000;

export class JsonFile {
  private timer: NodeJS.Timeout | null = null;
  private pendingSince = 0;
  private pendingDelay = 0;
  private generation = 0;
  private data: (() => unknown) | null = null;
  private dirty = false;

  constructor(
    readonly file: string,
    private readonly label: string,
    private readonly maxWaitMs = MAX_SAVE_WAIT_MS,
  ) {}

  // Each change pushes the save back, but never past maxWaitMs after the first unsaved change,
  // and a change that may wait longer never delays a save that is already due sooner.
  schedule(data: () => unknown, delayMs = SAVE_DELAY_MS): void {
    this.data = data;
    this.dirty = true;
    if (this.timer && delayMs > this.pendingDelay) return;
    const now = Date.now();
    if (this.timer) clearTimeout(this.timer);
    else this.pendingSince = now;
    this.pendingDelay = delayMs;
    const wait = Math.max(0, Math.min(delayMs, this.pendingSince + this.maxWaitMs - now));
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.writeInBackground();
    }, wait);
  }

  flush(data?: () => unknown): void {
    if (data) {
      this.data = data;
      this.dirty = true;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty || !this.data) return;
    this.generation++;
    const temp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(temp, this.serialize(this.data));
      fs.renameSync(temp, this.file);
      this.dirty = false;
    } catch (error) {
      console.warn(`[${this.label}] could not save:`, error);
    }
  }

  private async writeInBackground(): Promise<void> {
    if (!this.data) return;
    const generation = ++this.generation;
    const temp = `${this.file}.${generation}.tmp`;
    try {
      const json = this.serialize(this.data);
      await fs.promises.mkdir(path.dirname(this.file), { recursive: true });
      await fs.promises.writeFile(temp, json);
      if (generation !== this.generation) {
        await fs.promises.rm(temp, { force: true });
        return;
      }
      fs.renameSync(temp, this.file);
      if (!this.timer) this.dirty = false;
    } catch (error) {
      console.warn(`[${this.label}] could not save:`, error);
      await fs.promises.rm(temp, { force: true }).catch(() => {});
    }
  }

  private serialize(data: () => unknown): string {
    const started = performance.now();
    const json = JSON.stringify(data());
    bench?.countWrite(this.label, Buffer.byteLength(json), performance.now() - started);
    return json;
  }
}
