import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const USAGE_ENDPOINT = 'https://yalqen.com/api/usage';
export const USAGE_FIRST_DELAY_MS = 30_000;
export const USAGE_INTERVAL_MS = 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface UsageState {
  installationId: string;
  lastSentDay: string | null;
}

interface UsageOptions {
  directory: string;
  endpoint: string | null;
  enabled(): boolean;
  active(): boolean;
  now?: () => number;
  send?: typeof fetch;
}

// A profile is counted at most once per UTC day. Nothing from tabs or browsing sessions is read.
export class UsageReporter {
  private readonly file: string;
  private state: UsageState | null = null;
  private timer: NodeJS.Timeout | null = null;
  private request: AbortController | null = null;

  constructor(private readonly options: UsageOptions) {
    this.file = path.join(options.directory, 'usage.json');
  }

  schedule(): void {
    this.stop();
    if (this.options.endpoint && this.options.enabled()) this.after(USAGE_FIRST_DELAY_MS);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.request?.abort();
  }

  async report(): Promise<void> {
    const { endpoint, enabled, active } = this.options;
    if (!endpoint || !enabled() || !active() || this.request) return;
    try {
      if (new URL(endpoint).protocol !== 'https:') return;
      const day = new Date((this.options.now ?? Date.now)()).toISOString().slice(0, 10);
      const state = this.load();
      if (state.lastSentDay === day) return;
      const controller = new AbortController();
      this.request = controller;
      const timeout = setTimeout(() => controller.abort(), 10_000);
      timeout.unref();
      try {
        const response = await (this.options.send ?? fetch)(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'Yalqen-Usage/1' },
          body: JSON.stringify({ installationId: state.installationId }),
          credentials: 'omit',
          redirect: 'error',
          signal: controller.signal,
        });
        if (response.status === 204 && !controller.signal.aborted && enabled()) {
          const next = { ...state, lastSentDay: day };
          this.save(next);
          this.state = next;
        }
      } finally {
        clearTimeout(timeout);
        this.request = null;
      }
    } catch {
      // Offline or unavailable collector: retry on the next hourly check without affecting browsing.
    }
  }

  private after(delay: number): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.report();
      if (this.options.endpoint && this.options.enabled()) this.after(USAGE_INTERVAL_MS);
    }, delay);
    this.timer.unref();
  }

  private load(): UsageState {
    if (this.state) return this.state;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<UsageState>;
      if (
        typeof data.installationId === 'string' &&
        UUID.test(data.installationId) &&
        (data.lastSentDay === null || /^\d{4}-\d{2}-\d{2}$/.test(data.lastSentDay ?? ''))
      ) {
        this.state = data as UsageState;
        return this.state;
      }
    } catch (error) {
      // Do not replace an unreadable identity: doing so would inflate the count on every launch.
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const state = { installationId: randomUUID(), lastSentDay: null };
    this.save(state);
    this.state = state;
    return state;
  }

  private save(state: UsageState): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
}
