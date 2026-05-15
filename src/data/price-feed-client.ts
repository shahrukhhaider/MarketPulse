// @ts-ignore -- yahoo-finance2 is ESM-only; resolved at runtime by vitest/node
import YahooFinanceModule from 'yahoo-finance2';
import type { PricePoint, HistoricalPeriod, HistoricalInterval, HistoricalData } from '../types.js';
import { ErrorCodes } from '../types.js';
import type { Result } from './config-store.js';
import type { DataProvider, QuoteResult } from './data-provider.js';
import { YahooFinanceAdapter } from './yahoo-finance-adapter.js';

// yahoo-finance2 v3 exports a class constructor; v2 exported a pre-built instance.
// Handle both patterns for backward compatibility.
let defaultYahooFinance: any;
try {
  // v3: constructor-based
  defaultYahooFinance = new (YahooFinanceModule as any)();
} catch {
  // v2 fallback: already an instance
  defaultYahooFinance = YahooFinanceModule;
}

// Suppress the community API notice and limit concurrency
try {
  (defaultYahooFinance as any).setGlobalConfig?.({ queue: { concurrency: 1 } });
} catch {
  // Ignore if setGlobalConfig is not available (e.g. in test environments)
}

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
export function isInvalidTickerError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes('not found') ||
    msg.includes('no data') ||
    msg.includes('no results') ||
    msg.includes('symbol') ||
    msg.includes('invalid') ||
    msg.includes('failed to get')
  );
}

/**
 * Duck-type check: does the argument look like a DataProvider?
 */
function isDataProvider(obj: unknown): obj is DataProvider {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as any).name === 'string' &&
    typeof (obj as any).getQuote === 'function'
  );
}

export class PriceFeedClient {
  private available: boolean = true;
  private provider: DataProvider;

  constructor(providerOrClient?: DataProvider | YahooFinanceClient) {
    if (providerOrClient && isDataProvider(providerOrClient)) {
      this.provider = providerOrClient;
    } else {
      // Wrap a YahooFinanceClient (or default) in the adapter
      this.provider = new YahooFinanceAdapter(
        providerOrClient as YahooFinanceClient | undefined
      );
    }
  }

  /**
   * Set feed availability (useful for testing).
   */
  setAvailable(available: boolean): void {
    this.available = available;
  }

  /**
   * Validate whether a ticker symbol exists.
   */
  async validateTicker(ticker: string): Promise<Result<boolean>> {
    if (!this.available) {
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: Price feed is currently unavailable`,
      };
    }

    try {
      return await this.provider.validateTicker(ticker);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: ${message}`,
      };
    }
  }

  /**
   * Fetch the current price for a single ticker.
   */
  async fetchCurrentPrice(ticker: string): Promise<Result<PricePoint>> {
    if (!this.available) {
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: Price feed is currently unavailable`,
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: ${message}`,
      };
    }
  }

  /**
   * Fetch current prices for multiple tickers in a single batch call.
   */
  async fetchBatchPrices(
    tickers: string[]
  ): Promise<Result<Map<string, PricePoint>>> {
    if (tickers.length === 0) {
      return { success: true, data: new Map() };
    }

    if (!this.available) {
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: Price feed is currently unavailable`,
      };
    }

    try {
      const result = await this.provider.getQuotes(tickers);
      if (!result.success) {
        return result;
      }
      // Map Map<string, QuoteResult> → Map<string, PricePoint>
      const pricePoints = new Map<string, PricePoint>();
      for (const [sym, quote] of result.data) {
        pricePoints.set(sym, {
          ticker: quote.ticker,
          price: quote.price,
          timestamp: quote.timestamp,
        });
      }
      return { success: true, data: pricePoints };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: ${message}`,
      };
    }
  }

  /**
   * Fetch historical OHLCV price data for a ticker over a given period and interval.
   */
  async fetchHistoricalData(
    ticker: string,
    period?: HistoricalPeriod,
    interval?: HistoricalInterval
  ): Promise<Result<HistoricalData>> {
    if (!this.available) {
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: Price feed is currently unavailable`,
      };
    }

    try {
      return await this.provider.getHistoricalData(ticker, period, interval);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: ${message}`,
      };
    }
  }
}
