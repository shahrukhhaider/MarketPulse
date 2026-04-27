import type { DataProvider, HistoricalResult, QuoteResult } from './data-provider.js';
import type { Result } from './config-store.js';
import type { HistoricalPeriod, HistoricalInterval } from './types.js';
import { HistoryCacheStore, isExpired, normalizeTicker } from './history-cache-store.js';
import type { CacheEntry } from './history-cache-store.js';

// ============================================================
// CachingDataProvider Options
// ============================================================

export interface CachingDataProviderOptions {
  cacheDir: string;
  ttlMs?: number;
  noCache?: boolean;
}

// ============================================================
// Default TTL: 24 hours in milliseconds
// ============================================================

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

// ============================================================
// CachingDataProvider
// ============================================================

export class CachingDataProvider implements DataProvider {
  readonly name: string;
  private readonly store: HistoryCacheStore;
  private readonly ttlMs: number;
  private readonly noCache: boolean;

  constructor(
    private readonly inner: DataProvider,
    private readonly options: CachingDataProviderOptions
  ) {
    this.name = inner.name;
    this.store = new HistoryCacheStore(options.cacheDir);
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.noCache = options.noCache ?? false;
  }

  /** Expose the wrapped provider for --no-cache bypass in command handlers. */
  get innerProvider(): DataProvider { return this.inner; }

  /** Expose the cache store for write-through in command handlers. */
  get cacheStore(): HistoryCacheStore { return this.store; }

  // Delegated directly — no caching for real-time data
  getQuote(ticker: string): Promise<Result<QuoteResult>> {
    return this.inner.getQuote(ticker);
  }

  getQuotes(tickers: string[]): Promise<Result<Map<string, QuoteResult>>> {
    return this.inner.getQuotes(tickers);
  }

  validateTicker(ticker: string): Promise<Result<boolean>> {
    return this.inner.validateTicker(ticker);
  }

  // Cached
  async getHistoricalData(
    ticker: string,
    period?: HistoricalPeriod,
    interval?: HistoricalInterval
  ): Promise<Result<HistoricalResult>> {
    const effectivePeriod: HistoricalPeriod = period ?? '1y';

    // Check cache unless noCache is set
    if (!this.noCache) {
      const cached = this.store.read(ticker, effectivePeriod);
      if (cached && !isExpired(cached, this.ttlMs)) {
        return {
          success: true,
          data: {
            ticker: cached.ticker,
            interval: cached.interval,
            dataPoints: cached.dataPoints,
          },
        };
      }
    }

    // Cache miss or noCache — delegate to inner provider
    const result = await this.inner.getHistoricalData(ticker, period, interval);

    // Only cache successful responses
    if (result.success) {
      const entry: CacheEntry = {
        ticker: normalizeTicker(ticker),
        period: effectivePeriod,
        interval: result.data.interval,
        fetchedAt: new Date().toISOString(),
        dataPoints: result.data.dataPoints,
      };
      this.store.write(entry);
    }

    return result;
  }

  // Cache management
  clearCache(ticker?: string): { removed: number } {
    const removed = this.store.clear(ticker);
    return { removed };
  }
}
