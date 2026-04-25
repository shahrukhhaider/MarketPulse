import type { PricePoint } from './types.js';
import { ErrorCodes } from './types.js';
import type { Result } from './config-store.js';

// Simulated known tickers for the mock price feed.
// In a real implementation this would call an external API.
const KNOWN_TICKERS = new Set([
  'AAPL', 'GOOGL', 'GOOG', 'MSFT', 'AMZN', 'META', 'TSLA', 'NVDA',
  'JPM', 'V', 'JNJ', 'WMT', 'PG', 'MA', 'UNH', 'HD', 'DIS', 'BAC',
  'XOM', 'PFE', 'KO', 'PEP', 'CSCO', 'INTC', 'NFLX', 'ADBE', 'CRM',
  'AMD', 'ORCL', 'IBM', 'QCOM', 'TXN', 'AVGO', 'COST', 'ABBV',
]);

export class PriceFeedClient {
  private available: boolean = true;
  private knownTickers: Set<string>;

  constructor(knownTickers?: Set<string>) {
    this.knownTickers = knownTickers ?? KNOWN_TICKERS;
  }

  /**
   * Set feed availability (useful for testing).
   */
  setAvailable(available: boolean): void {
    this.available = available;
  }

  /**
   * Validate whether a ticker symbol is known to the price feed.
   */
  validateTicker(ticker: string): Result<boolean> {
    if (!this.available) {
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: Price feed is currently unavailable`,
      };
    }

    const normalized = ticker.toUpperCase();
    if (!this.knownTickers.has(normalized)) {
      return {
        success: false,
        error: `${ErrorCodes.INVALID_TICKER}: Ticker symbol '${normalized}' not found in price feed`,
      };
    }

    return { success: true, data: true };
  }

  /**
   * Fetch the current price for a single ticker.
   * Returns a simulated price point (mock implementation).
   */
  fetchCurrentPrice(ticker: string): Result<PricePoint> {
    if (!this.available) {
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: Price feed is currently unavailable`,
      };
    }

    const normalized = ticker.toUpperCase();
    if (!this.knownTickers.has(normalized)) {
      return {
        success: false,
        error: `${ErrorCodes.INVALID_TICKER}: Ticker symbol '${normalized}' not found in price feed`,
      };
    }

    const price = this.generateMockPrice(normalized);
    return {
      success: true,
      data: {
        ticker: normalized,
        price,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Fetch current prices for multiple tickers in a single batch.
   * Returns a map of ticker -> PricePoint for all valid tickers.
   * Individual ticker failures are included in the partial results.
   */
  fetchBatchPrices(
    tickers: string[]
  ): Result<Map<string, PricePoint>> {
    if (!this.available) {
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: Price feed is currently unavailable`,
      };
    }

    const results = new Map<string, PricePoint>();
    const timestamp = new Date().toISOString();

    for (const ticker of tickers) {
      const normalized = ticker.toUpperCase();
      if (this.knownTickers.has(normalized)) {
        results.set(normalized, {
          ticker: normalized,
          price: this.generateMockPrice(normalized),
          timestamp,
        });
      }
      // Skip unknown tickers silently in batch mode
    }

    return { success: true, data: results };
  }

  /**
   * Generate a deterministic-ish mock price based on ticker hash.
   * This provides a stable base price per ticker with small random variation.
   */
  private generateMockPrice(ticker: string): number {
    let hash = 0;
    for (let i = 0; i < ticker.length; i++) {
      hash = (hash * 31 + ticker.charCodeAt(i)) | 0;
    }
    // Base price between 50 and 500
    const base = 50 + Math.abs(hash % 450);
    // Add small random variation (±2%)
    const variation = 1 + (Math.random() * 0.04 - 0.02);
    return Math.round(base * variation * 100) / 100;
  }
}
