import fs from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay, performance, type ELDHistogram } from 'node:perf_hooks';

export interface LoopDelay {
  p50Ms: number;
  p99Ms: number;
  maxMs: number;
}

export interface WriteCounter {
  count: number;
  bytes: number;
  serializeMs: number;
}

export interface BenchOptions {
  file: string;
  fields: Record<string, unknown>;
  spawnedAt: number | null;
  profile: string | null;
  now?: () => number;
}

const LOOP_RESOLUTION_MS = 10;
const NS_PER_MS = 1e6;

export const roundMs = (value: number): number => Math.round(value * 10) / 10;

// The histogram records whole timer intervals, so an idle loop reads as the resolution itself.
export function loopDelayMs(nanoseconds: number): number {
  return roundMs(Math.max(0, nanoseconds / NS_PER_MS - LOOP_RESOLUTION_MS));
}

export class Bench {
  readonly profile: string | null;
  private readonly file: string;
  private readonly fields: Record<string, unknown>;
  private readonly spawnedAt: number | null;
  private readonly now: () => number;
  private readonly loop: ELDHistogram = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS });
  private readonly marked = new Set<string>();
  private writes = new Map<string, WriteCounter>();

  constructor(options: BenchOptions) {
    this.file = options.file;
    this.fields = options.fields;
    this.spawnedAt = options.spawnedAt;
    this.profile = options.profile;
    this.now = options.now ?? Date.now;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.loop.enable();
  }

  mark(event: string, fields: Record<string, unknown> = {}): void {
    if (this.marked.has(event)) return;
    this.marked.add(event);
    this.record(event, {
      ...fields,
      sinceStartMs: roundMs(performance.now()),
      sinceSpawnMs: this.spawnedAt === null ? null : this.now() - this.spawnedAt,
    });
  }

  record(event: string, fields: Record<string, unknown> = {}): void {
    const line = JSON.stringify({ ts: new Date(this.now()).toISOString(), ...this.fields, event, ...fields });
    try {
      fs.appendFileSync(this.file, `${line}\n`);
    } catch (error) {
      console.warn('[bench] could not record:', error);
    }
  }

  countWrite(label: string, bytes: number, serializeMs: number): void {
    const counter = this.writes.get(label) ?? { count: 0, bytes: 0, serializeMs: 0 };
    counter.count++;
    counter.bytes += bytes;
    counter.serializeMs += serializeMs;
    this.writes.set(label, counter);
  }

  takeWrites(): Record<string, WriteCounter> {
    const writes = Object.fromEntries(
      [...this.writes].map(([label, counter]) => [label, { ...counter, serializeMs: roundMs(counter.serializeMs) }]),
    );
    this.writes = new Map();
    return writes;
  }

  takeLoopDelay(): LoopDelay {
    const delay = {
      p50Ms: loopDelayMs(this.loop.percentile(50)),
      p99Ms: loopDelayMs(this.loop.percentile(99)),
      maxMs: loopDelayMs(this.loop.max),
    };
    this.loop.reset();
    return delay;
  }
}

export function benchFromEnv(env: NodeJS.ProcessEnv): Bench | null {
  const file = env.YALQEN_BENCH;
  if (!file) return null;
  const spawnedAt = Number(env.YALQEN_BENCH_SPAWNED_AT);
  return new Bench({
    file: path.resolve(file),
    spawnedAt: Number.isFinite(spawnedAt) && spawnedAt > 0 ? spawnedAt : null,
    profile: env.YALQEN_BENCH_PROFILE ? path.resolve(env.YALQEN_BENCH_PROFILE) : null,
    fields: {
      session: env.YALQEN_BENCH_SESSION ?? null,
      scenario: env.YALQEN_BENCH_SCENARIO ?? null,
      variant: env.YALQEN_BENCH_VARIANT ?? null,
      run: env.YALQEN_BENCH_RUN ? Number(env.YALQEN_BENCH_RUN) : null,
      electron: process.versions.electron ?? null,
      chromium: process.versions.chrome ?? null,
      platform: `${process.platform}-${process.arch}`,
    },
  });
}

export const bench = benchFromEnv(process.env);
