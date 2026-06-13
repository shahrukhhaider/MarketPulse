import type { DataProvider, QuoteResult, HistoricalResult } from './data-provider.js';
import type { YahooFinanceClient } from './price-feed-client.js';
import { isInvalidTickerError } from './price-feed-client.js';
import type { Result } from './config-store.js';
import type { HistoricalPeriod, HistoricalInterval, HistoricalDataPoint } from '../types.js';
import { ErrorCodes, VALID_PERIODS, VALID_INTERVALS } from '../types.js';

// yahoo-finance2 v3 exports a class constructor; v2 exported a pre-built instance.
// Lazy-load the default client only when needed (avoids import side-effects in tests).
let _defaultYahooFinance: YahooFinanceClient | undefined;
function getDefaultYahooFinance(): YahooFinanceClient {
  if (!_defaultYahooFinance) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const YahooFinanceModule = require('yahoo-finance2').default ?? require('yahoo-finance2');
    try {
      _defaultYahooFinance = new (YahooFinanceModule as any)() as YahooFinanceClient;
    } catch {
      _defaultYahooFinance = YahooFinanceModule as unknown as YahooFinanceClient;
    }
    try {
      (_defaultYahooFinance as any).setGlobalConfig?.({ queue: { concurrency: 1 } });
    } catch {
      // Ignore if setGlobalConfig is not available
    }
  }
  return _defaultYahooFinance;
}

export class YahooFinanceAdapter implements DataProvider {
  readonly name = 'yahoo';
  private yahooFinance: YahooFinanceClient;

  constructor(yahooFinanceClient?: YahooFinanceClient) {
    this.yahooFinance = yahooFinanceClient ?? getDefaultYahooFinance();
  }

  async getQuote(ticker: string): Promise<Result<QuoteResult>> {
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
      return classifyError(err);
    }
  }

  async getQuotes(tickers: string[]): Promise<Result<Map<string, QuoteResult>>> {
    if (tickers.length === 0) {
      return { success: true, data: new Map() };
    }

    const normalized = tickers.map((t) => t.toUpperCase());

    try {
      const quotes = await this.yahooFinance.quote(normalized);
      const results = new Map<string, QuoteResult>();
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
      return classifyError(err);
    }
  }

  async getHistoricalData(
    ticker: string,
    period?: HistoricalPeriod,
    interval?: HistoricalInterval
  ): Promise<Result<HistoricalResult>> {
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
      return classifyError(err);
    }
  }

  /**
   * Fetch historical data for a specific date range using explicit start/end dates.
   * Calls chart() with period1/period2 instead of a relative period string.
   */
  async getHistoricalDataByDateRange(
    ticker: string,
    startDate: string,   // ISO date "YYYY-MM-DD"
    endDate: string,     // ISO date "YYYY-MM-DD"
    interval: HistoricalInterval = '1d'
  ): Promise<Result<HistoricalResult>> {
    const normalized = ticker.toUpperCase();
    const period1 = new Date(startDate);
    // Add 1 day to endDate to make it inclusive (chart API uses exclusive end)
    const endDateObj = new Date(endDate);
    endDateObj.setDate(endDateObj.getDate() + 1);
    const period2 = endDateObj;

    try {
      const response = await this.yahooFinance.chart(normalized, {
        period1,
        period2,
        interval,
      });

      if (!response || !response.quotes || !Array.isArray(response.quotes) || response.quotes.length === 0) {
        return {
          success: true,
          data: { ticker: normalized, interval, dataPoints: [] },
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
        data: { ticker: normalized, interval, dataPoints },
      };
    } catch (err: unknown) {
      return classifyError(err);
    }
  }

  async validateTicker(ticker: string): Promise<Result<boolean>> {
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
      return classifyError(err);
    }
  }
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Classify a caught error into the appropriate ErrorResult.
 */
function classifyError(err: unknown): { success: false; error: string } {
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
 * Convert a Date object to an ISO 8601 date string (YYYY-MM-DD) in Pacific time.
 */
function toISODateString(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(d);
}
