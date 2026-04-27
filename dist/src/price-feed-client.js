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
const yahoo_finance_adapter_js_1 = require("./yahoo-finance-adapter.js");
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
/**
 * Duck-type check: does the argument look like a DataProvider?
 */
function isDataProvider(obj) {
    return (typeof obj === 'object' &&
        obj !== null &&
        typeof obj.name === 'string' &&
        typeof obj.getQuote === 'function');
}
class PriceFeedClient {
    available = true;
    provider;
    constructor(providerOrClient) {
        if (providerOrClient && isDataProvider(providerOrClient)) {
            this.provider = providerOrClient;
        }
        else {
            // Wrap a YahooFinanceClient (or default) in the adapter
            this.provider = new yahoo_finance_adapter_js_1.YahooFinanceAdapter(providerOrClient);
        }
    }
    /**
     * Set feed availability (useful for testing).
     */
    setAvailable(available) {
        this.available = available;
    }
    /**
     * Validate whether a ticker symbol exists.
     */
    async validateTicker(ticker) {
        if (!this.available) {
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE}: Price feed is currently unavailable`,
            };
        }
        try {
            return await this.provider.validateTicker(ticker);
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
     * Fetch the current price for a single ticker.
     */
    async fetchCurrentPrice(ticker) {
        if (!this.available) {
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE}: Price feed is currently unavailable`,
            };
        }
        try {
            const result = await this.provider.getQuote(ticker);
            if (!result.success) {
                return result;
            }
            // Map QuoteResult → PricePoint (structurally compatible)
            return {
                success: true,
                data: {
                    ticker: result.data.ticker,
                    price: result.data.price,
                    timestamp: result.data.timestamp,
                },
            };
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
     * Fetch current prices for multiple tickers in a single batch call.
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
        try {
            const result = await this.provider.getQuotes(tickers);
            if (!result.success) {
                return result;
            }
            // Map Map<string, QuoteResult> → Map<string, PricePoint>
            const pricePoints = new Map();
            for (const [sym, quote] of result.data) {
                pricePoints.set(sym, {
                    ticker: quote.ticker,
                    price: quote.price,
                    timestamp: quote.timestamp,
                });
            }
            return { success: true, data: pricePoints };
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
        try {
            return await this.provider.getHistoricalData(ticker, period, interval);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE}: ${message}`,
            };
        }
    }
}
exports.PriceFeedClient = PriceFeedClient;
//# sourceMappingURL=price-feed-client.js.map