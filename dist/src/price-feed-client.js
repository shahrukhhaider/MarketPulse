"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PriceFeedClient = void 0;
exports.isInvalidTickerError = isInvalidTickerError;
// @ts-ignore -- yahoo-finance2 is ESM-only; resolved at runtime by vitest/node
const yahoo_finance2_1 = __importDefault(require("yahoo-finance2"));
const types_js_1 = require("./types.js");
// yahoo-finance2 v3 exports a class constructor; v2 exported a pre-built instance.
// Handle both patterns for backward compatibility.
let defaultYahooFinance;
try {
    // v3: constructor-based
    defaultYahooFinance = new yahoo_finance2_1.default();
}
catch {
    // v2 fallback: already an instance
    defaultYahooFinance = yahoo_finance2_1.default;
}
// Suppress the community API notice and limit concurrency
try {
    defaultYahooFinance.setGlobalConfig?.({ queue: { concurrency: 1 } });
}
catch {
    // Ignore if setGlobalConfig is not available (e.g. in test environments)
}
/**
 * Determine whether an error from yahoo-finance2 indicates an invalid/unknown ticker symbol.
 * Checks error message patterns and known error types from the library.
 */
function isInvalidTickerError(err) {
    if (!(err instanceof Error))
        return false;
    const msg = err.message.toLowerCase();
    return (msg.includes('not found') ||
        msg.includes('no data') ||
        msg.includes('no results') ||
        msg.includes('symbol') ||
        msg.includes('invalid') ||
        msg.includes('failed to get'));
}
class PriceFeedClient {
    available = true;
    yahooFinance;
    constructor(yahooFinanceClient) {
        if (yahooFinanceClient) {
            this.yahooFinance = yahooFinanceClient;
        }
        else {
            // Use the default yahoo-finance2 v3 instance
            this.yahooFinance = defaultYahooFinance;
        }
    }
    /**
     * Set feed availability (useful for testing).
     */
    setAvailable(available) {
        this.available = available;
    }
    /**
     * Validate whether a ticker symbol exists on Yahoo Finance.
     */
    async validateTicker(ticker) {
        if (!this.available) {
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE}: Price feed is currently unavailable`,
            };
        }
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
            const message = err instanceof Error ? err.message : String(err);
            if (isInvalidTickerError(err)) {
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
    }
    /**
     * Fetch the current price for a single ticker from Yahoo Finance.
     */
    async fetchCurrentPrice(ticker) {
        if (!this.available) {
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE}: Price feed is currently unavailable`,
            };
        }
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
            const message = err instanceof Error ? err.message : String(err);
            if (isInvalidTickerError(err)) {
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
    }
    /**
     * Fetch current prices for multiple tickers in a single batch call.
     * Returns a map of ticker -> PricePoint for all tickers with valid quotes.
     * Silently skips tickers without valid price data.
     */
    async fetchBatchPrices(tickers) {
        if (tickers.length === 0) {
            return { success: true, data: new Map() };
        }
        if (!this.available) {
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE}: Price feed is currently unavailable`,
            };
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
            const message = err instanceof Error ? err.message : String(err);
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE}: ${message}`,
            };
        }
    }
    /**
     * Fetch historical OHLCV price data for a ticker over a given period and interval.
     */
    async fetchHistoricalData(ticker, period, interval) {
        if (!this.available) {
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE}: Price feed is currently unavailable`,
            };
        }
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
            const message = err instanceof Error ? err.message : String(err);
            if (isInvalidTickerError(err)) {
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
    }
}
exports.PriceFeedClient = PriceFeedClient;
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
//# sourceMappingURL=price-feed-client.js.map