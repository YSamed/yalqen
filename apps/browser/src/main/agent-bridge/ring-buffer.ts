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

  pairs(): [K, V][] {
    return [...this.entries.entries()];
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
