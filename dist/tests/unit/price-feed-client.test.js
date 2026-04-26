"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const price_feed_client_js_1 = require("../../src/price-feed-client.js");
const types_js_1 = require("../../src/types.js");
/**
 * Helper to create a mock YahooFinanceClient with configurable chart response.
 */
function createMockClient(chartResponse) {
    return {
        quote: vitest_1.vi.fn().mockResolvedValue({ regularMarketPrice: 150 }),
        chart: vitest_1.vi.fn().mockResolvedValue(chartResponse ?? {
            quotes: [
                { date: new Date('2024-01-15'), open: 100, high: 105, low: 99, close: 103, volume: 1000000 },
                { date: new Date('2024-01-16'), open: 103, high: 108, low: 101, close: 107, volume: 1200000 },
            ],
        }),
    };
}
(0, vitest_1.describe)('PriceFeedClient – fetchHistoricalData', () => {
    // ── Defaults ──────────────────────────────────────────────────────
    (0, vitest_1.it)('defaults period to 1y when omitted', async () => {
        const mock = createMockClient();
        const client = new price_feed_client_js_1.PriceFeedClient(mock);
        const result = await client.fetchHistoricalData('AAPL');
        (0, vitest_1.expect)(result.success).toBe(true);
        // The chart call should have been made (period defaulted internally)
        (0, vitest_1.expect)(mock.chart).toHaveBeenCalledTimes(1);
    });
    (0, vitest_1.it)('defaults interval to 1d when omitted', async () => {
        const mock = createMockClient();
        const client = new price_feed_client_js_1.PriceFeedClient(mock);
        const result = await client.fetchHistoricalData('AAPL');
        (0, vitest_1.expect)(result.success).toBe(true);
        if (result.success) {
            (0, vitest_1.expect)(result.data.interval).toBe('1d');
        }
    });
    // ── Valid period values ───────────────────────────────────────────
    vitest_1.it.each(types_js_1.VALID_PERIODS)('accepts valid period "%s"', async (period) => {
        const mock = createMockClient();
        const client = new price_feed_client_js_1.PriceFeedClient(mock);
        const result = await client.fetchHistoricalData('AAPL', period, '1d');
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(mock.chart).toHaveBeenCalledTimes(1);
    });
    // ── Valid interval values ─────────────────────────────────────────
    vitest_1.it.each(types_js_1.VALID_INTERVALS)('accepts valid interval "%s"', async (interval) => {
        const mock = createMockClient();
        const client = new price_feed_client_js_1.PriceFeedClient(mock);
        const result = await client.fetchHistoricalData('AAPL', '1y', interval);
        (0, vitest_1.expect)(result.success).toBe(true);
        if (result.success) {
            (0, vitest_1.expect)(result.data.interval).toBe(interval);
        }
    });
    // ── Empty response ────────────────────────────────────────────────
    (0, vitest_1.it)('returns empty dataPoints when chart response has no quotes', async () => {
        const mock = createMockClient({ quotes: [] });
        const client = new price_feed_client_js_1.PriceFeedClient(mock);
        const result = await client.fetchHistoricalData('AAPL', '1y', '1d');
        (0, vitest_1.expect)(result.success).toBe(true);
        if (result.success) {
            (0, vitest_1.expect)(result.data.dataPoints).toEqual([]);
        }
    });
    // ── Constructor with mock DI ──────────────────────────────────────
    (0, vitest_1.it)('constructs with a mock YahooFinanceClient that includes chart', async () => {
        const mock = createMockClient();
        const client = new price_feed_client_js_1.PriceFeedClient(mock);
        const result = await client.fetchHistoricalData('MSFT', '3mo', '1wk');
        (0, vitest_1.expect)(result.success).toBe(true);
        (0, vitest_1.expect)(mock.chart).toHaveBeenCalledWith('MSFT', vitest_1.expect.objectContaining({ interval: '1wk' }));
    });
    // ── Invalid period ────────────────────────────────────────────────
    (0, vitest_1.it)('returns INVALID_PARAM_RANGE for an invalid period', async () => {
        const mock = createMockClient();
        const client = new price_feed_client_js_1.PriceFeedClient(mock);
        const result = await client.fetchHistoricalData('AAPL', '10y', '1d');
        (0, vitest_1.expect)(result.success).toBe(false);
        if (!result.success) {
            (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
        }
        (0, vitest_1.expect)(mock.chart).not.toHaveBeenCalled();
    });
    // ── Invalid interval ──────────────────────────────────────────────
    (0, vitest_1.it)('returns INVALID_PARAM_RANGE for an invalid interval', async () => {
        const mock = createMockClient();
        const client = new price_feed_client_js_1.PriceFeedClient(mock);
        const result = await client.fetchHistoricalData('AAPL', '1y', '5m');
        (0, vitest_1.expect)(result.success).toBe(false);
        if (!result.success) {
            (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
        }
        (0, vitest_1.expect)(mock.chart).not.toHaveBeenCalled();
    });
    // ── setAvailable(false) ───────────────────────────────────────────
    (0, vitest_1.it)('returns PRICE_FEED_UNAVAILABLE when setAvailable(false)', async () => {
        const mock = createMockClient();
        const client = new price_feed_client_js_1.PriceFeedClient(mock);
        client.setAvailable(false);
        const result = await client.fetchHistoricalData('AAPL', '1y', '1d');
        (0, vitest_1.expect)(result.success).toBe(false);
        if (!result.success) {
            (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE);
        }
        (0, vitest_1.expect)(mock.chart).not.toHaveBeenCalled();
    });
    // ── Ticker normalization ──────────────────────────────────────────
    (0, vitest_1.it)('normalizes ticker to uppercase', async () => {
        const mock = createMockClient();
        const client = new price_feed_client_js_1.PriceFeedClient(mock);
        const result = await client.fetchHistoricalData('aapl', '1y', '1d');
        (0, vitest_1.expect)(result.success).toBe(true);
        if (result.success) {
            (0, vitest_1.expect)(result.data.ticker).toBe('AAPL');
        }
        (0, vitest_1.expect)(mock.chart).toHaveBeenCalledWith('AAPL', vitest_1.expect.any(Object));
    });
    // ── Incomplete OHLCV filtering ────────────────────────────────────
    (0, vitest_1.it)('filters out entries with null OHLCV fields', async () => {
        const mock = createMockClient({
            quotes: [
                { date: new Date('2024-01-15'), open: 100, high: 105, low: 99, close: 103, volume: 1000000 },
                { date: new Date('2024-01-16'), open: null, high: 108, low: 101, close: 107, volume: 1200000 },
                { date: new Date('2024-01-17'), open: 110, high: null, low: 108, close: 112, volume: 900000 },
                { date: new Date('2024-01-18'), open: 112, high: 115, low: null, close: 114, volume: 800000 },
                { date: new Date('2024-01-19'), open: 114, high: 118, low: 112, close: null, volume: 700000 },
                { date: new Date('2024-01-20'), open: 116, high: 120, low: 114, close: 118, volume: null },
                { date: new Date('2024-01-21'), open: 118, high: 122, low: 116, close: 120, volume: 600000 },
            ],
        });
        const client = new price_feed_client_js_1.PriceFeedClient(mock);
        const result = await client.fetchHistoricalData('AAPL', '1y', '1d');
        (0, vitest_1.expect)(result.success).toBe(true);
        if (result.success) {
            // Only the 2 complete entries should remain
            (0, vitest_1.expect)(result.data.dataPoints).toHaveLength(2);
            (0, vitest_1.expect)(result.data.dataPoints[0].date).toBe('2024-01-15');
            (0, vitest_1.expect)(result.data.dataPoints[1].date).toBe('2024-01-21');
        }
    });
    // ── Error classification ──────────────────────────────────────────
    (0, vitest_1.it)('classifies "not found" error as INVALID_TICKER', async () => {
        const mock = {
            quote: vitest_1.vi.fn(),
            chart: vitest_1.vi.fn().mockRejectedValue(new Error('Ticker symbol not found')),
        };
        const client = new price_feed_client_js_1.PriceFeedClient(mock);
        const result = await client.fetchHistoricalData('ZZZZZ', '1y', '1d');
        (0, vitest_1.expect)(result.success).toBe(false);
        if (!result.success) {
            (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.INVALID_TICKER);
            (0, vitest_1.expect)(result.error).toContain('not found');
        }
    });
    (0, vitest_1.it)('classifies network error as PRICE_FEED_UNAVAILABLE', async () => {
        const mock = {
            quote: vitest_1.vi.fn(),
            chart: vitest_1.vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        };
        const client = new price_feed_client_js_1.PriceFeedClient(mock);
        const result = await client.fetchHistoricalData('AAPL', '1y', '1d');
        (0, vitest_1.expect)(result.success).toBe(false);
        if (!result.success) {
            (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE);
        }
    });
});
//# sourceMappingURL=price-feed-client.test.js.map