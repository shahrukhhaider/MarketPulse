import type { PricePoint, HistoricalPeriod, HistoricalInterval, HistoricalData } from './types.js';
import type { Result } from './config-store.js';
/**
 * Abstraction over the yahoo-finance2 client for dependency injection.
 * Only the `quote` method is needed.
 */
export interface YahooFinanceClient {
    quote(symbol: string | string[], options?: Record<string, unknown>): Promise<any>;
    chart(symbol: string, options?: Record<string, unknown>): Promise<any>;
}
/**
 * Determine whether an error from yahoo-finance2 indicates an invalid/unknown ticker symbol.
 * Checks error message patterns and known error types from the library.
 */
export declare function isInvalidTickerError(err: unknown): boolean;
export declare class PriceFeedClient {
    private available;
    private yahooFinance;
    constructor(yahooFinanceClient?: YahooFinanceClient);
    /**
     * Set feed availability (useful for testing).
     */
    setAvailable(available: boolean): void;
    /**
     * Validate whether a ticker symbol exists on Yahoo Finance.
     */
    validateTicker(ticker: string): Promise<Result<boolean>>;
    /**
     * Fetch the current price for a single ticker from Yahoo Finance.
     */
    fetchCurrentPrice(ticker: string): Promise<Result<PricePoint>>;
    /**
     * Fetch current prices for multiple tickers in a single batch call.
     * Returns a map of ticker -> PricePoint for all tickers with valid quotes.
     * Silently skips tickers without valid price data.
     */
    fetchBatchPrices(tickers: string[]): Promise<Result<Map<string, PricePoint>>>;
    /**
     * Fetch historical OHLCV price data for a ticker over a given period and interval.
     */
    fetchHistoricalData(ticker: string, period?: HistoricalPeriod, interval?: HistoricalInterval): Promise<Result<HistoricalData>>;
}
//# sourceMappingURL=price-feed-client.d.ts.map