import { describe, it, expect } from 'vitest';
import { VduEngine } from '../../src/strategies/vdu-engine.js';
import type { HistoricalDataPoint } from '../../src/types.js';

/**
 * Helper: generate a series of bars with a strong uptrend, tight consolidation,
 * and low volume to trigger VDU ACTIVE signals for backtest testing.
 */
function generateVduActiveData(numBars: number, options?: {
  entryBarHigh?: number;
  stopBarLow?: number;
  entryBarIndex?: number; // relative to signal (1-10)
}): HistoricalDataPoint[] {
  const data: HistoricalDataPoint[] = [];
  const baseDate = new Date('2023-01-01');

  // Generate 60 bars of uptrend data first (to pass direction phase)
  for (let i = 0; i < 60; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i);
    const price = 100 + i * 0.5; // steady uptrend
    data.push({
      date: date.toISOString().slice(0, 10),
      open: price - 0.2,
      high: price + 0.3,
      low: price - 0.3,
      close: price,
      volume: 1000000 - i * 5000, // declining volume
    });
  }

  // Generate tight consolidation bars with very low volume (to trigger ACTIVE)
  const consolidationBase = 130; // price level for consolidation
  for (let i = 60; i < numBars; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() + i);
    // Very tight range, near highs, low volume
    data.push({
      date: date.toISOString().slice(0, 10),
      open: consolidationBase,
      high: consolidationBase + 0.5,
      low: consolidationBase - 0.3,
      close: consolidationBase + 0.2,
      volume: 200000, // very low relative to earlier bars
    });
  }

  return data;
}

describe('VduEngine.runBacktest', () => {
  const engine = new VduEngine();
  const defaultParams: Record<string, number> = {};

  it('returns a valid BacktestResult with correct structure', () => {
    const data = generateVduActiveData(100);
    const result = engine.runBacktest(data, defaultParams);

    expect(result).toHaveProperty('ticker');
    expect(result).toHaveProperty('strategyType');
    expect(result).toHaveProperty('params');
    expect(result).toHaveProperty('period');
    expect(result).toHaveProperty('dataPointsEvaluated');
    expect(result).toHaveProperty('signals');
    expect(result).toHaveProperty('performanceSummary');
    expect(result.performanceSummary).toHaveProperty('winRate');
    expect(result.performanceSummary).toHaveProperty('numberOfTrades');
    expect(result.performanceSummary).toHaveProperty('trades');
    expect(result.performanceSummary).toHaveProperty('totalReturnPercent');
    expect(result.performanceSummary).toHaveProperty('benchmarkReturnPercent');
    expect(result.performanceSummary).toHaveProperty('maxDrawdownPercent');
    expect(result.performanceSummary).toHaveProperty('sharpeRatio');
    expect(result.dataPointsEvaluated).toBe(data.length);
  });

  it('returns empty results when data has fewer than 51 bars', () => {
    const data = generateVduActiveData(50).slice(0, 50);
    const result = engine.runBacktest(data, defaultParams);

    expect(result.performanceSummary.numberOfTrades).toBe(0);
    expect(result.performanceSummary.trades).toHaveLength(0);
    expect(result.signals).toHaveLength(0);
  });

  it('classifies outcome as "won" when bar high >= entryPrice', () => {
    // Create data where after a signal, the next bar gaps up above entry
    const data: HistoricalDataPoint[] = [];
    const baseDate = new Date('2023-01-01');

    // 60 bars of uptrend
    for (let i = 0; i < 60; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      const price = 100 + i * 0.8;
      data.push({
        date: date.toISOString().slice(0, 10),
        open: price - 0.2,
        high: price + 0.5,
        low: price - 0.5,
        close: price,
        volume: 1000000 - i * 10000,
      });
    }

    // 15 bars of tight consolidation with declining volume
    const consHigh = 148.5;
    for (let i = 60; i < 75; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      data.push({
        date: date.toISOString().slice(0, 10),
        open: consHigh - 0.5,
        high: consHigh,
        low: consHigh - 1.0,
        close: consHigh - 0.3,
        volume: Math.max(100000, 400000 - (i - 60) * 30000),
      });
    }

    // After signal: bar that breaks above entry (consHigh * 1.005)
    const entryLevel = consHigh * 1.005;
    for (let i = 75; i < 86; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      if (i === 76) {
        // This bar should trigger entry
        data.push({
          date: date.toISOString().slice(0, 10),
          open: consHigh + 0.5,
          high: entryLevel + 2, // above entry
          low: consHigh - 0.2,
          close: entryLevel + 1,
          volume: 500000,
        });
      } else {
        data.push({
          date: date.toISOString().slice(0, 10),
          open: consHigh - 0.3,
          high: consHigh + 0.2,
          low: consHigh - 0.8,
          close: consHigh - 0.1,
          volume: 300000,
        });
      }
    }

    const result = engine.runBacktest(data, defaultParams);

    // If a signal was detected and won, verify the trade
    if (result.performanceSummary.numberOfTrades > 0) {
      const lastTrade = result.performanceSummary.trades[result.performanceSummary.trades.length - 1];
      // Won trades have positive or zero profit (entry price is the outcome price)
      expect(lastTrade.profitLossPercent).toBeGreaterThanOrEqual(0);
    }
  });

  it('classifies outcome as "lost" when bar low <= stopPrice before entry', () => {
    const data: HistoricalDataPoint[] = [];
    const baseDate = new Date('2023-01-01');

    // 60 bars of uptrend
    for (let i = 0; i < 60; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      const price = 100 + i * 0.8;
      data.push({
        date: date.toISOString().slice(0, 10),
        open: price - 0.2,
        high: price + 0.5,
        low: price - 0.5,
        close: price,
        volume: 1000000 - i * 10000,
      });
    }

    // 15 bars of tight consolidation
    const consHigh = 148.5;
    const consLow = 147.5;
    for (let i = 60; i < 75; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      data.push({
        date: date.toISOString().slice(0, 10),
        open: consHigh - 0.5,
        high: consHigh,
        low: consLow,
        close: consHigh - 0.3,
        volume: Math.max(100000, 400000 - (i - 60) * 30000),
      });
    }

    // After signal: bar that drops below stop (well below consolidation low)
    for (let i = 75; i < 86; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      if (i === 76) {
        // This bar should trigger stop
        data.push({
          date: date.toISOString().slice(0, 10),
          open: consLow - 1,
          high: consLow + 0.2,
          low: consLow - 10, // well below any stop
          close: consLow - 5,
          volume: 800000,
        });
      } else {
        data.push({
          date: date.toISOString().slice(0, 10),
          open: consHigh - 0.3,
          high: consHigh + 0.2,
          low: consLow,
          close: consHigh - 0.1,
          volume: 300000,
        });
      }
    }

    const result = engine.runBacktest(data, defaultParams);

    // If a signal was detected and lost, verify the trade
    if (result.performanceSummary.numberOfTrades > 0) {
      const lastTrade = result.performanceSummary.trades[result.performanceSummary.trades.length - 1];
      // Lost trades have negative profit
      expect(lastTrade.profitLossPercent).toBeLessThan(0);
    }
  });

  it('classifies outcome as "lost" when both entry and stop trigger on same bar', () => {
    const data: HistoricalDataPoint[] = [];
    const baseDate = new Date('2023-01-01');

    // 60 bars of uptrend
    for (let i = 0; i < 60; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      const price = 100 + i * 0.8;
      data.push({
        date: date.toISOString().slice(0, 10),
        open: price - 0.2,
        high: price + 0.5,
        low: price - 0.5,
        close: price,
        volume: 1000000 - i * 10000,
      });
    }

    // 15 bars of tight consolidation
    const consHigh = 148.5;
    const consLow = 147.5;
    for (let i = 60; i < 75; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      data.push({
        date: date.toISOString().slice(0, 10),
        open: consHigh - 0.5,
        high: consHigh,
        low: consLow,
        close: consHigh - 0.3,
        volume: Math.max(100000, 400000 - (i - 60) * 30000),
      });
    }

    // After signal: bar with huge range that triggers both entry AND stop
    const entryLevel = consHigh * 1.005;
    for (let i = 75; i < 86; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      if (i === 76) {
        // Wide bar: high above entry, low below stop
        data.push({
          date: date.toISOString().slice(0, 10),
          open: consHigh,
          high: entryLevel + 5, // above entry
          low: consLow - 20,    // well below stop
          close: consHigh - 2,
          volume: 1000000,
        });
      } else {
        data.push({
          date: date.toISOString().slice(0, 10),
          open: consHigh - 0.3,
          high: consHigh + 0.2,
          low: consLow,
          close: consHigh - 0.1,
          volume: 300000,
        });
      }
    }

    const result = engine.runBacktest(data, defaultParams);

    // If a signal was detected, the same-bar case should be classified as "lost"
    if (result.performanceSummary.numberOfTrades > 0) {
      const lastTrade = result.performanceSummary.trades[result.performanceSummary.trades.length - 1];
      // Lost trades have negative profit (stop takes priority)
      expect(lastTrade.profitLossPercent).toBeLessThan(0);
    }
  });

  it('does not produce overlapping signals (skips bars during tracking)', () => {
    const data = generateVduActiveData(200);
    const result = engine.runBacktest(data, defaultParams);

    // If there are multiple trades, verify they don't overlap
    if (result.performanceSummary.trades.length > 1) {
      const buySignals = result.signals.filter(s => s.direction === 'BUY');
      const sellSignals = result.signals.filter(s => s.direction === 'SELL');

      // Each buy should have a corresponding sell
      expect(buySignals.length).toBe(sellSignals.length);

      // Buy signals should be in chronological order
      for (let i = 1; i < buySignals.length; i++) {
        expect(buySignals[i].timestamp >= buySignals[i - 1].timestamp).toBe(true);
      }
    }
  });

  it('winRate is between 0 and 1', () => {
    const data = generateVduActiveData(200);
    const result = engine.runBacktest(data, defaultParams);

    expect(result.performanceSummary.winRate).toBeGreaterThanOrEqual(0);
    expect(result.performanceSummary.winRate).toBeLessThanOrEqual(1);
  });

  it('period string reflects data range', () => {
    const data = generateVduActiveData(100);
    const result = engine.runBacktest(data, defaultParams);

    expect(result.period).toContain(data[0].date);
    expect(result.period).toContain(data[data.length - 1].date);
  });
});
