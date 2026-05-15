import { describe, it, expect } from 'vitest';
import { BacktestEngine, computePerformanceSummary } from '../../src/pipeline/backtest-engine.js';
import type { PricePoint, Strategy, StrategyParams, Signal, StrategyType } from '../../src/types.js';

function makePricePoints(prices: number[], ticker = 'AAPL'): PricePoint[] {
  return prices.map((price, i) => ({
    ticker,
    price,
    timestamp: `2024-01-${String(i + 1).padStart(2, '0')}`,
  }));
}

/** A simple test strategy: BUY when price > threshold, SELL when price < threshold, HOLD otherwise */
function createThresholdStrategy(buyAbove: number, sellBelow: number, minPoints = 1): Strategy {
  return {
    type: 'price_breakout' as StrategyType,
    evaluate(priceHistory: PricePoint[], _params: StrategyParams): Signal {
      const latest = priceHistory[priceHistory.length - 1];
      let direction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
      if (latest.price > buyAbove) direction = 'BUY';
      else if (latest.price < sellBelow) direction = 'SELL';
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

describe('BacktestEngine.run()', () => {
  const engine = new BacktestEngine();
  const defaultParams: StrategyParams = { upperLevel: 150, lowerLevel: 90 };

  it('should return empty signals for empty price points', () => {
    const strategy = createThresholdStrategy(150, 90);
    const result = engine.run([], strategy, defaultParams);
    expect(result.signals).toEqual([]);
    expect(result.dataPointsEvaluated).toBe(0);
    expect(result.ticker).toBe('');
  });

  it('should collect BUY and SELL signals, excluding HOLD', () => {
    const prices = makePricePoints([100, 160, 110, 80, 120]);
    const strategy = createThresholdStrategy(150, 90);
    const result = engine.run(prices, strategy, defaultParams);

    // price 100 -> HOLD, 160 -> BUY, 110 -> HOLD, 80 -> SELL, 120 -> HOLD
    expect(result.signals).toHaveLength(2);
    expect(result.signals[0].direction).toBe('BUY');
    expect(result.signals[0].price).toBe(160);
    expect(result.signals[1].direction).toBe('SELL');
    expect(result.signals[1].price).toBe(80);
  });

  it('should preserve chronological order of signals', () => {
    const prices = makePricePoints([80, 160, 80, 160, 80]);
    const strategy = createThresholdStrategy(150, 90);
    const result = engine.run(prices, strategy, defaultParams);

    // 80->SELL, 160->BUY, 80->SELL, 160->BUY, 80->SELL
    expect(result.signals.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < result.signals.length; i++) {
      expect(result.signals[i].timestamp >= result.signals[i - 1].timestamp).toBe(true);
    }
  });

  it('should skip evaluation when data points are below minimum', () => {
    const prices = makePricePoints([160, 160, 160]);
    const strategy = createThresholdStrategy(150, 90, 3); // needs 3 minimum
    const result = engine.run(prices, strategy, defaultParams);

    // Only the 3rd point (index 2) has enough data, so at most 1 signal
    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].price).toBe(160);
  });

  it('should use minimumDataPointsForParams when available', () => {
    const strategy = createThresholdStrategy(150, 90, 1);
    // Add minimumDataPointsForParams that requires 4 points
    (strategy as any).minimumDataPointsForParams = () => 4;

    const prices = makePricePoints([160, 160, 160, 160, 160]);
    const result = engine.run(prices, strategy, defaultParams);

    // First 3 points skipped (< 4 minimum), points 4 and 5 evaluated -> 2 BUY signals
    expect(result.signals).toHaveLength(2);
  });

  it('should enrich signals with id, ticker, and strategyType', () => {
    const prices = makePricePoints([160], 'TSLA');
    const strategy = createThresholdStrategy(150, 90);
    const result = engine.run(prices, strategy, defaultParams);

    expect(result.signals).toHaveLength(1);
    expect(result.signals[0].id).toBeTruthy();
    expect(result.signals[0].id).toMatch(/^sig_/);
    expect(result.signals[0].ticker).toBe('TSLA');
    expect(result.signals[0].strategyType).toBe('price_breakout');
  });

  it('should assemble a complete BacktestResult', () => {
    const prices = makePricePoints([100, 160, 80]);
    const strategy = createThresholdStrategy(150, 90);
    const result = engine.run(prices, strategy, defaultParams, '6mo');

    expect(result.ticker).toBe('AAPL');
    expect(result.strategyType).toBe('price_breakout');
    expect(result.params).toEqual(defaultParams);
    expect(result.period).toBe('6mo');
    expect(result.dataPointsEvaluated).toBe(3);
    expect(result.signals).toHaveLength(2);
    expect(result.performanceSummary).toBeDefined();
    expect(result.performanceSummary.numberOfTrades).toBe(1);
  });

  it('should default period to 1y', () => {
    const prices = makePricePoints([100]);
    const strategy = createThresholdStrategy(150, 90);
    const result = engine.run(prices, strategy, defaultParams);
    expect(result.period).toBe('1y');
  });

  it('should generate unique signal IDs', () => {
    const prices = makePricePoints([160, 160, 160]);
    const strategy = createThresholdStrategy(150, 90);
    const result = engine.run(prices, strategy, defaultParams);

    const ids = result.signals.map((s) => s.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});
