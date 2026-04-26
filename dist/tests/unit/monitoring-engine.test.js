"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const monitoring_engine_js_1 = require("../../src/monitoring-engine.js");
const price_feed_client_js_1 = require("../../src/price-feed-client.js");
const price_data_store_js_1 = require("../../src/price-data-store.js");
const signal_store_js_1 = require("../../src/signal-store.js");
function makeWatchlistEntry(overrides = {}) {
    return {
        ticker: 'AAPL',
        addedAt: '2025-01-15T10:00:00Z',
        strategies: [],
        ...overrides,
    };
}
/**
 * A simple mock YahooFinanceClient that returns deterministic prices.
 * Uses a hash of the ticker symbol to generate a stable price.
 */
function createMockYahooClient() {
    return {
        async chart() { return { quotes: [] }; },
        async quote(symbol) {
            if (Array.isArray(symbol)) {
                return symbol.map((s) => ({
                    symbol: s.toUpperCase(),
                    regularMarketPrice: getMockPrice(s),
                }));
            }
            return {
                symbol: symbol.toUpperCase(),
                regularMarketPrice: getMockPrice(symbol),
            };
        },
    };
}
function getMockPrice(ticker) {
    // Simple deterministic price based on ticker characters
    let hash = 0;
    for (const ch of ticker.toUpperCase()) {
        hash = (hash * 31 + ch.charCodeAt(0)) % 10000;
    }
    return 100 + (hash % 200); // Price between 100 and 299
}
/** Helper: flush microtask queue so async start() completes its first poll */
function flushMicrotasks() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}
(0, vitest_1.describe)('MonitoringEngine', () => {
    let tmpDir;
    let signalFilePath;
    let priceFeedClient;
    let priceDataStore;
    let engine;
    (0, vitest_1.beforeEach)(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monitoring-engine-test-'));
        signalFilePath = path.join(tmpDir, 'signals-12345.json');
        priceFeedClient = new price_feed_client_js_1.PriceFeedClient(createMockYahooClient());
        priceDataStore = new price_data_store_js_1.PriceDataStore();
        engine = new monitoring_engine_js_1.MonitoringEngine(priceFeedClient, priceDataStore);
    });
    (0, vitest_1.afterEach)(() => {
        engine.stop();
        fs.rmSync(tmpDir, { recursive: true, force: true });
    });
    (0, vitest_1.describe)('start and stop', () => {
        (0, vitest_1.it)('starts and sets running state', async () => {
            engine.start(60, [makeWatchlistEntry()], signalFilePath);
            (0, vitest_1.expect)(engine.isRunning()).toBe(true);
            await flushMicrotasks();
        });
        (0, vitest_1.it)('stops and clears running state', async () => {
            engine.start(60, [makeWatchlistEntry()], signalFilePath);
            await flushMicrotasks();
            engine.stop();
            (0, vitest_1.expect)(engine.isRunning()).toBe(false);
        });
        (0, vitest_1.it)('does nothing when start called while already running', async () => {
            engine.start(60, [makeWatchlistEntry()], signalFilePath);
            await flushMicrotasks();
            const cyclesBefore = engine.getPollCyclesCompleted();
            engine.start(60, [makeWatchlistEntry()], signalFilePath);
            await flushMicrotasks();
            // Should not reset cycles
            (0, vitest_1.expect)(engine.getPollCyclesCompleted()).toBe(cyclesBefore);
        });
        (0, vitest_1.it)('does nothing when stop called while not running', () => {
            (0, vitest_1.expect)(() => engine.stop()).not.toThrow();
        });
        (0, vitest_1.it)('runs first poll immediately on start', async () => {
            engine.start(3600, [makeWatchlistEntry()], signalFilePath);
            await flushMicrotasks();
            (0, vitest_1.expect)(engine.getPollCyclesCompleted()).toBeGreaterThanOrEqual(1);
        });
    });
    (0, vitest_1.describe)('pollCycle', () => {
        (0, vitest_1.it)('returns success with empty watchlist', async () => {
            engine.start(3600, [], signalFilePath);
            await flushMicrotasks();
            // First poll already ran in start, check state
            (0, vitest_1.expect)(engine.getPollCyclesCompleted()).toBe(1);
            (0, vitest_1.expect)(engine.getLastPollTimestamp()).toBeTruthy();
        });
        (0, vitest_1.it)('fetches prices and stores them', async () => {
            const entry = makeWatchlistEntry({ ticker: 'AAPL' });
            engine.start(3600, [entry], signalFilePath);
            await flushMicrotasks();
            const history = priceDataStore.getPriceHistory('AAPL');
            (0, vitest_1.expect)(history.length).toBeGreaterThanOrEqual(1);
            (0, vitest_1.expect)(history[0].ticker).toBe('AAPL');
            (0, vitest_1.expect)(typeof history[0].price).toBe('number');
        });
        (0, vitest_1.it)('calculates price change from previous price', async () => {
            // Seed a previous price
            priceDataStore.addPricePoint('AAPL', {
                ticker: 'AAPL',
                price: 100,
                timestamp: '2025-01-15T09:00:00Z',
            });
            const entry = makeWatchlistEntry({ ticker: 'AAPL' });
            engine.start(3600, [entry], signalFilePath);
            await flushMicrotasks();
            const history = priceDataStore.getPriceHistory('AAPL');
            const latest = history[history.length - 1];
            // Should have change and changePercent calculated
            (0, vitest_1.expect)(latest.change).toBeDefined();
            (0, vitest_1.expect)(latest.changePercent).toBeDefined();
            (0, vitest_1.expect)(typeof latest.change).toBe('number');
            (0, vitest_1.expect)(typeof latest.changePercent).toBe('number');
        });
        (0, vitest_1.it)('handles price feed unavailability gracefully', async () => {
            priceFeedClient.setAvailable(false);
            const entry = makeWatchlistEntry({ ticker: 'AAPL' });
            engine.start(3600, [entry], signalFilePath);
            await flushMicrotasks();
            // Should still complete the cycle
            (0, vitest_1.expect)(engine.getPollCyclesCompleted()).toBe(1);
            // No prices should be stored
            const history = priceDataStore.getPriceHistory('AAPL');
            (0, vitest_1.expect)(history.length).toBe(0);
        });
        (0, vitest_1.it)('retains last prices when feed fails', async () => {
            // First poll with feed available
            const entry = makeWatchlistEntry({ ticker: 'AAPL' });
            engine.start(3600, [entry], signalFilePath);
            await flushMicrotasks();
            const historyBefore = priceDataStore.getPriceHistory('AAPL');
            (0, vitest_1.expect)(historyBefore.length).toBe(1);
            // Make feed unavailable and poll again
            priceFeedClient.setAvailable(false);
            await engine.pollCycle();
            // Previous prices should still be there
            const historyAfter = priceDataStore.getPriceHistory('AAPL');
            (0, vitest_1.expect)(historyAfter.length).toBe(1);
            (0, vitest_1.expect)(historyAfter[0]).toEqual(historyBefore[0]);
        });
        (0, vitest_1.it)('increments poll cycle count', async () => {
            engine.start(3600, [makeWatchlistEntry()], signalFilePath);
            await flushMicrotasks();
            (0, vitest_1.expect)(engine.getPollCyclesCompleted()).toBe(1);
            await engine.pollCycle();
            (0, vitest_1.expect)(engine.getPollCyclesCompleted()).toBe(2);
            await engine.pollCycle();
            (0, vitest_1.expect)(engine.getPollCyclesCompleted()).toBe(3);
        });
    });
    (0, vitest_1.describe)('evaluateStrategies', () => {
        (0, vitest_1.it)('skips disabled strategies', () => {
            const entry = makeWatchlistEntry({
                ticker: 'AAPL',
                strategies: [
                    {
                        type: 'price_breakout',
                        params: { upperLevel: 50, lowerLevel: 10 },
                        enabled: false,
                    },
                ],
            });
            const priceHistory = [
                { ticker: 'AAPL', price: 200, timestamp: '2025-01-15T10:00:00Z' },
            ];
            const signals = engine.evaluateStrategies('AAPL', priceHistory, entry.strategies);
            (0, vitest_1.expect)(signals).toHaveLength(0);
        });
        (0, vitest_1.it)('skips strategies with insufficient data', () => {
            const entry = makeWatchlistEntry({
                ticker: 'AAPL',
                strategies: [
                    {
                        type: 'moving_average_crossover',
                        params: { shortWindow: 5, longWindow: 10 },
                        enabled: true,
                    },
                ],
            });
            // Only 3 data points, need 11 (longWindow + 1)
            const priceHistory = [
                { ticker: 'AAPL', price: 100, timestamp: '2025-01-15T10:00:00Z' },
                { ticker: 'AAPL', price: 101, timestamp: '2025-01-15T10:01:00Z' },
                { ticker: 'AAPL', price: 102, timestamp: '2025-01-15T10:02:00Z' },
            ];
            const signals = engine.evaluateStrategies('AAPL', priceHistory, entry.strategies);
            (0, vitest_1.expect)(signals).toHaveLength(0);
        });
        (0, vitest_1.it)('evaluates price breakout strategy and generates BUY signal', () => {
            const entry = makeWatchlistEntry({
                ticker: 'AAPL',
                strategies: [
                    {
                        type: 'price_breakout',
                        params: { upperLevel: 150, lowerLevel: 100 },
                        enabled: true,
                    },
                ],
            });
            const priceHistory = [
                { ticker: 'AAPL', price: 200, timestamp: '2025-01-15T10:00:00Z' },
            ];
            const signals = engine.evaluateStrategies('AAPL', priceHistory, entry.strategies);
            (0, vitest_1.expect)(signals).toHaveLength(1);
            (0, vitest_1.expect)(signals[0].direction).toBe('BUY');
            (0, vitest_1.expect)(signals[0].ticker).toBe('AAPL');
            (0, vitest_1.expect)(signals[0].strategyType).toBe('price_breakout');
            (0, vitest_1.expect)(signals[0].id).toBeTruthy();
        });
        (0, vitest_1.it)('evaluates price breakout strategy and generates SELL signal', () => {
            const entry = makeWatchlistEntry({
                ticker: 'AAPL',
                strategies: [
                    {
                        type: 'price_breakout',
                        params: { upperLevel: 150, lowerLevel: 100 },
                        enabled: true,
                    },
                ],
            });
            const priceHistory = [
                { ticker: 'AAPL', price: 50, timestamp: '2025-01-15T10:00:00Z' },
            ];
            const signals = engine.evaluateStrategies('AAPL', priceHistory, entry.strategies);
            (0, vitest_1.expect)(signals).toHaveLength(1);
            (0, vitest_1.expect)(signals[0].direction).toBe('SELL');
        });
        (0, vitest_1.it)('does not emit HOLD signals', () => {
            const entry = makeWatchlistEntry({
                ticker: 'AAPL',
                strategies: [
                    {
                        type: 'price_breakout',
                        params: { upperLevel: 150, lowerLevel: 100 },
                        enabled: true,
                    },
                ],
            });
            // Price between levels → HOLD
            const priceHistory = [
                { ticker: 'AAPL', price: 125, timestamp: '2025-01-15T10:00:00Z' },
            ];
            const signals = engine.evaluateStrategies('AAPL', priceHistory, entry.strategies);
            (0, vitest_1.expect)(signals).toHaveLength(0);
        });
        (0, vitest_1.it)('suppresses duplicate consecutive signals', () => {
            const strategies = [
                {
                    type: 'price_breakout',
                    params: { upperLevel: 150, lowerLevel: 100 },
                    enabled: true,
                },
            ];
            const priceHistory = [
                { ticker: 'AAPL', price: 200, timestamp: '2025-01-15T10:00:00Z' },
            ];
            // First evaluation — should emit BUY
            const signals1 = engine.evaluateStrategies('AAPL', priceHistory, strategies);
            (0, vitest_1.expect)(signals1).toHaveLength(1);
            (0, vitest_1.expect)(signals1[0].direction).toBe('BUY');
            // Second evaluation with same direction — should be suppressed
            const signals2 = engine.evaluateStrategies('AAPL', priceHistory, strategies);
            (0, vitest_1.expect)(signals2).toHaveLength(0);
        });
        (0, vitest_1.it)('emits signal when direction changes', () => {
            const strategies = [
                {
                    type: 'price_breakout',
                    params: { upperLevel: 150, lowerLevel: 100 },
                    enabled: true,
                },
            ];
            // First: BUY (price above upper)
            const buyHistory = [
                { ticker: 'AAPL', price: 200, timestamp: '2025-01-15T10:00:00Z' },
            ];
            const signals1 = engine.evaluateStrategies('AAPL', buyHistory, strategies);
            (0, vitest_1.expect)(signals1).toHaveLength(1);
            (0, vitest_1.expect)(signals1[0].direction).toBe('BUY');
            // Second: SELL (price below lower)
            const sellHistory = [
                { ticker: 'AAPL', price: 50, timestamp: '2025-01-15T11:00:00Z' },
            ];
            const signals2 = engine.evaluateStrategies('AAPL', sellHistory, strategies);
            (0, vitest_1.expect)(signals2).toHaveLength(1);
            (0, vitest_1.expect)(signals2[0].direction).toBe('SELL');
        });
        (0, vitest_1.it)('includes signal transition context on direction change', () => {
            const strategies = [
                {
                    type: 'price_breakout',
                    params: { upperLevel: 150, lowerLevel: 100 },
                    enabled: true,
                },
            ];
            // First: BUY
            const buyHistory = [
                { ticker: 'AAPL', price: 200, timestamp: '2025-01-15T10:00:00Z' },
            ];
            const signals1 = engine.evaluateStrategies('AAPL', buyHistory, strategies);
            (0, vitest_1.expect)(signals1[0].previousDirection).toBeUndefined();
            // Second: SELL — should include previous direction context
            const sellHistory = [
                { ticker: 'AAPL', price: 50, timestamp: '2025-01-15T11:00:00Z' },
            ];
            const signals2 = engine.evaluateStrategies('AAPL', sellHistory, strategies);
            (0, vitest_1.expect)(signals2[0].previousDirection).toBe('BUY');
            (0, vitest_1.expect)(signals2[0].previousTimestamp).toBeTruthy();
        });
        (0, vitest_1.it)('evaluates multiple enabled strategies per stock', () => {
            const strategies = [
                {
                    type: 'price_breakout',
                    params: { upperLevel: 150, lowerLevel: 100 },
                    enabled: true,
                },
                {
                    type: 'price_breakout',
                    params: { upperLevel: 250, lowerLevel: 200 },
                    enabled: true,
                },
            ];
            // Price 50 is below both lower levels → two SELL signals
            const priceHistory = [
                { ticker: 'AAPL', price: 50, timestamp: '2025-01-15T10:00:00Z' },
            ];
            // Note: both have same type so they share the same signalKey.
            // The first SELL will be emitted, the second will be suppressed as duplicate.
            const signals = engine.evaluateStrategies('AAPL', priceHistory, strategies);
            // Due to same ticker+strategyType key, second is suppressed
            (0, vitest_1.expect)(signals).toHaveLength(1);
        });
    });
    (0, vitest_1.describe)('writeSignals', () => {
        (0, vitest_1.it)('writes signals to signal store', async () => {
            engine.start(3600, [], signalFilePath);
            await flushMicrotasks();
            const signals = [
                {
                    id: 'sig_001',
                    ticker: 'AAPL',
                    direction: 'BUY',
                    strategyType: 'price_breakout',
                    price: 200,
                    timestamp: '2025-01-15T10:00:00Z',
                },
            ];
            engine.writeSignals(signals);
            const store = new signal_store_js_1.SignalStore(signalFilePath);
            const written = store.readSignals();
            (0, vitest_1.expect)(written).toHaveLength(1);
            (0, vitest_1.expect)(written[0].ticker).toBe('AAPL');
        });
        (0, vitest_1.it)('does nothing when no signal store is initialized', () => {
            // Engine not started, so no signal store
            (0, vitest_1.expect)(() => engine.writeSignals([])).not.toThrow();
        });
    });
    (0, vitest_1.describe)('full poll cycle with strategies', () => {
        (0, vitest_1.it)('generates signals during poll cycle for breakout strategy', async () => {
            // Seed price history so breakout can trigger
            const entry = makeWatchlistEntry({
                ticker: 'AAPL',
                strategies: [
                    {
                        type: 'price_breakout',
                        params: { upperLevel: 10, lowerLevel: 5 },
                        enabled: true,
                    },
                ],
            });
            engine.start(3600, [entry], signalFilePath);
            await flushMicrotasks();
            // Mock price for AAPL is > 10, so should trigger BUY
            const store = new signal_store_js_1.SignalStore(signalFilePath);
            const signals = store.readSignals();
            (0, vitest_1.expect)(signals.length).toBeGreaterThanOrEqual(1);
            if (signals.length > 0) {
                (0, vitest_1.expect)(signals[0].direction).toBe('BUY');
                (0, vitest_1.expect)(signals[0].ticker).toBe('AAPL');
            }
        });
    });
});
//# sourceMappingURL=monitoring-engine.test.js.map