import type { DataProvider, QuoteResult, HistoricalResult } from './data-provider.js';
import type { Result } from './config-store.js';
import type { HistoricalPeriod, HistoricalInterval, HistoricalDataPoint } from '../types.js';
import { CacheFileStore } from './cache-file-store.js';
import type { CacheFile } from './cache-file-store.js';
import { periodToStartDate } from '../utils/period-converter.js';
import { fetchDelta } from './delta-fetcher.js';
import type { DateRangeProvider } from './delta-fetcher.js';

// ============================================================
// Options
// ============================================================

export interface HistoricalDataCacheOptions {
  cacheDir: string;       // e.g., ".stock-tracker/history-cache"
  noCache?: boolean;      // bypass cache entirely (pass-through to inner)
}

// ============================================================
// HistoricalDataCache
// ============================================================

/**
 * Append-only historical data cache implementing DataProvider.
 *
 * Stores a single JSON file per ticker containing all available daily bars.
 * Uses delta fetching to minimize API calls — only fetches bars that are
 * missing from the cache. All consumers share the same cache transparently.
 *
 * The inner provider must implement `getHistoricalDataByDateRange` for
 * date-range-based fetching (YahooFinanceAdapter satisfies this).
 */
export class HistoricalDataCache implements DataProvider {
  readonly name: string;
  private readonly inner: DataProvider & DateRangeProvider;
  private readonly store: CacheFileStore;
  private readonly noCache: boolean;

  constructor(inner: DataProvider, options: HistoricalDataCacheOptions) {
    this.name = inner.name;
    this.inner = inner as DataProvider & DateRangeProvider;
    this.store = new CacheFileStore(options.cacheDir);
    this.noCache = options.noCache ?? false;
  }

  // ──────────────────────────────────────────────────────────
  // Pass-through methods (no caching for real-time data)
  // ──────────────────────────────────────────────────────────

  getQuote(ticker: string): Promise<Result<QuoteResult>> {
    return this.inner.getQuote(ticker);
  }

  getQuotes(tickers: string[]): Promise<Result<Map<string, QuoteResult>>> {
    return this.inner.getQuotes(tickers);
  }

  validateTicker(ticker: string): Promise<Result<boolean>> {
    return this.inner.validateTicker(ticker);
  }


  // ──────────────────────────────────────────────────────────
  // Period-based retrieval (backward-compatible DataProvider API)
  // ──────────────────────────────────────────────────────────

  async getHistoricalData(
    ticker: string,
    period?: HistoricalPeriod,
    interval?: HistoricalInterval
  ): Promise<Result<HistoricalResult>> {
    // If noCache, delegate directly to inner provider
    if (this.noCache) {
      return this.inner.getHistoricalData(ticker, period, interval);
    }

    // Cache only stores daily bars; for non-daily intervals, delegate to inner
    if (interval && interval !== '1d') {
      return this.inner.getHistoricalData(ticker, period, interval);
    }

    // Convert period to date range and use cache-aware retrieval
    const effectivePeriod = period ?? '1y';
    const startDate = periodToStartDate(effectivePeriod);

    return this.getHistoricalDataByRange(ticker, startDate);
  }

  // ──────────────────────────────────────────────────────────
  // Date-range-based retrieval (new primary API)
  // ──────────────────────────────────────────────────────────

  async getHistoricalDataByRange(
    ticker: string,
    startDate: string,
    endDate?: string
  ): Promise<Result<HistoricalResult>> {
    const normalized = ticker.toUpperCase();
    const effectiveEnd = endDate ?? todayISO();

    // If noCache, bypass cache entirely
    if (this.noCache) {
      return this.inner.getHistoricalDataByDateRange(normalized, startDate, effectiveEnd);
    }

    // Read existing cache
    const cacheFile = this.store.read(normalized);
    const existingBars = cacheFile?.dataPoints ?? [];

    // Check if cache fully covers the requested range (no fetch needed)
    if (existingBars.length > 0) {
      const earliestCached = existingBars[0].date;
      const latestCached = existingBars[existingBars.length - 1].date;

      if (earliestCached <= startDate && latestCached >= effectiveEnd) {
        // Cache fully covers — slice and return without API call
        const sliced = sliceBars(existingBars, startDate, effectiveEnd);
        return {
          success: true,
          data: { ticker: normalized, interval: '1d', dataPoints: sliced },
        };
      }
    }

    // Delta fetch: determine what's missing and fetch it
    const deltaResult = await fetchDelta(
      normalized,
      startDate,
      effectiveEnd,
      existingBars,
      this.inner
    );

    if (!deltaResult.success) {
      // Fetch failed — if we have cached data, return it (graceful degradation)
      if (existingBars.length > 0) {
        process.stderr.write(
          `[WARNING] ${normalized}: Delta fetch failed, returning cached data: ${deltaResult.error}\n`
        );
        const sliced = sliceBars(existingBars, startDate, effectiveEnd);
        return {
          success: true,
          data: { ticker: normalized, interval: '1d', dataPoints: sliced },
        };
      }
      // No cache and fetch failed — propagate error
      return deltaResult;
    }

    const { bars, fetchedFromApi } = deltaResult.data;

    // Write updated cache if new data was fetched
    if (fetchedFromApi && bars.length > 0) {
      const updatedCacheFile: CacheFile = {
        ticker: normalized,
        lastUpdated: new Date().toISOString(),
        dataPoints: bars,
      };
      this.store.write(updatedCacheFile);
    }

    // Slice to requested range and return
    const sliced = sliceBars(bars, startDate, effectiveEnd);
    return {
      success: true,
      data: { ticker: normalized, interval: '1d', dataPoints: sliced },
    };
  }

  // ──────────────────────────────────────────────────────────
  // Cache management
  // ──────────────────────────────────────────────────────────

  /**
   * Clear cache for a specific ticker or all tickers.
   * Returns the number of cache files removed.
   */
  clearCache(ticker?: string): { removed: number } {
    if (ticker) {
      const deleted = this.store.delete(ticker.toUpperCase());
      return { removed: deleted ? 1 : 0 };
    }
    const removed = this.store.clear();
    return { removed };
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Returns today's date as an ISO date string (YYYY-MM-DD).
 */
function todayISO(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Slices bars to only include those within [startDate, endDate] inclusive.
 */
function sliceBars(
  bars: HistoricalDataPoint[],
  startDate: string,
  endDate: string
): HistoricalDataPoint[] {
  return bars.filter((b) => b.date >= startDate && b.date <= endDate);
}
