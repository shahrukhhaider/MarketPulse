"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const backtest_engine_js_1 = require("../../src/backtest-engine.js");
function makePricePoints(prices, ticker = 'AAPL') {
    return prices.map((price, i) => ({
        ticker,
        price,
        timestamp: `2024-01-${String(i + 1).padStart(2, '0')}`,
    }));
}
/** A simple test strategy: BUY when price > threshold, SELL when price < threshold, HOLD otherwise */
function createThresholdStrategy(buyAbove, sellBelow, minPoints = 1) {
    return {
        type: 'price_breakout',
        evaluate(priceHistory, _params) {
            const latest = priceHistory[priceHistory.length - 1];
            let direction = 'HOLD';
            if (latest.price > buyAbove)
                direction = 'BUY';
            else if (latest.price < sellBelow)
                direction = 'SELL';
            return {
                id: '',
                ticker: latest.ticker,
                direction,
                strategyType: 'price_breakout',
                price: latest.price,
                timestamp: latest.timestamp,
            };
        },
        validateParams: () => ({ valid: true }),
        minimumDataPoints: () => minPoints,
    };
}
(0, vitest_1.describe)('BacktestEngine.run()', () => {
    const engine = new backtest_engine_js_1.BacktestEngine();
    const defaultParams = { upperLevel: 150, lowerLevel: 90 };
    (0, vitest_1.it)('should return empty signals for empty price points', () => {
        const strategy = createThresholdStrategy(150, 90);
        const result = engine.run([], strategy, defaultParams);
        (0, vitest_1.expect)(result.signals).toEqual([]);
        (0, vitest_1.expect)(result.dataPointsEvaluated).toBe(0);
        (0, vitest_1.expect)(result.ticker).toBe('');
    });
    (0, vitest_1.it)('should collect BUY and SELL signals, excluding HOLD', () => {
        const prices = makePricePoints([100, 160, 110, 80, 120]);
        const strategy = createThresholdStrategy(150, 90);
        const result = engine.run(prices, strategy, defaultParams);
        // price 100 -> HOLD, 160 -> BUY, 110 -> HOLD, 80 -> SELL, 120 -> HOLD
        (0, vitest_1.expect)(result.signals).toHaveLength(2);
        (0, vitest_1.expect)(result.signals[0].direction).toBe('BUY');
        (0, vitest_1.expect)(result.signals[0].price).toBe(160);
        (0, vitest_1.expect)(result.signals[1].direction).toBe('SELL');
        (0, vitest_1.expect)(result.signals[1].price).toBe(80);
    });
    (0, vitest_1.it)('should preserve chronological order of signals', () => {
        const prices = makePricePoints([80, 160, 80, 160, 80]);
        const strategy = createThresholdStrategy(150, 90);
        const result = engine.run(prices, strategy, defaultParams);
        // 80->SELL, 160->BUY, 80->SELL, 160->BUY, 80->SELL
        (0, vitest_1.expect)(result.signals.length).toBeGreaterThanOrEqual(2);
        for (let i = 1; i < result.signals.length; i++) {
            (0, vitest_1.expect)(result.signals[i].timestamp >= result.signals[i - 1].timestamp).toBe(true);
        }
    });
    (0, vitest_1.it)('should skip evaluation when data points are below minimum', () => {
        const prices = makePricePoints([160, 160, 160]);
        const strategy = createThresholdStrategy(150, 90, 3); // needs 3 minimum
        const result = engine.run(prices, strategy, defaultParams);
        // Only the 3rd point (index 2) has enough data, so at most 1 signal
        (0, vitest_1.expect)(result.signals).toHaveLength(1);
        (0, vitest_1.expect)(result.signals[0].price).toBe(160);
    });
    (0, vitest_1.it)('should use minimumDataPointsForParams when available', () => {
        const strategy = createThresholdStrategy(150, 90, 1);
        // Add minimumDataPointsForParams that requires 4 points
        strategy.minimumDataPointsForParams = () => 4;
        const prices = makePricePoints([160, 160, 160, 160, 160]);
        const result = engine.run(prices, strategy, defaultParams);
        // First 3 points skipped (< 4 minimum), points 4 and 5 evaluated -> 2 BUY signals
        (0, vitest_1.expect)(result.signals).toHaveLength(2);
    });
    (0, vitest_1.it)('should enrich signals with id, ticker, and strategyType', () => {
        const prices = makePricePoints([160], 'TSLA');
        const strategy = createThresholdStrategy(150, 90);
        const result = engine.run(prices, strategy, defaultParams);
        (0, vitest_1.expect)(result.signals).toHaveLength(1);
        (0, vitest_1.expect)(result.signals[0].id).toBeTruthy();
        (0, vitest_1.expect)(result.signals[0].id).toMatch(/^sig_/);
        (0, vitest_1.expect)(result.signals[0].ticker).toBe('TSLA');
        (0, vitest_1.expect)(result.signals[0].strategyType).toBe('price_breakout');
    });
    (0, vitest_1.it)('should assemble a complete BacktestResult', () => {
        const prices = makePricePoints([100, 160, 80]);
        const strategy = createThresholdStrategy(150, 90);
        const result = engine.run(prices, strategy, defaultParams, '6mo');
        (0, vitest_1.expect)(result.ticker).toBe('AAPL');
        (0, vitest_1.expect)(result.strategyType).toBe('price_breakout');
        (0, vitest_1.expect)(result.params).toEqual(defaultParams);
        (0, vitest_1.expect)(result.period).toBe('6mo');
        (0, vitest_1.expect)(result.dataPointsEvaluated).toBe(3);
        (0, vitest_1.expect)(result.signals).toHaveLength(2);
        (0, vitest_1.expect)(result.performanceSummary).toBeDefined();
        (0, vitest_1.expect)(result.performanceSummary.numberOfTrades).toBe(1);
    });
    (0, vitest_1.it)('should default period to 1y', () => {
        const prices = makePricePoints([100]);
        const strategy = createThresholdStrategy(150, 90);
        const result = engine.run(prices, strategy, defaultParams);
        (0, vitest_1.expect)(result.period).toBe('1y');
    });
    (0, vitest_1.it)('should generate unique signal IDs', () => {
        const prices = makePricePoints([160, 160, 160]);
        const strategy = createThresholdStrategy(150, 90);
        const result = engine.run(prices, strategy, defaultParams);
        const ids = result.signals.map((s) => s.id);
        const uniqueIds = new Set(ids);
        (0, vitest_1.expect)(uniqueIds.size).toBe(ids.length);
    });
});
//# sourceMappingURL=backtest-engine.test.js.map