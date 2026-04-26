// @ts-ignore -- yahoo-finance2 is ESM-only; resolved at runtime by vitest/node
import YahooFinanceModule from 'yahoo-finance2';
import type { PricePoint, HistoricalPeriod, HistoricalInterval, HistoricalDataPoint, HistoricalData } from './types.js';
import { ErrorCodes, VALID_PERIODS, VALID_INTERVALS } from './types.js';
import type { Result } from './config-store.js';

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

export class PriceFeedClient {
  private available: boolean = true;
  private yahooFinance: YahooFinanceClient;

  constructor(yahooFinanceClient?: YahooFinanceClient) {
    if (yahooFinanceClient) {
      this.yahooFinance = yahooFinanceClient;
    } else {
      // Use the default yahoo-finance2 v3 instance
      this.yahooFinance = defaultYahooFinance as unknown as YahooFinanceClient;
    }
  }

  /**
   * Set feed availability (useful for testing).
   */
  setAvailable(available: boolean): void {
    this.available = available;
  }

  /**
   * Validate whether a ticker symbol exists on Yahoo Finance.
   */
  async validateTicker(ticker: string): Promise<Result<boolean>> {
    if (!this.available) {
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: Price feed is currently unavailable`,
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
        error: `${ErrorCodes.INVALID_TICKER}: Ticker symbol '${normalized}' not found in price feed`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (isInvalidTickerError(err)) {
        return {
          success: false,
          error: `${ErrorCodes.INVALID_TICKER}: ${message}`,
        };
      }
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: ${message}`,
      };
    }
  }

  /**
   * Fetch the current price for a single ticker from Yahoo Finance.
   */
  async fetchCurrentPrice(ticker: string): Promise<Result<PricePoint>> {
    if (!this.available) {
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: Price feed is currently unavailable`,
      };
    }

    const normalized = ticker.toUpperCase();

    try {
      const quote = await this.yahooFinance.quote(normalized);
      if (!quote || quote.regularMarketPrice == null) {
        return {
          success: false,
          error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: No price data available for '${normalized}'`,
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
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (isInvalidTickerError(err)) {
        return {
          success: false,
          error: `${ErrorCodes.INVALID_TICKER}: ${message}`,
        };
      }
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: ${message}`,
      };
    }
  }

  /**
   * Fetch current prices for multiple tickers in a single batch call.
   * Returns a map of ticker -> PricePoint for all tickers with valid quotes.
   * Silently skips tickers without valid price data.
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

    const normalized = tickers.map((t) => t.toUpperCase());

    try {
      const quotes = await this.yahooFinance.quote(normalized);
      const results = new Map<string, PricePoint>();
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

    const actualPeriod = period ?? '1y';
    const actualInterval = interval ?? '1d';

    if (!VALID_PERIODS.includes(actualPeriod as HistoricalPeriod)) {
      return {
        success: false,
        error: `${ErrorCodes.INVALID_PARAM_RANGE}: Invalid period '${actualPeriod}'. Valid values: ${VALID_PERIODS.join(', ')}`,
      };
    }

    if (!VALID_INTERVALS.includes(actualInterval as HistoricalInterval)) {
      return {
        success: false,
        error: `${ErrorCodes.INVALID_PARAM_RANGE}: Invalid interval '${actualInterval}'. Valid values: ${VALID_INTERVALS.join(', ')}`,
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

      const dataPoints: HistoricalDataPoint[] = response.quotes
        .filter((q: any) =>
          q.date != null &&
          q.open != null &&
          q.high != null &&
          q.low != null &&
          q.close != null &&
          q.volume != null
        )
        .map((q: any) => ({
          date: toISODateString(q.date),
          open: q.open,
          high: q.high,
          low: q.low,
          close: q.close,
          volume: q.volume,
        }))
        .sort((a: HistoricalDataPoint, b: HistoricalDataPoint) => a.date.localeCompare(b.date));

      return {
        success: true,
        data: { ticker: normalized, interval: actualInterval, dataPoints },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (isInvalidTickerError(err)) {
        return {
          success: false,
          error: `${ErrorCodes.INVALID_TICKER}: ${message}`,
        };
      }
      return {
        success: false,
        error: `${ErrorCodes.PRICE_FEED_UNAVAILABLE}: ${message}`,
      };
    }
  }
}

/**
 * Compute the start date by subtracting the given period from the current date.
 */
function computePeriodStartDate(period: HistoricalPeriod): Date {
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
function toISODateString(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toISOString().split('T')[0];
}
