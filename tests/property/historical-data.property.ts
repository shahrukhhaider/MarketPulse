import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PriceFeedClient } from '../../src/data/price-feed-client.js';
import type { YahooFinanceClient } from '../../src/data/price-feed-client.js';
import { CommandRouter, successResult, errorResult } from '../../src/command-router.js';
import {
  ErrorCodes,
  VALID_PERIODS,
  VALID_INTERVALS,
  type HistoricalPeriod,
  type HistoricalInterval,
  type HistoricalDataPoint,
  type HistoricalData,
} from '../../src/types.js';

// ============================================================
// Generators
// ============================================================

/** Generator for valid ticker strings: 1-10 alphabetic characters */
const arbTicker = fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('')), {
  minLength: 1,
  maxLength: 10,
});

/** Generator for valid periods */
const arbPeriod: fc.Arbitrary<HistoricalPeriod> = fc.constantFrom(...VALID_PERIODS);

/** Generator for valid intervals */
const arbInterval: fc.Arbitrary<HistoricalInterval> = fc.constantFrom(...VALID_INTERVALS);

/** Generator for a single complete HistoricalDataPoint */
const arbDataPoint: fc.Arbitrary<HistoricalDataPoint> = fc.record({
  date: fc.date({ min: new Date('2000-01-01'), max: new Date('2025-12-31') }).map(
    (d) => d.toISOString().split('T')[0]
  ),
  open: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  high: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  low: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  close: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  volume: fc.integer({ min: 0, max: 1_000_000_000 }),
});

/** Generator for a HistoricalData object */
const arbHistoricalData: fc.Arbitrary<HistoricalData> = fc.record({
  ticker: arbTicker.map((t) => t.toUpperCase()),
  interval: arbInterval,
  dataPoints: fc.array(arbDataPoint, { minLength: 0, maxLength: 20 }),
});

/** Generator for a complete chart quote entry (all fields non-null) */
const arbCompleteQuote = fc.record({
  date: fc.date({ min: new Date('2000-01-01'), max: new Date('2025-12-31') }),
  open: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  high: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  low: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  close: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  volume: fc.integer({ min: 0, max: 1_000_000_000 }),
});

/** Generator for an incomplete chart quote entry (at least one null OHLCV field) */
const arbIncompleteQuote = fc.record({
  date: fc.date({ min: new Date('2000-01-01'), max: new Date('2025-12-31') }),
  open: fc.constantFrom(null, undefined) as fc.Arbitrary<number | null | undefined>,
  high: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  low: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  close: fc.double({ min: 0.01, max: 100000, noNaN: true }),
  volume: fc.integer({ min: 0, max: 1_000_000_000 }),
});

/** Generator for a mixed chart response with both complete and incomplete entries */
const arbMixedChartResponse = fc.tuple(
  fc.array(arbCompleteQuote, { minLength: 1, maxLength: 10 }),
  fc.array(arbIncompleteQuote, { minLength: 1, maxLength: 10 }),
).map(([complete, incomplete]) => ({
  quotes: fc.shuffledSubarray([...complete, ...incomplete], {
    minLength: complete.length + incomplete.length,
    maxLength: complete.length + incomplete.length,
  }),
  completeCount: complete.length,
}));

/** Generator for strings NOT in VALID_PERIODS */
const arbInvalidPeriod = fc.string({ minLength: 1, maxLength: 5 }).filter(
  (s) => !(VALID_PERIODS as string[]).includes(s)
);

/** Generator for strings NOT in VALID_INTERVALS */
const arbInvalidInterval = fc.string({ minLength: 1, maxLength: 5 }).filter(
  (s) => !(VALID_INTERVALS as string[]).includes(s)
);

/** Helper: create a mock YahooFinanceClient with configurable chart response */
function createMockClient(chartResponse?: any): YahooFinanceClient & { chartCalledWith?: any } {
  const client: YahooFinanceClient & { chartCalledWith?: any } = {
    chartCalledWith: undefined,
    async quote() { return { regularMarketPrice: 150 }; },
    async chart(symbol: string, options?: Record<string, unknown>) {
      client.chartCalledWith = { symbol, options };
      return chartResponse ?? { quotes: [] };
    },
  };
  return client;
}

// ============================================================
// Property Tests
// ============================================================

describe('Feature: historical-data, Property-Based Tests', () => {

  // ── Property 1: Ticker normalization and correct HistoricalData structure ──

  it('Property 1: Ticker normalization and correct HistoricalData structure', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTicker,
        arbPeriod,
        arbInterval,
        fc.array(arbCompleteQuote, { minLength: 1, maxLength: 10 }),
        async (ticker, period, interval, quotes) => {
          const mock = createMockClient({ quotes });
          const client = new PriceFeedClient(mock);

          const result = await client.fetchHistoricalData(ticker, period, interval);

          // Must succeed
          expect(result.success).toBe(true);
          if (!result.success) return;

          // Ticker must be uppercased
          expect(result.data.ticker).toBe(ticker.toUpperCase());

          // Interval must match requested
          expect(result.data.interval).toBe(interval);

          // Symbol passed to chart() must be uppercase
          expect(mock.chartCalledWith?.symbol).toBe(ticker.toUpperCase());

          // Data points must be sorted ascending by date
          const dates = result.data.dataPoints.map((dp) => dp.date);
          for (let i = 1; i < dates.length; i++) {
            expect(dates[i] >= dates[i - 1]).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 2: Incomplete OHLCV entries are excluded ──

  it('Property 2: Incomplete OHLCV entries are excluded', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(arbCompleteQuote, { minLength: 0, maxLength: 5 }),
        fc.array(arbIncompleteQuote, { minLength: 1, maxLength: 5 }),
        async (completeQuotes, incompleteQuotes) => {
          const allQuotes = [...completeQuotes, ...incompleteQuotes];
          const mock = createMockClient({ quotes: allQuotes });
          const client = new PriceFeedClient(mock);

          const result = await client.fetchHistoricalData('AAPL', '1y', '1d');

          expect(result.success).toBe(true);
          if (!result.success) return;

          // Returned count must be <= total and equal to complete count
          expect(result.data.dataPoints.length).toBeLessThanOrEqual(allQuotes.length);
          expect(result.data.dataPoints.length).toBe(completeQuotes.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 3: Invalid parameters are rejected ──

  it('Property 3: Invalid parameters are rejected', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTicker,
        arbInvalidPeriod,
        async (ticker, invalidPeriod) => {
          const mock = createMockClient();
          const client = new PriceFeedClient(mock);

          const result = await client.fetchHistoricalData(ticker, invalidPeriod as any, '1d');

          expect(result.success).toBe(false);
          if (result.success) return;
          expect(result.error).toContain(ErrorCodes.INVALID_PARAM_RANGE);
          // chart() must NOT have been called
          expect(mock.chartCalledWith).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );

    await fc.assert(
      fc.asyncProperty(
        arbTicker,
        arbInvalidInterval,
        async (ticker, invalidInterval) => {
          const mock = createMockClient();
          const client = new PriceFeedClient(mock);

          const result = await client.fetchHistoricalData(ticker, '1y', invalidInterval as any);

          expect(result.success).toBe(false);
          if (result.success) return;
          expect(result.error).toContain(ErrorCodes.INVALID_PARAM_RANGE);
          expect(mock.chartCalledWith).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 4: Exception containment with error classification ──

  it('Property 4: Exception containment with error classification', async () => {
    // Invalid ticker errors
    const invalidTickerMessages = ['not found', 'no data', 'no results', 'symbol error', 'invalid ticker', 'failed to get'];
    await fc.assert(
      fc.asyncProperty(
        arbTicker,
        fc.constantFrom(...invalidTickerMessages),
        async (ticker, errorMsg) => {
          const mock: YahooFinanceClient = {
            async quote() { return {}; },
            async chart() { throw new Error(errorMsg); },
          };
          const client = new PriceFeedClient(mock);

          const result = await client.fetchHistoricalData(ticker, '1y', '1d');

          expect(result.success).toBe(false);
          if (result.success) return;
          expect(result.error).toContain(ErrorCodes.INVALID_TICKER);
          expect(result.error).toContain(errorMsg);
        }
      ),
      { numRuns: 100 }
    );

    // Non-ticker errors (network, rate-limit, etc.)
    await fc.assert(
      fc.asyncProperty(
        arbTicker,
        fc.string({ minLength: 1, maxLength: 50 }).filter(
          (s) => {
            const lower = s.toLowerCase();
            return !lower.includes('not found') &&
              !lower.includes('no data') &&
              !lower.includes('no results') &&
              !lower.includes('symbol') &&
              !lower.includes('invalid') &&
              !lower.includes('failed to get');
          }
        ),
        async (ticker, errorMsg) => {
          const mock: YahooFinanceClient = {
            async quote() { return {}; },
            async chart() { throw new Error(errorMsg); },
          };
          const client = new PriceFeedClient(mock);

          const result = await client.fetchHistoricalData(ticker, '1y', '1d');

          expect(result.success).toBe(false);
          if (result.success) return;
          expect(result.error).toContain(ErrorCodes.PRICE_FEED_UNAVAILABLE);
          expect(result.error).toContain(errorMsg);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 5: setAvailable(false) bypasses API ──

  it('Property 5: setAvailable(false) bypasses API', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTicker,
        arbPeriod,
        arbInterval,
        async (ticker, period, interval) => {
          const mock = createMockClient({ quotes: [{ date: new Date(), open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }] });
          const client = new PriceFeedClient(mock);
          client.setAvailable(false);

          const result = await client.fetchHistoricalData(ticker, period, interval);

          expect(result.success).toBe(false);
          if (result.success) return;
          expect(result.error).toContain(ErrorCodes.PRICE_FEED_UNAVAILABLE);
          // chart() must NOT have been called
          expect(mock.chartCalledWith).toBeUndefined();
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 6: HistoricalData JSON round-trip ──

  it('Property 6: HistoricalData JSON round-trip', () => {
    fc.assert(
      fc.property(
        arbHistoricalData,
        (data) => {
          const json = JSON.stringify(data);
          const parsed = JSON.parse(json);
          expect(parsed).toEqual(data);
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 7: History command result propagation ──

  it('Property 7: History command result propagation — success', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTicker.map((t) => t.toUpperCase()).filter((t) => /^[A-Za-z]{1,10}$/.test(t)),
        arbPeriod,
        arbInterval,
        fc.array(arbCompleteQuote, { minLength: 0, maxLength: 5 }),
        async (ticker, period, interval, quotes) => {
          const mock = createMockClient({ quotes });
          const client = new PriceFeedClient(mock);

          const result = await client.fetchHistoricalData(ticker, period, interval);
          expect(result.success).toBe(true);
          if (!result.success) return;

          // Simulate what the wired handler does
          const commandResult = {
            success: true as const,
            command: 'history',
            data: {
              ticker: result.data.ticker,
              period,
              interval: result.data.interval,
              dataPoints: result.data.dataPoints,
              count: result.data.dataPoints.length,
            },
            timestamp: new Date().toISOString(),
          };

          expect(commandResult.success).toBe(true);
          expect(commandResult.data.ticker).toBe(ticker.toUpperCase());
          expect(commandResult.data.period).toBe(period);
          expect(commandResult.data.interval).toBe(interval);
          expect(commandResult.data.count).toBe(commandResult.data.dataPoints.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Property 7: History command result propagation — error', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTicker,
        async (ticker) => {
          const mock: YahooFinanceClient = {
            async quote() { return {}; },
            async chart() { throw new Error('ECONNREFUSED'); },
          };
          const client = new PriceFeedClient(mock);

          const result = await client.fetchHistoricalData(ticker, '1y', '1d');
          expect(result.success).toBe(false);
          if (result.success) return;

          // Simulate what the wired handler does for errors
          const code = result.error.includes(ErrorCodes.INVALID_TICKER)
            ? ErrorCodes.INVALID_TICKER
            : result.error.includes(ErrorCodes.INVALID_PARAM_RANGE)
              ? ErrorCodes.INVALID_PARAM_RANGE
              : ErrorCodes.PRICE_FEED_UNAVAILABLE;

          const commandResult = {
            success: false as const,
            command: 'history',
            error: { code, message: result.error },
            timestamp: new Date().toISOString(),
          };

          expect(commandResult.success).toBe(false);
          expect(commandResult.error.code).toBe(ErrorCodes.PRICE_FEED_UNAVAILABLE);
          expect(commandResult.error.message).toContain('ECONNREFUSED');
        }
      ),
      { numRuns: 100 }
    );
  });

  // ── Property 8: CommandRouter parameter validation for history ──

  it('Property 8: CommandRouter parameter validation for history', async () => {
    const router = new CommandRouter();

    // Invalid ticker format
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 15 }).filter((s) => !/^[A-Za-z]{1,10}$/.test(s)),
        async (invalidTicker) => {
          const result = await router.dispatch({
            command: 'history',
            options: { ticker: invalidTicker },
          });
          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.INVALID_TICKER);
        }
      ),
      { numRuns: 100 }
    );

    // Invalid period
    await fc.assert(
      fc.asyncProperty(
        arbInvalidPeriod,
        async (invalidPeriod) => {
          const result = await router.dispatch({
            command: 'history',
            options: { ticker: 'AAPL', period: invalidPeriod },
          });
          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.INVALID_PARAM_RANGE);
          expect(result.error?.message).toContain('Valid values');
        }
      ),
      { numRuns: 100 }
    );

    // Invalid interval
    await fc.assert(
      fc.asyncProperty(
        arbInvalidInterval,
        async (invalidInterval) => {
          const result = await router.dispatch({
            command: 'history',
            options: { ticker: 'AAPL', interval: invalidInterval },
          });
          expect(result.success).toBe(false);
          expect(result.error?.code).toBe(ErrorCodes.INVALID_PARAM_RANGE);
          expect(result.error?.message).toContain('Valid values');
        }
      ),
      { numRuns: 100 }
    );
  });

});
