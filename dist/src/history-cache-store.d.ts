import type { HistoricalDataPoint, HistoricalInterval, HistoricalPeriod } from './types.js';
export interface CacheEntry {
    ticker: string;
    period: HistoricalPeriod;
    interval: HistoricalInterval;
    fetchedAt: string;
    dataPoints: HistoricalDataPoint[];
}
export declare function normalizeTicker(ticker: string): string;
export declare function cacheKey(ticker: string, period: HistoricalPeriod): string;
export declare function isExpired(entry: CacheEntry, ttlMs: number): boolean;
export declare function validateCacheEntry(parsed: unknown): parsed is CacheEntry;
export declare class HistoryCacheStore {
    private readonly cacheDir;
    constructor(cacheDir: string);
    filePath(ticker: string, period: HistoricalPeriod): string;
    ensureDir(): void;
    read(ticker: string, period: HistoricalPeriod): CacheEntry | null;
    write(entry: CacheEntry): boolean;
    clear(ticker?: string): number;
}
//# sourceMappingURL=history-cache-store.d.ts.map