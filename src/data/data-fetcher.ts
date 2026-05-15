import type { HistoricalDataCache } from './historical-data-cache.js';
import type { HistoricalDataPoint } from '../types.js';

// ============================================================
// Interfaces
// ============================================================

export interface FetchResult {
  ticker: string;
  success: boolean;
  data?: HistoricalDataPoint[];
  error?: string;
}

export interface DataFetcherOptions {
  /** Max concurrent fetches. Default: 5 */
  maxConcurrent?: number;
  /** Use cache or bypass. Default: true (use cache) */
  useCache?: boolean;
}

// ============================================================
// Semaphore for concurrency limiting
// ============================================================

class Semaphore {
  private current = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.current++;
        resolve();
      });
    });
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }

  /** Current number of in-flight operations */
  get inFlight(): number {
    return this.current;
  }
}

// ============================================================
// Internal fetch helper
// ============================================================

async function fetchSingleTicker(
  ticker: string,
  provider: HistoricalDataCache,
): Promise<FetchResult> {
  try {
    const result = await provider.getHistoricalData(ticker);
    if (result.success) {
      return {
        ticker,
        success: true,
        data: result.data.dataPoints,
      };
    }
    return {
      ticker,
      success: false,
      error: result.error,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ticker,
      success: false,
      error: message,
    };
  }
}

// ============================================================
// fetchAllHistoricalData
// ============================================================

/**
 * Fetch historical data for multiple tickers with concurrency limiting.
 * Returns results as they complete (does not preserve input order).
 * Skips tickers on fetch failure, records warning, continues processing.
 */
export async function fetchAllHistoricalData(
  tickers: string[],
  provider: HistoricalDataCache,
  options?: DataFetcherOptions,
): Promise<FetchResult[]> {
  const maxConcurrent = options?.maxConcurrent ?? 5;
  const semaphore = new Semaphore(maxConcurrent);
  const results: FetchResult[] = [];

  const tasks = tickers.map(async (ticker) => {
    await semaphore.acquire();
    try {
      const result = await fetchSingleTicker(ticker, provider);
      results.push(result);
      if (!result.success) {
        process.stderr.write(
          `[WARNING] ${ticker}: Failed to fetch data: ${result.error}\n`,
        );
      }
    } finally {
      semaphore.release();
    }
  });

  await Promise.all(tasks);
  return results;
}

// ============================================================
// fetchHistoricalDataStream
// ============================================================

/**
 * Fetch historical data for multiple tickers, yielding results as they arrive.
 * Enables dispatch-as-fetched pattern.
 * Skips tickers on fetch failure, records warning, continues processing.
 */
export async function* fetchHistoricalDataStream(
  tickers: string[],
  provider: HistoricalDataCache,
  options?: DataFetcherOptions,
): AsyncGenerator<FetchResult> {
  const maxConcurrent = options?.maxConcurrent ?? 5;
  const semaphore = new Semaphore(maxConcurrent);

  // Buffer for results that have completed but not yet been yielded
  const buffer: FetchResult[] = [];
  let resolveWaiting: (() => void) | null = null;

  function notifyResult(): void {
    if (resolveWaiting) {
      const resolve = resolveWaiting;
      resolveWaiting = null;
      resolve();
    }
  }

  // Launch all fetches with concurrency limiting
  for (const ticker of tickers) {
    // Don't await here — we want to launch them concurrently
    semaphore.acquire().then(async () => {
      try {
        const result = await fetchSingleTicker(ticker, provider);
        if (!result.success) {
          process.stderr.write(
            `[WARNING] ${ticker}: Failed to fetch data: ${result.error}\n`,
          );
        }
        buffer.push(result);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        buffer.push({ ticker, success: false, error: message });
        process.stderr.write(
          `[WARNING] ${ticker}: Failed to fetch data: ${message}\n`,
        );
      } finally {
        semaphore.release();
        notifyResult();
      }
    });
  }

  // Yield results as they arrive
  let yielded = 0;
  const total = tickers.length;

  while (yielded < total) {
    // Drain the buffer
    while (buffer.length > 0) {
      yield buffer.shift()!;
      yielded++;
    }

    // If we've yielded everything, we're done
    if (yielded >= total) break;

    // Wait for the next result to arrive
    await new Promise<void>((resolve) => {
      // Check if something arrived while we were setting up
      if (buffer.length > 0) {
        resolve();
      } else {
        resolveWaiting = resolve;
      }
    });
  }
}
