import { consoleEntry, networkUpdate, type ConsoleEntry, type NetworkRecord } from './cdp-events.js';
import { SELECTION_LIMIT, type ElementSelection } from './selection.js';

export class RingBuffer<T> {
  private items: T[] = [];

  constructor(readonly capacity: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) this.items.shift();
  }

  values(): readonly T[] {
    return this.items;
  }

  clear(): void {
    this.items = [];
  }

  get size(): number {
    return this.items.length;
  }
}

export class CappedMap<K, V> {
  private entries = new Map<K, V>();

  constructor(readonly capacity: number) {}

  get(key: K): V | undefined {
    return this.entries.get(key);
  }

  set(key: K, value: V): void {
    if (!this.entries.has(key) && this.entries.size >= this.capacity) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, value);
  }

  values(): V[] {
    return [...this.entries.values()];
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}

export const CONSOLE_LIMIT = 200;
export const NETWORK_LIMIT = 300;

export class TabRuntime {
  readonly console = new RingBuffer<ConsoleEntry>(CONSOLE_LIMIT);
  readonly network = new CappedMap<string, NetworkRecord>(NETWORK_LIMIT);
  readonly selections = new RingBuffer<ElementSelection>(SELECTION_LIMIT);

  handle(method: string, params: unknown): void {
    const entry = consoleEntry(method, params);
    if (entry) {
      this.console.push(entry);
      return;
    }
    if (!method.startsWith('Network.')) return;
    const id = (params as { requestId?: unknown } | null)?.requestId;
    const existing = typeof id === 'string' ? this.network.get(id) : undefined;
    const updated = networkUpdate(method, params, existing);
    if (updated) this.network.set(updated.id, updated);
  }

  clear(): void {
    this.console.clear();
    this.network.clear();
    this.selections.clear();
  }
}
