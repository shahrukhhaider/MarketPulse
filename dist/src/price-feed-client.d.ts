import type { PricePoint } from './types.js';
import type { Result } from './config-store.js';
export declare class PriceFeedClient {
    private available;
    private knownTickers;
    constructor(knownTickers?: Set<string>);
    /**
     * Set feed availability (useful for testing).
     */
    setAvailable(available: boolean): void;
    /**
     * Validate whether a ticker symbol is known to the price feed.
     */
    validateTicker(ticker: string): Result<boolean>;
    /**
     * Fetch the current price for a single ticker.
     * Returns a simulated price point (mock implementation).
     */
    fetchCurrentPrice(ticker: string): Result<PricePoint>;
    /**
     * Fetch current prices for multiple tickers in a single batch.
     * Returns a map of ticker -> PricePoint for all valid tickers.
     * Individual ticker failures are included in the partial results.
     */
    fetchBatchPrices(tickers: string[]): Result<Map<string, PricePoint>>;
    /**
     * Generate a deterministic-ish mock price based on ticker hash.
     * This provides a stable base price per ticker with small random variation.
     */
    private generateMockPrice;
}
//# sourceMappingURL=price-feed-client.d.ts.map