import { buildSearchUrl, type SearchEngine } from './search.js';
import { resolveInput } from './url.js';

/** How long typing must pause before the typed destination is connected to. */
const TYPING_DELAY_MS = 150;
/** An origin is not connected to again within this time; its socket is likely still open. */
const REPEAT_AFTER_MS = 10_000;

/** Origin that submitting `input` would load, or null for non-web destinations. */
export function destinationOrigin(input: string, engine: SearchEngine): string | null {
  if (input.trim() === '') return null;
  try {
    const url = new URL(resolveInput(input, engine));
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Opens connections to where address input is heading while the user is still
 * typing, so DNS, TCP and TLS are done by the time they press Enter.
 */
export class Preconnector {
  private timer: NodeJS.Timeout | null = null;
  private readonly recent = new Map<string, number>();

  constructor(
    private readonly connect: (origin: string) => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** The search engine is the most likely destination as soon as the address box opens. */
  opened(engine: SearchEngine): void {
    this.connectTo(new URL(buildSearchUrl(engine, '')).origin);
  }

  /** Connects once typing pauses; each keystroke restarts the wait. */
  typed(input: string, engine: SearchEngine): void {
    this.cancel();
    const origin = destinationOrigin(input, engine);
    if (!origin) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.connectTo(origin);
    }, TYPING_DELAY_MS);
  }

  cancel(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }

  private connectTo(origin: string): void {
    const time = this.now();
    for (const [known, at] of this.recent) {
      if (time - at >= REPEAT_AFTER_MS) this.recent.delete(known);
    }
    if (this.recent.has(origin)) return;
    this.recent.set(origin, time);
    this.connect(origin);
  }
}
