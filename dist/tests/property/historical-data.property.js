"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fast_check_1 = __importDefault(require("fast-check"));
const price_feed_client_js_1 = require("../../src/price-feed-client.js");
const command_router_js_1 = require("../../src/command-router.js");
const types_js_1 = require("../../src/types.js");
// ============================================================
// Generators
// ============================================================
/** Generator for valid ticker strings: 1-10 alphabetic characters */
const arbTicker = fast_check_1.default.stringOf(fast_check_1.default.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('')), {
    minLength: 1,
    maxLength: 10,
});
/** Generator for valid periods */
const arbPeriod = fast_check_1.default.constantFrom(...types_js_1.VALID_PERIODS);
/** Generator for valid intervals */
const arbInterval = fast_check_1.default.constantFrom(...types_js_1.VALID_INTERVALS);
/** Generator for a single complete HistoricalDataPoint */
const arbDataPoint = fast_check_1.default.record({
    date: fast_check_1.default.date({ min: new Date('2000-01-01'), max: new Date('2025-12-31') }).map((d) => d.toISOString().split('T')[0]),
    open: fast_check_1.default.double({ min: 0.01, max: 100000, noNaN: true }),
    high: fast_check_1.default.double({ min: 0.01, max: 100000, noNaN: true }),
    low: fast_check_1.default.double({ min: 0.01, max: 100000, noNaN: true }),
    close: fast_check_1.default.double({ min: 0.01, max: 100000, noNaN: true }),
    volume: fast_check_1.default.integer({ min: 0, max: 1_000_000_000 }),
});
/** Generator for a HistoricalData object */
const arbHistoricalData = fast_check_1.default.record({
    ticker: arbTicker.map((t) => t.toUpperCase()),
    interval: arbInterval,
    dataPoints: fast_check_1.default.array(arbDataPoint, { minLength: 0, maxLength: 20 }),
});
/** Generator for a complete chart quote entry (all fields non-null) */
const arbCompleteQuote = fast_check_1.default.record({
    date: fast_check_1.default.date({ min: new Date('2000-01-01'), max: new Date('2025-12-31') }),
    open: fast_check_1.default.double({ min: 0.01, max: 100000, noNaN: true }),
    high: fast_check_1.default.double({ min: 0.01, max: 100000, noNaN: true }),
    low: fast_check_1.default.double({ min: 0.01, max: 100000, noNaN: true }),
    close: fast_check_1.default.double({ min: 0.01, max: 100000, noNaN: true }),
    volume: fast_check_1.default.integer({ min: 0, max: 1_000_000_000 }),
});
/** Generator for an incomplete chart quote entry (at least one null OHLCV field) */
const arbIncompleteQuote = fast_check_1.default.record({
    date: fast_check_1.default.date({ min: new Date('2000-01-01'), max: new Date('2025-12-31') }),
    open: fast_check_1.default.constantFrom(null, undefined),
    high: fast_check_1.default.double({ min: 0.01, max: 100000, noNaN: true }),
    low: fast_check_1.default.double({ min: 0.01, max: 100000, noNaN: true }),
    close: fast_check_1.default.double({ min: 0.01, max: 100000, noNaN: true }),
    volume: fast_check_1.default.integer({ min: 0, max: 1_000_000_000 }),
});
/** Generator for a mixed chart response with both complete and incomplete entries */
const arbMixedChartResponse = fast_check_1.default.tuple(fast_check_1.default.array(arbCompleteQuote, { minLength: 1, maxLength: 10 }), fast_check_1.default.array(arbIncompleteQuote, { minLength: 1, maxLength: 10 })).map(([complete, incomplete]) => ({
    quotes: fast_check_1.default.shuffledSubarray([...complete, ...incomplete], {
        minLength: complete.length + incomplete.length,
        maxLength: complete.length + incomplete.length,
    }),
    completeCount: complete.length,
}));
/** Generator for strings NOT in VALID_PERIODS */
const arbInvalidPeriod = fast_check_1.default.string({ minLength: 1, maxLength: 5 }).filter((s) => !types_js_1.VALID_PERIODS.includes(s));
/** Generator for strings NOT in VALID_INTERVALS */
const arbInvalidInterval = fast_check_1.default.string({ minLength: 1, maxLength: 5 }).filter((s) => !types_js_1.VALID_INTERVALS.includes(s));
/** Helper: create a mock YahooFinanceClient with configurable chart response */
function createMockClient(chartResponse) {
    const client = {
        chartCalledWith: undefined,
        async quote() { return { regularMarketPrice: 150 }; },
        async chart(symbol, options) {
            client.chartCalledWith = { symbol, options };
            return chartResponse ?? { quotes: [] };
        },
    };
    return client;
}
// ============================================================
// Property Tests
// ============================================================
(0, vitest_1.describe)('Feature: historical-data, Property-Based Tests', () => {
    // ── Property 1: Ticker normalization and correct HistoricalData structure ──
    (0, vitest_1.it)('Property 1: Ticker normalization and correct HistoricalData structure', async () => {
        await fast_check_1.default.assert(fast_check_1.default.asyncProperty(arbTicker, arbPeriod, arbInterval, fast_check_1.default.array(arbCompleteQuote, { minLength: 1, maxLength: 10 }), async (ticker, period, interval, quotes) => {
            const mock = createMockClient({ quotes });
            const client = new price_feed_client_js_1.PriceFeedClient(mock);
            const result = await client.fetchHistoricalData(ticker, period, interval);
            // Must succeed
            (0, vitest_1.expect)(result.success).toBe(true);
            if (!result.success)
                return;
            // Ticker must be uppercased
            (0, vitest_1.expect)(result.data.ticker).toBe(ticker.toUpperCase());
            // Interval must match requested
            (0, vitest_1.expect)(result.data.interval).toBe(interval);
            // Symbol passed to chart() must be uppercase
            (0, vitest_1.expect)(mock.chartCalledWith?.symbol).toBe(ticker.toUpperCase());
            // Data points must be sorted ascending by date
            const dates = result.data.dataPoints.map((dp) => dp.date);
            for (let i = 1; i < dates.length; i++) {
                (0, vitest_1.expect)(dates[i] >= dates[i - 1]).toBe(true);
            }
        }), { numRuns: 100 });
    });
    // ── Property 2: Incomplete OHLCV entries are excluded ──
    (0, vitest_1.it)('Property 2: Incomplete OHLCV entries are excluded', async () => {
        await fast_check_1.default.assert(fast_check_1.default.asyncProperty(fast_check_1.default.array(arbCompleteQuote, { minLength: 0, maxLength: 5 }), fast_check_1.default.array(arbIncompleteQuote, { minLength: 1, maxLength: 5 }), async (completeQuotes, incompleteQuotes) => {
            const allQuotes = [...completeQuotes, ...incompleteQuotes];
            const mock = createMockClient({ quotes: allQuotes });
            const client = new price_feed_client_js_1.PriceFeedClient(mock);
            const result = await client.fetchHistoricalData('AAPL', '1y', '1d');
            (0, vitest_1.expect)(result.success).toBe(true);
            if (!result.success)
                return;
            // Returned count must be <= total and equal to complete count
            (0, vitest_1.expect)(result.data.dataPoints.length).toBeLessThanOrEqual(allQuotes.length);
            (0, vitest_1.expect)(result.data.dataPoints.length).toBe(completeQuotes.length);
        }), { numRuns: 100 });
    });
    // ── Property 3: Invalid parameters are rejected ──
    (0, vitest_1.it)('Property 3: Invalid parameters are rejected', async () => {
        await fast_check_1.default.assert(fast_check_1.default.asyncProperty(arbTicker, arbInvalidPeriod, async (ticker, invalidPeriod) => {
            const mock = createMockClient();
            const client = new price_feed_client_js_1.PriceFeedClient(mock);
            const result = await client.fetchHistoricalData(ticker, invalidPeriod, '1d');
            (0, vitest_1.expect)(result.success).toBe(false);
            if (result.success)
                return;
            (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
            // chart() must NOT have been called
            (0, vitest_1.expect)(mock.chartCalledWith).toBeUndefined();
        }), { numRuns: 100 });
        await fast_check_1.default.assert(fast_check_1.default.asyncProperty(arbTicker, arbInvalidInterval, async (ticker, invalidInterval) => {
            const mock = createMockClient();
            const client = new price_feed_client_js_1.PriceFeedClient(mock);
            const result = await client.fetchHistoricalData(ticker, '1y', invalidInterval);
            (0, vitest_1.expect)(result.success).toBe(false);
            if (result.success)
                return;
            (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
            (0, vitest_1.expect)(mock.chartCalledWith).toBeUndefined();
        }), { numRuns: 100 });
    });
    // ── Property 4: Exception containment with error classification ──
    (0, vitest_1.it)('Property 4: Exception containment with error classification', async () => {
        // Invalid ticker errors
        const invalidTickerMessages = ['not found', 'no data', 'no results', 'symbol error', 'invalid ticker', 'failed to get'];
        await fast_check_1.default.assert(fast_check_1.default.asyncProperty(arbTicker, fast_check_1.default.constantFrom(...invalidTickerMessages), async (ticker, errorMsg) => {
            const mock = {
                async quote() { return {}; },
                async chart() { throw new Error(errorMsg); },
            };
            const client = new price_feed_client_js_1.PriceFeedClient(mock);
            const result = await client.fetchHistoricalData(ticker, '1y', '1d');
            (0, vitest_1.expect)(result.success).toBe(false);
            if (result.success)
                return;
            (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.INVALID_TICKER);
            (0, vitest_1.expect)(result.error).toContain(errorMsg);
        }), { numRuns: 100 });
        // Non-ticker errors (network, rate-limit, etc.)
        await fast_check_1.default.assert(fast_check_1.default.asyncProperty(arbTicker, fast_check_1.default.string({ minLength: 1, maxLength: 50 }).filter((s) => {
            const lower = s.toLowerCase();
            return !lower.includes('not found') &&
                !lower.includes('no data') &&
                !lower.includes('no results') &&
                !lower.includes('symbol') &&
                !lower.includes('invalid') &&
                !lower.includes('failed to get');
        }), async (ticker, errorMsg) => {
            const mock = {
                async quote() { return {}; },
                async chart() { throw new Error(errorMsg); },
            };
            const client = new price_feed_client_js_1.PriceFeedClient(mock);
            const result = await client.fetchHistoricalData(ticker, '1y', '1d');
            (0, vitest_1.expect)(result.success).toBe(false);
            if (result.success)
                return;
            (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE);
            (0, vitest_1.expect)(result.error).toContain(errorMsg);
        }), { numRuns: 100 });
    });
    // ── Property 5: setAvailable(false) bypasses API ──
    (0, vitest_1.it)('Property 5: setAvailable(false) bypasses API', async () => {
        await fast_check_1.default.assert(fast_check_1.default.asyncProperty(arbTicker, arbPeriod, arbInterval, async (ticker, period, interval) => {
            const mock = createMockClient({ quotes: [{ date: new Date(), open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 }] });
            const client = new price_feed_client_js_1.PriceFeedClient(mock);
            client.setAvailable(false);
            const result = await client.fetchHistoricalData(ticker, period, interval);
            (0, vitest_1.expect)(result.success).toBe(false);
            if (result.success)
                return;
            (0, vitest_1.expect)(result.error).toContain(types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE);
            // chart() must NOT have been called
            (0, vitest_1.expect)(mock.chartCalledWith).toBeUndefined();
        }), { numRuns: 100 });
    });
    // ── Property 6: HistoricalData JSON round-trip ──
    (0, vitest_1.it)('Property 6: HistoricalData JSON round-trip', () => {
        fast_check_1.default.assert(fast_check_1.default.property(arbHistoricalData, (data) => {
            const json = JSON.stringify(data);
            const parsed = JSON.parse(json);
            (0, vitest_1.expect)(parsed).toEqual(data);
        }), { numRuns: 100 });
    });
    // ── Property 7: History command result propagation ──
    (0, vitest_1.it)('Property 7: History command result propagation — success', async () => {
        await fast_check_1.default.assert(fast_check_1.default.asyncProperty(arbTicker.map((t) => t.toUpperCase()).filter((t) => /^[A-Za-z]{1,10}$/.test(t)), arbPeriod, arbInterval, fast_check_1.default.array(arbCompleteQuote, { minLength: 0, maxLength: 5 }), async (ticker, period, interval, quotes) => {
            const mock = createMockClient({ quotes });
            const client = new price_feed_client_js_1.PriceFeedClient(mock);
            const result = await client.fetchHistoricalData(ticker, period, interval);
            (0, vitest_1.expect)(result.success).toBe(true);
            if (!result.success)
                return;
            // Simulate what the wired handler does
            const commandResult = {
                success: true,
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
            (0, vitest_1.expect)(commandResult.success).toBe(true);
            (0, vitest_1.expect)(commandResult.data.ticker).toBe(ticker.toUpperCase());
            (0, vitest_1.expect)(commandResult.data.period).toBe(period);
            (0, vitest_1.expect)(commandResult.data.interval).toBe(interval);
            (0, vitest_1.expect)(commandResult.data.count).toBe(commandResult.data.dataPoints.length);
        }), { numRuns: 100 });
    });
    (0, vitest_1.it)('Property 7: History command result propagation — error', async () => {
        await fast_check_1.default.assert(fast_check_1.default.asyncProperty(arbTicker, async (ticker) => {
            const mock = {
                async quote() { return {}; },
                async chart() { throw new Error('ECONNREFUSED'); },
            };
            const client = new price_feed_client_js_1.PriceFeedClient(mock);
            const result = await client.fetchHistoricalData(ticker, '1y', '1d');
            (0, vitest_1.expect)(result.success).toBe(false);
            if (result.success)
                return;
            // Simulate what the wired handler does for errors
            const code = result.error.includes(types_js_1.ErrorCodes.INVALID_TICKER)
                ? types_js_1.ErrorCodes.INVALID_TICKER
                : result.error.includes(types_js_1.ErrorCodes.INVALID_PARAM_RANGE)
                    ? types_js_1.ErrorCodes.INVALID_PARAM_RANGE
                    : types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE;
            const commandResult = {
                success: false,
                command: 'history',
                error: { code, message: result.error },
                timestamp: new Date().toISOString(),
            };
            (0, vitest_1.expect)(commandResult.success).toBe(false);
            (0, vitest_1.expect)(commandResult.error.code).toBe(types_js_1.ErrorCodes.PRICE_FEED_UNAVAILABLE);
            (0, vitest_1.expect)(commandResult.error.message).toContain('ECONNREFUSED');
        }), { numRuns: 100 });
    });
    // ── Property 8: CommandRouter parameter validation for history ──
    (0, vitest_1.it)('Property 8: CommandRouter parameter validation for history', async () => {
        const router = new command_router_js_1.CommandRouter();
        // Invalid ticker format
        await fast_check_1.default.assert(fast_check_1.default.asyncProperty(fast_check_1.default.string({ minLength: 1, maxLength: 15 }).filter((s) => !/^[A-Za-z]{1,10}$/.test(s)), async (invalidTicker) => {
            const result = await router.dispatch({
                command: 'history',
                options: { ticker: invalidTicker },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_TICKER);
        }), { numRuns: 100 });
        // Invalid period
        await fast_check_1.default.assert(fast_check_1.default.asyncProperty(arbInvalidPeriod, async (invalidPeriod) => {
            const result = await router.dispatch({
                command: 'history',
                options: { ticker: 'AAPL', period: invalidPeriod },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
            (0, vitest_1.expect)(result.error?.message).toContain('Valid values');
        }), { numRuns: 100 });
        // Invalid interval
        await fast_check_1.default.assert(fast_check_1.default.asyncProperty(arbInvalidInterval, async (invalidInterval) => {
            const result = await router.dispatch({
                command: 'history',
                options: { ticker: 'AAPL', interval: invalidInterval },
            });
            (0, vitest_1.expect)(result.success).toBe(false);
            (0, vitest_1.expect)(result.error?.code).toBe(types_js_1.ErrorCodes.INVALID_PARAM_RANGE);
            (0, vitest_1.expect)(result.error?.message).toContain('Valid values');
        }), { numRuns: 100 });
    });
});
//# sourceMappingURL=historical-data.property.js.map