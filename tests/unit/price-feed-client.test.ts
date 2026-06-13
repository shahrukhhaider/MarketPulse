import { describe, it, expect, vi } from 'vitest';
import { PriceFeedClient } from '../../src/data/price-feed-client.js';
import type { YahooFinanceClient } from '../../src/data/price-feed-client.js';
import { ErrorCodes, VALID_PERIODS, VALID_INTERVALS } from '../../src/types.js';

/**
 * Helper to create a mock YahooFinanceClient with configurable chart response.
 */
function createMockClient(chartResponse?: any): YahooFinanceClient {
  return {
    quote: vi.fn().mockResolvedValue({ regularMarketPrice: 150 }),
    chart: vi.fn().mockResolvedValue(
      chartResponse ?? {
        quotes: [
          { date: new Date('2024-01-15'), open: 100, high: 105, low: 99, close: 103, volume: 1000000 },
          { date: new Date('2024-01-16'), open: 103, high: 108, low: 101, close: 107, volume: 1200000 },
        ],
      }
    ),
  };
}

describe('PriceFeedClient – fetchHistoricalData', () => {
  // ── Defaults ──────────────────────────────────────────────────────

  it('defaults period to 1y when omitted', async () => {
    const mock = createMockClient();
    const client = new PriceFeedClient(mock);

    const result = await client.fetchHistoricalData('AAPL');
    expect(result.success).toBe(true);
    // The chart call should have been made (period defaulted internally)
    expect(mock.chart).toHaveBeenCalledTimes(1);
  });

  it('defaults interval to 1d when omitted', async () => {
    const mock = createMockClient();
    const client = new PriceFeedClient(mock);

    const result = await client.fetchHistoricalData('AAPL');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interval).toBe('1d');
    }
  });

  // ── Valid period values ───────────────────────────────────────────

  it.each(VALID_PERIODS)('accepts valid period "%s"', async (period) => {
    const mock = createMockClient();
    const client = new PriceFeedClient(mock);

    const result = await client.fetchHistoricalData('AAPL', period, '1d');
    expect(result.success).toBe(true);
    expect(mock.chart).toHaveBeenCalledTimes(1);
  });

  // ── Valid interval values ─────────────────────────────────────────

  it.each(VALID_INTERVALS)('accepts valid interval "%s"', async (interval) => {
    const mock = createMockClient();
    const client = new PriceFeedClient(mock);

    const result = await client.fetchHistoricalData('AAPL', '1y', interval);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.interval).toBe(interval);
    }
  });

  // ── Empty response ────────────────────────────────────────────────

  it('returns empty dataPoints when chart response has no quotes', async () => {
    const mock = createMockClient({ quotes: [] });
    const client = new PriceFeedClient(mock);

    const result = await client.fetchHistoricalData('AAPL', '1y', '1d');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dataPoints).toEqual([]);
    }
  });

  // ── Constructor with mock DI ──────────────────────────────────────

  it('constructs with a mock YahooFinanceClient that includes chart', async () => {
    const mock = createMockClient();
    const client = new PriceFeedClient(mock);

    const result = await client.fetchHistoricalData('MSFT', '3mo', '1wk');
    expect(result.success).toBe(true);
    expect(mock.chart).toHaveBeenCalledWith('MSFT', expect.objectContaining({ interval: '1wk' }));
  });

  // ── Invalid period ────────────────────────────────────────────────

  it('returns INVALID_PARAM_RANGE for an invalid period', async () => {
    const mock = createMockClient();
    const client = new PriceFeedClient(mock);

    const result = await client.fetchHistoricalData('AAPL', '10y' as any, '1d');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain(ErrorCodes.INVALID_PARAM_RANGE);
    }
    expect(mock.chart).not.toHaveBeenCalled();
  });

  // ── Invalid interval ──────────────────────────────────────────────

  it('returns INVALID_PARAM_RANGE for an invalid interval', async () => {
    const mock = createMockClient();
    const client = new PriceFeedClient(mock);

    const result = await client.fetchHistoricalData('AAPL', '1y', '5m' as any);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain(ErrorCodes.INVALID_PARAM_RANGE);
    }
    expect(mock.chart).not.toHaveBeenCalled();
  });

  // ── setAvailable(false) ───────────────────────────────────────────

  it('returns PRICE_FEED_UNAVAILABLE when setAvailable(false)', async () => {
    const mock = createMockClient();
    const client = new PriceFeedClient(mock);
    client.setAvailable(false);

    const result = await client.fetchHistoricalData('AAPL', '1y', '1d');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain(ErrorCodes.PRICE_FEED_UNAVAILABLE);
    }
    expect(mock.chart).not.toHaveBeenCalled();
  });

  // ── Ticker normalization ──────────────────────────────────────────

  it('normalizes ticker to uppercase', async () => {
    const mock = createMockClient();
    const client = new PriceFeedClient(mock);

    const result = await client.fetchHistoricalData('aapl', '1y', '1d');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ticker).toBe('AAPL');
    }
    expect(mock.chart).toHaveBeenCalledWith('AAPL', expect.any(Object));
  });

  // ── Incomplete OHLCV filtering ────────────────────────────────────

  it('filters out entries with null OHLCV fields', async () => {
    const mock = createMockClient({
      quotes: [
        { date: new Date('2024-01-15T12:00:00Z'), open: 100, high: 105, low: 99, close: 103, volume: 1000000 },
        { date: new Date('2024-01-16T12:00:00Z'), open: null, high: 108, low: 101, close: 107, volume: 1200000 },
        { date: new Date('2024-01-17T12:00:00Z'), open: 110, high: null, low: 108, close: 112, volume: 900000 },
        { date: new Date('2024-01-18T12:00:00Z'), open: 112, high: 115, low: null, close: 114, volume: 800000 },
        { date: new Date('2024-01-19T12:00:00Z'), open: 114, high: 118, low: 112, close: null, volume: 700000 },
        { date: new Date('2024-01-20T12:00:00Z'), open: 116, high: 120, low: 114, close: 118, volume: null },
        { date: new Date('2024-01-21T12:00:00Z'), open: 118, high: 122, low: 116, close: 120, volume: 600000 },
      ],
    });
    const client = new PriceFeedClient(mock);

    const result = await client.fetchHistoricalData('AAPL', '1y', '1d');
    expect(result.success).toBe(true);
    if (result.success) {
      // Only the 2 complete entries should remain
      expect(result.data.dataPoints).toHaveLength(2);
      expect(result.data.dataPoints[0].date).toBe('2024-01-15');
      expect(result.data.dataPoints[1].date).toBe('2024-01-21');
    }
  });

  // ── Error classification ──────────────────────────────────────────

  it('classifies "not found" error as INVALID_TICKER', async () => {
    const mock: YahooFinanceClient = {
      quote: vi.fn(),
      chart: vi.fn().mockRejectedValue(new Error('Ticker symbol not found')),
    };
    const client = new PriceFeedClient(mock);

    const result = await client.fetchHistoricalData('ZZZZZ', '1y', '1d');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain(ErrorCodes.INVALID_TICKER);
      expect(result.error).toContain('not found');
    }
  });

  it('classifies network error as PRICE_FEED_UNAVAILABLE', async () => {
    const mock: YahooFinanceClient = {
      quote: vi.fn(),
      chart: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const client = new PriceFeedClient(mock);

    const result = await client.fetchHistoricalData('AAPL', '1y', '1d');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain(ErrorCodes.PRICE_FEED_UNAVAILABLE);
    }
  });
});
