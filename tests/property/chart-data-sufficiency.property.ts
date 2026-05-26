import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import type { SignalInput, ChartImageGeneratorDeps } from '../../src/chart-types.js';
import type { DataProvider } from '../../src/data/data-provider.js';
import type { HistoricalDataPoint } from '../../src/types.js';

// ============================================================
// Mock puppeteer to avoid launching a real browser.
// The data validation path runs AFTER puppeteer loads but BEFORE
// any actual page rendering, so we provide a minimal fake browser.
// ============================================================

vi.mock('puppeteer', () => {
  const mockPage = {
    setViewport: vi.fn().mockResolvedValue(undefined),
    setContent: vi.fn().mockResolvedValue(undefined),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    screenshot: vi.fn().mockResolvedValue(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
    close: vi.fn().mockResolvedValue(undefined),
  };

  const mockBrowser = {
    newPage: vi.fn().mockResolvedValue(mockPage),
    close: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };

  return {
    default: {
      launch: vi.fn().mockResolvedValue(mockBrowser),
    },
    launch: vi.fn().mockResolvedValue(mockBrowser),
  };
});

// ============================================================
// Generators
// ============================================================

/** Generator for valid ticker strings: 1-10 uppercase alphabetic characters */
const arbTicker = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')),
  { minLength: 1, maxLength: 10 }
);

/** Generator for strategy strings */
const arbStrategy = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')
  ),
  { minLength: 1, maxLength: 20 }
);

/** Generator for a number of data points between 0 and 19 (insufficient) */
const arbInsufficientCount = fc.integer({ min: 0, max: 19 });

/** Generator for a valid price (positive number) */
const arbPrice = fc.double({ min: 1, max: 1000, noNaN: true, noDefaultInfinity: true });

/** Generator for an error message string */
const arbErrorMessage = fc.stringOf(
  fc.constantFrom(
    ...'abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789:.-_/'.split('')
  ),
  { minLength: 1, maxLength: 80 }
);

/** Generate a single valid HistoricalDataPoint */
function generateDataPoint(index: number): HistoricalDataPoint {
  const baseDate = new Date(2024, 0, 1 + index);
  return {
    date: baseDate.toISOString().split('T')[0],
    open: 100 + index,
    high: 105 + index,
    low: 95 + index,
    close: 102 + index,
    volume: 1000000 + index * 10000,
  };
}

/** Generate N data points */
function generateDataPoints(count: number): HistoricalDataPoint[] {
  return Array.from({ length: count }, (_, i) => generateDataPoint(i));
}

/** Create a SignalInput from generated values */
function makeSignalInput(ticker: string, strategy: string): SignalInput {
  return {
    ticker,
    strategy,
    entry: 100,
    stop: 95,
    target: 110,
  };
}

/** Create a mock data provider that returns a configurable number of data points */
function createInsufficientDataProvider(
  ticker: string,
  count: number
): DataProvider {
  return {
    name: 'mock-insufficient',
    getQuote: vi.fn(),
    getQuotes: vi.fn(),
    getHistoricalData: vi.fn().mockResolvedValue({
      success: true,
      data: {
        ticker,
        interval: '1d' as const,
        dataPoints: generateDataPoints(count),
      },
    }),
    validateTicker: vi.fn(),
  };
}

/** Create a mock data provider that returns an error */
function createErrorDataProvider(errorMessage: string): DataProvider {
  return {
    name: 'mock-error',
    getQuote: vi.fn(),
    getQuotes: vi.fn(),
    getHistoricalData: vi.fn().mockResolvedValue({
      success: false,
      error: errorMessage,
    }),
    validateTicker: vi.fn(),
  };
}

// ============================================================
// Property Tests
// ============================================================

describe('Feature: discord-signal-charts, Property 8: Data sufficiency validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * **Validates: Requirements 3.2, 3.3**
   *
   * For any ticker where the data provider returns fewer than 20 data points
   * (including zero), the chart generator SHALL return a failure result
   * containing the ticker symbol and the actual count of data points received,
   * without throwing an exception.
   */
  it('returns failure with ticker and count for insufficient data (0-19 points)', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTicker,
        arbStrategy,
        arbInsufficientCount,
        async (ticker, strategy, count) => {
          const { generateChartImages } = await import(
            '../../src/chart-image-generator.js'
          );

          const signal = makeSignalInput(ticker, strategy);
          const dataProvider = createInsufficientDataProvider(ticker, count);
          const deps: ChartImageGeneratorDeps = {
            dataProvider,
            lightweightChartsJs: '// mock lightweight charts js',
          };

          // Should not throw
          const results = await generateChartImages([signal], deps);

          // Should return exactly one result
          expect(results).toHaveLength(1);

          const result = results[0];

          // Should be a failure
          expect(result.success).toBe(false);

          if (!result.success) {
            // Should contain the ticker
            expect(result.ticker).toBe(ticker);

            // Should contain the actual count in the reason
            expect(result.reason).toContain(String(count));
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.2, 3.3**
   *
   * For any ticker where the data provider returns an error, the chart
   * generator SHALL return a failure result containing the ticker and the
   * error string, without throwing an exception.
   */
  it('returns failure with ticker and error string for data fetch errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        arbTicker,
        arbStrategy,
        arbErrorMessage,
        async (ticker, strategy, errorMessage) => {
          const { generateChartImages } = await import(
            '../../src/chart-image-generator.js'
          );

          const signal = makeSignalInput(ticker, strategy);
          const dataProvider = createErrorDataProvider(errorMessage);
          const deps: ChartImageGeneratorDeps = {
            dataProvider,
            lightweightChartsJs: '// mock lightweight charts js',
          };

          // Should not throw
          const results = await generateChartImages([signal], deps);

          // Should return exactly one result
          expect(results).toHaveLength(1);

          const result = results[0];

          // Should be a failure
          expect(result.success).toBe(false);

          if (!result.success) {
            // Should contain the ticker
            expect(result.ticker).toBe(ticker);

            // Should contain the error message in the reason
            expect(result.reason).toContain(errorMessage);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * **Validates: Requirements 3.2, 3.3**
   *
   * The function never throws an exception — it always returns results.
   * Even with multiple signals having insufficient data or errors,
   * all results are returned without exceptions.
   */
  it('never throws exceptions for insufficient data or errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.tuple(arbTicker, arbStrategy), { minLength: 1, maxLength: 5 }),
        arbInsufficientCount,
        async (pairs, count) => {
          const { generateChartImages } = await import(
            '../../src/chart-image-generator.js'
          );

          const signals = pairs.map(([t, s]) => makeSignalInput(t, s));

          // Use a provider that returns insufficient data for all tickers
          const dataProvider: DataProvider = {
            name: 'mock-insufficient-batch',
            getQuote: vi.fn(),
            getQuotes: vi.fn(),
            getHistoricalData: vi.fn().mockResolvedValue({
              success: true,
              data: {
                ticker: 'ANY',
                interval: '1d' as const,
                dataPoints: generateDataPoints(count),
              },
            }),
            validateTicker: vi.fn(),
          };

          const deps: ChartImageGeneratorDeps = {
            dataProvider,
            lightweightChartsJs: '// mock lightweight charts js',
          };

          // Should not throw — wrap in a try/catch to verify
          let threw = false;
          let results: unknown[] = [];
          try {
            results = await generateChartImages(signals, deps);
          } catch {
            threw = true;
          }

          expect(threw).toBe(false);
          expect(results).toHaveLength(signals.length);

          // All results should be failures
          for (const result of results as Array<{ success: boolean }>) {
            expect(result.success).toBe(false);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});
