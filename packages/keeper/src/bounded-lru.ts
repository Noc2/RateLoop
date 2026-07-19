export class BoundedLruMap<K, V> {
  readonly #entries = new Map<K, V>();

  constructor(readonly maxEntries: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new Error("BoundedLruMap maxEntries must be a positive integer.");
    }
  }

  get size() {
    return this.#entries.size;
  }

  clear() {
    this.#entries.clear();
  }

  get(key: K) {
    const value = this.#entries.get(key);
    if (value === undefined) return undefined;
    this.#entries.delete(key);
    this.#entries.set(key, value);
    return value;
  }

  set(key: K, value: V) {
    this.#entries.delete(key);
    this.#entries.set(key, value);
    while (this.#entries.size > this.maxEntries) {
      const oldestKey = this.#entries.keys().next().value as K | undefined;
      if (oldestKey === undefined) break;
      this.#entries.delete(oldestKey);
    }
  }
}
