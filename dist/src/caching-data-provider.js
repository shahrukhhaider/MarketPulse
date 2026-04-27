"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CachingDataProvider = void 0;
const history_cache_store_js_1 = require("./history-cache-store.js");
// ============================================================
// Default TTL: 24 hours in milliseconds
// ============================================================
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
// ============================================================
// CachingDataProvider
// ============================================================
class CachingDataProvider {
    inner;
    options;
    name;
    store;
    ttlMs;
    noCache;
    constructor(inner, options) {
        this.inner = inner;
        this.options = options;
        this.name = inner.name;
        this.store = new history_cache_store_js_1.HistoryCacheStore(options.cacheDir);
        this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
        this.noCache = options.noCache ?? false;
    }
    /** Expose the wrapped provider for --no-cache bypass in command handlers. */
    get innerProvider() { return this.inner; }
    /** Expose the cache store for write-through in command handlers. */
    get cacheStore() { return this.store; }
    // Delegated directly — no caching for real-time data
    getQuote(ticker) {
        return this.inner.getQuote(ticker);
    }
    getQuotes(tickers) {
        return this.inner.getQuotes(tickers);
    }
    validateTicker(ticker) {
        return this.inner.validateTicker(ticker);
    }
    // Cached
    async getHistoricalData(ticker, period, interval) {
        const effectivePeriod = period ?? '1y';
        // Check cache unless noCache is set
        if (!this.noCache) {
            const cached = this.store.read(ticker, effectivePeriod);
            if (cached && !(0, history_cache_store_js_1.isExpired)(cached, this.ttlMs)) {
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
            const entry = {
                ticker: (0, history_cache_store_js_1.normalizeTicker)(ticker),
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
    clearCache(ticker) {
        const removed = this.store.clear(ticker);
        return { removed };
    }
}
exports.CachingDataProvider = CachingDataProvider;
//# sourceMappingURL=caching-data-provider.js.map