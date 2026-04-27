"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.YahooFinanceAdapter = void 0;
const price_feed_client_js_1 = require("./price-feed-client.js");
const types_js_1 = require("./types.js");
// yahoo-finance2 v3 exports a class constructor; v2 exported a pre-built instance.
// Lazy-load the default client only when needed (avoids import side-effects in tests).
let _defaultYahooFinance;
function getDefaultYahooFinance() {
    if (!_defaultYahooFinance) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const YahooFinanceModule = require('yahoo-finance2').default ?? require('yahoo-finance2');
        try {
            _defaultYahooFinance = new YahooFinanceModule();
        }
        catch {
            _defaultYahooFinance = YahooFinanceModule;
        }
        try {
            _defaultYahooFinance.setGlobalConfig?.({ queue: { concurrency: 1 } });
        }
        catch {
            // Ignore if setGlobalConfig is not available
        }
    }
    return _defaultYahooFinance;
}
class YahooFinanceAdapter {
    name = 'yahoo';
    yahooFinance;
    constructor(yahooFinanceClient) {
        this.yahooFinance = yahooFinanceClient ?? getDefaultYahooFinance();
    }
    async getQuote(ticker) {
        const normalized = ticker.toUpperCase();
        try {
            const quote = await this.yahooFinance.quote(normalized);
            if (!quote || quote.regularMarketPrice == null) {
                return {
                    success: false,
                    error: `${types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE}: No price data available for '${normalized}'`,
                };
            }
            return {
                success: true,
                data: {
                    ticker: normalized,
                    price: quote.regularMarketPrice,
                    timestamp: new Date().toISOString(),
                },
            };
        }
        catch (err) {
            return classifyError(err);
        }
    }
    async getQuotes(tickers) {
        if (tickers.length === 0) {
            return { success: true, data: new Map() };
        }
        const normalized = tickers.map((t) => t.toUpperCase());
        try {
            const quotes = await this.yahooFinance.quote(normalized);
            const results = new Map();
            const timestamp = new Date().toISOString();
            const quoteArray = Array.isArray(quotes) ? quotes : [quotes];
            for (const quote of quoteArray) {
                if (quote && quote.symbol && quote.regularMarketPrice != null) {
                    const sym = quote.symbol.toUpperCase();
                    results.set(sym, {
                        ticker: sym,
                        price: quote.regularMarketPrice,
                        timestamp,
                    });
                }
            }
            return { success: true, data: results };
        }
        catch (err) {
            return classifyError(err);
        }
    }
    async getHistoricalData(ticker, period, interval) {
        const actualPeriod = period ?? '1y';
        const actualInterval = interval ?? '1d';
        if (!types_js_1.VALID_PERIODS.includes(actualPeriod)) {
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.INVALID_PARAM_RANGE}: Invalid period '${actualPeriod}'. Valid values: ${types_js_1.VALID_PERIODS.join(', ')}`,
            };
        }
        if (!types_js_1.VALID_INTERVALS.includes(actualInterval)) {
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.INVALID_PARAM_RANGE}: Invalid interval '${actualInterval}'. Valid values: ${types_js_1.VALID_INTERVALS.join(', ')}`,
            };
        }
        const normalized = ticker.toUpperCase();
        const period1 = computePeriodStartDate(actualPeriod);
        try {
            const response = await this.yahooFinance.chart(normalized, {
                period1,
                interval: actualInterval,
            });
            if (!response || !response.quotes || !Array.isArray(response.quotes) || response.quotes.length === 0) {
                return {
                    success: true,
                    data: { ticker: normalized, interval: actualInterval, dataPoints: [] },
                };
            }
            const dataPoints = response.quotes
                .filter((q) => q.date != null &&
                q.open != null &&
                q.high != null &&
                q.low != null &&
                q.close != null &&
                q.volume != null)
                .map((q) => ({
                date: toISODateString(q.date),
                open: q.open,
                high: q.high,
                low: q.low,
                close: q.close,
                volume: q.volume,
            }))
                .sort((a, b) => a.date.localeCompare(b.date));
            return {
                success: true,
                data: { ticker: normalized, interval: actualInterval, dataPoints },
            };
        }
        catch (err) {
            return classifyError(err);
        }
    }
    async validateTicker(ticker) {
        const normalized = ticker.toUpperCase();
        try {
            const quote = await this.yahooFinance.quote(normalized);
            if (quote && quote.regularMarketPrice != null) {
                return { success: true, data: true };
            }
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.INVALID_TICKER}: Ticker symbol '${normalized}' not found in price feed`,
            };
        }
        catch (err) {
            return classifyError(err);
        }
    }
}
exports.YahooFinanceAdapter = YahooFinanceAdapter;
// ============================================================
// Helper Functions
// ============================================================
/**
 * Classify a caught error into the appropriate ErrorResult.
 */
function classifyError(err) {
    const message = err instanceof Error ? err.message : String(err);
    if ((0, price_feed_client_js_1.isInvalidTickerError)(err)) {
        return {
            success: false,
            error: `${types_js_1.ErrorCodes.INVALID_TICKER}: ${message}`,
        };
    }
    return {
        success: false,
        error: `${types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE}: ${message}`,
    };
}
/**
 * Compute the start date by subtracting the given period from the current date.
 */
function computePeriodStartDate(period) {
    const now = new Date();
    switch (period) {
        case '1mo':
            now.setMonth(now.getMonth() - 1);
            break;
        case '3mo':
            now.setMonth(now.getMonth() - 3);
            break;
        case '6mo':
            now.setMonth(now.getMonth() - 6);
            break;
        case '1y':
            now.setFullYear(now.getFullYear() - 1);
            break;
        case '2y':
            now.setFullYear(now.getFullYear() - 2);
            break;
        case '5y':
            now.setFullYear(now.getFullYear() - 5);
            break;
    }
    return now;
}
/**
 * Convert a Date object to an ISO 8601 date string (YYYY-MM-DD).
 */
function toISODateString(date) {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toISOString().split('T')[0];
}
//# sourceMappingURL=yahoo-finance-adapter.js.map