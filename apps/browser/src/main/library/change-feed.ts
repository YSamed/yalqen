const CHANGE_WAIT_MS = 25_000;

export class ChangeFeed {
  private current = 0;
  private waiters = new Set<() => void>();

  get version(): number {
    return this.current;
  }

  notify(): void {
    this.current++;
    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const wake of waiters) wake();
  }

  next(since: number, timeoutMs = CHANGE_WAIT_MS, signal?: AbortSignal): Promise<number> {
    if (since !== this.current || signal?.aborted) return Promise.resolve(this.current);
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        this.waiters.delete(wake);
        signal?.removeEventListener('abort', wake);
        resolve(this.current);
      };
      const timer = setTimeout(wake, timeoutMs);
      this.waiters.add(wake);
      signal?.addEventListener('abort', wake, { once: true });
    });
  }
}
