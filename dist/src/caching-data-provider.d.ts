import type { DataProvider, HistoricalResult, QuoteResult } from './data-provider.js';
import type { Result } from './config-store.js';
import type { HistoricalPeriod, HistoricalInterval } from './types.js';
import { HistoryCacheStore } from './history-cache-store.js';
export interface CachingDataProviderOptions {
    cacheDir: string;
    ttlMs?: number;
    noCache?: boolean;
}
export declare class CachingDataProvider implements DataProvider {
    private readonly inner;
    private readonly options;
    readonly name: string;
    private readonly store;
    private readonly ttlMs;
    private readonly noCache;
    constructor(inner: DataProvider, options: CachingDataProviderOptions);
    /** Expose the wrapped provider for --no-cache bypass in command handlers. */
    get innerProvider(): DataProvider;
    /** Expose the cache store for write-through in command handlers. */
    get cacheStore(): HistoryCacheStore;
    getQuote(ticker: string): Promise<Result<QuoteResult>>;
    getQuotes(tickers: string[]): Promise<Result<Map<string, QuoteResult>>>;
    validateTicker(ticker: string): Promise<Result<boolean>>;
    getHistoricalData(ticker: string, period?: HistoricalPeriod, interval?: HistoricalInterval): Promise<Result<HistoricalResult>>;
    clearCache(ticker?: string): {
        removed: number;
    };
}
//# sourceMappingURL=caching-data-provider.d.ts.map