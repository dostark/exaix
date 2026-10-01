/**
 * @module BoundedLruCache
 * @path packages/flow/src/bounded_lru_cache.ts
 * @description A map that keeps at most a fixed number of entries and drops the least recently used one first.
 * @architectural-layer Flow
 * @dependencies []
 * @related-files [packages/flow/src/flow_runner.ts]
 */

export class BoundedLruCache<K, V> {
  private readonly entries = new Map<K, V>();

  constructor(private readonly maxSize: number) {}

  get size(): number {
    return this.entries.size;
  }

  get(key: K): V | undefined {
    const value = this.entries.get(key);
    if (value === undefined) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxSize) {
      const oldest = this.entries.keys().next().value as K;
      this.entries.delete(oldest);
    }
  }
}
