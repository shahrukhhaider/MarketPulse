/**
 * Generic in-memory TTL cache backed by a Map.
 * Uses lazy expiry — entries are only checked on access, no background sweep.
 */

export interface CacheEntry<T> {
  data: T;
  storedAt: number; // Date.now() at insertion
}

export class TtlCache<T> {
  private store: Map<string, CacheEntry<T>>;
  private ttlMs: number;

  constructor(ttlMs?: number) {
    this.ttlMs = ttlMs ?? 30 * 60 * 1000; // default 30 minutes
    this.store = new Map();
  }

  /**
   * Returns the cached data if the entry exists and is not expired.
   * Returns undefined for missing or expired entries (lazy expiry).
   */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() - entry.storedAt >= this.ttlMs) {
      this.store.delete(key);
      return undefined;
    }

    return entry.data;
  }

  /**
   * Stores data with the current timestamp.
   */
  set(key: string, data: T): void {
    this.store.set(key, { data, storedAt: Date.now() });
  }

  /**
   * Returns true only if the entry exists AND is not expired.
   */
  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;

    if (Date.now() - entry.storedAt >= this.ttlMs) {
      this.store.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Empties the store.
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Returns the count of non-expired entries.
   * Cleans up expired entries as a side effect.
   */
  size(): number {
    const now = Date.now();
    let count = 0;

    for (const [key, entry] of this.store) {
      if (now - entry.storedAt >= this.ttlMs) {
        this.store.delete(key);
      } else {
        count++;
      }
    }

    return count;
  }
}
