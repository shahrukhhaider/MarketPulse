/**
 * Tracks consumed nonces for single-use link enforcement.
 * Uses an in-memory Map with lazy cleanup on access.
 * Appropriate for single-process deployment (Railway).
 */
export class NonceStore {
  private consumed = new Map<string, number>(); // nonce → consumed timestamp
  private readonly maxAgeMs = 15 * 60 * 1000; // 15 min (slightly > link TTL)

  /** Mark a nonce as consumed. Returns false if already consumed. */
  consume(nonce: string): boolean {
    this.cleanup();
    if (this.consumed.has(nonce)) return false;
    this.consumed.set(nonce, Date.now());
    return true;
  }

  /** Check if a nonce has been consumed. */
  isConsumed(nonce: string): boolean {
    return this.consumed.has(nonce);
  }

  /** Remove expired entries (older than maxAgeMs). */
  private cleanup(): void {
    const now = Date.now();
    for (const [nonce, ts] of this.consumed) {
      if (now - ts > this.maxAgeMs) {
        this.consumed.delete(nonce);
      }
    }
  }
}

export const nonceStore = new NonceStore();
