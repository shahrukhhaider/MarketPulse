import { describe, it, expect } from 'vitest';
import {
  formatCompositeEntryReasoning,
  formatCompositeExitReasoning,
  formatSimpleReasoning,
  annotateTradesWithReasoning,
} from '../../src/utils/trade-annotator.js';
import type { BacktestResult, Signal, Trade } from '../../src/types.js';
import type { StrategyConfiguration } from '../../src/strategies/strategy-configs.js';
import type { CompositeStrategyParams } from '../../src/strategies/strategy-configs.js';

// ============================================================
// Helpers
// ============================================================

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: 'sig_1',
    ticker: 'AAPL',
    direction: 'BUY',
    strategyType: 'moving_average_crossover',
    price: 150,
    timestamp: '2024-01-10',
    ...overrides,
  };
}

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    buySignal: makeSignal({ direction: 'BUY', price: 100, timestamp: '2024-01-05' }),
    sellSignal: makeSignal({ direction: 'SELL', price: 120, timestamp: '2024-02-10', id: 'sig_2' }),
    profitLossPercent: 20,
    ...overrides,
  };
}

function makeBacktestResult(trades: Trade[]): BacktestResult {
  return {
    ticker: 'AAPL',
    strategyType: 'moving_average_crossover',
    params: { shortWindow: 10, longWindow: 50 },
    period: '1y',
    dataPointsEvaluated: 252,
    signals: trades.flatMap(t => [t.buySignal, t.sellSignal]),
    performanceSummary: {
      totalReturnPercent: 15,
      benchmarkReturnPercent: 10,
      numberOfTrades: trades.length,
      winRate: 0.6,
      maxDrawdownPercent: 5,
      trades,
      sharpeRatio: 1.2,
    },
  };
}

const sampleConfig: StrategyConfiguration = {
  name: 'momentum_continuation',
  directionFilters: [
    { type: 'return_above', period: 20, threshold: 10 },
    { type: 'price_above_sma', period: 50 },
  ],
  timingFilters: [
    { type: 'return_above', period: 3, threshold: 3 },
  ],
  confirmationFilters: [
    { type: 'outperforms_index', period: 20, indexTicker: 'SPY' },
  ],
  exitRules: [
    { type: 'hold_days', days: 63 },
  ],
  riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: 5.0 },
};

// ============================================================
// formatCompositeEntryReasoning
// ============================================================

describe('formatCompositeEntryReasoning', () => {
  it('should include the strategy name', () => {
    const result = formatCompositeEntryReasoning(sampleConfig);
    expect(result).toContain('momentum_continuation');
  });

  it('should list all direction filters', () => {
    const result = formatCompositeEntryReasoning(sampleConfig);
    expect(result).toContain('Direction filters:');
    expect(result).toContain('return_above');
    expect(result).toContain('price_above_sma');
  });

  it('should list all timing filters', () => {
    const result = formatCompositeEntryReasoning(sampleConfig);
    expect(result).toContain('Timing filters:');
  });

  it('should list all confirmation filters', () => {
    const result = formatCompositeEntryReasoning(sampleConfig);
    expect(result).toContain('Confirmation filters:');
    expect(result).toContain('outperforms_index');
  });

  it('should omit empty filter groups', () => {
    const config: StrategyConfiguration = {
      name: 'minimal',
      directionFilters: [{ type: 'price_above_sma', period: 50 }],
      timingFilters: [],
      confirmationFilters: [],
      exitRules: [],
    };
    const result = formatCompositeEntryReasoning(config);
    expect(result).toContain('Direction filters:');
    expect(result).not.toContain('Timing filters:');
    expect(result).not.toContain('Confirmation filters:');
  });
});

// ============================================================
// formatCompositeExitReasoning
// ============================================================

describe('formatCompositeExitReasoning', () => {
  it('should list exit rules', () => {
    const result = formatCompositeExitReasoning(sampleConfig);
    expect(result).toContain('Exit rules:');
    expect(result).toContain('hold_days');
  });

  it('should list risk rule when present', () => {
    const result = formatCompositeExitReasoning(sampleConfig);
    expect(result).toContain('Risk rule:');
    expect(result).toContain('atr_multiple');
  });

  it('should omit risk rule section when absent', () => {
    const config: StrategyConfiguration = {
      name: 'no_risk',
      directionFilters: [],
      timingFilters: [],
      confirmationFilters: [],
      exitRules: [{ type: 'hold_days', days: 30 }],
    };
    const result = formatCompositeExitReasoning(config);
    expect(result).toContain('Exit rules:');
    expect(result).not.toContain('Risk rule:');
  });

  it('should handle multiple exit rules', () => {
    const config: StrategyConfiguration = {
      name: 'multi_exit',
      directionFilters: [],
      timingFilters: [],
      confirmationFilters: [],
      exitRules: [
        { type: 'rsi_above', period: 14, threshold: 60 },
        { type: 'hold_days', days: 63 },
      ],
    };
    const result = formatCompositeExitReasoning(config);
    expect(result).toContain('rsi_above');
    expect(result).toContain('hold_days');
  });
});

// ============================================================
// formatSimpleReasoning
// ============================================================

describe('formatSimpleReasoning', () => {
  it('should include the strategy type', () => {
    const result = formatSimpleReasoning('moving_average_crossover', { shortWindow: 10, longWindow: 50 });
    expect(result).toContain('moving_average_crossover');
  });

  it('should include all parameter key-value pairs', () => {
    const params = { shortWindow: 10, longWindow: 50 };
    const result = formatSimpleReasoning('moving_average_crossover', params);
    expect(result).toContain('shortWindow: 10');
    expect(result).toContain('longWindow: 50');
  });

  it('should work for RSI strategy', () => {
    const params = { period: 14, overbought: 70, oversold: 30 };
    const result = formatSimpleReasoning('rsi_threshold', params);
    expect(result).toContain('rsi_threshold');
    expect(result).toContain('period: 14');
    expect(result).toContain('overbought: 70');
    expect(result).toContain('oversold: 30');
  });
});

// ============================================================
// annotateTradesWithReasoning
// ============================================================

describe('annotateTradesWithReasoning', () => {
  it('should return empty array for zero trades', () => {
    const result = annotateTradesWithReasoning(makeBacktestResult([]), { shortWindow: 10, longWindow: 50 });
    expect(result).toEqual([]);
  });

  it('should return one reasoning per trade', () => {
    const trades = [makeTrade(), makeTrade()];
    const backtestResult = makeBacktestResult(trades);
    const result = annotateTradesWithReasoning(backtestResult, { shortWindow: 10, longWindow: 50 });
    expect(result).toHaveLength(2);
  });

  it('should populate trade fields correctly', () => {
    const trade = makeTrade({
      buySignal: makeSignal({ price: 100, timestamp: '2024-01-05' }),
      sellSignal: makeSignal({ direction: 'SELL', price: 130, timestamp: '2024-03-01', id: 'sig_2' }),
      profitLossPercent: 30,
    });
    const backtestResult = makeBacktestResult([trade]);
    const result = annotateTradesWithReasoning(backtestResult, { shortWindow: 10, longWindow: 50 });

    expect(result[0].tradeIndex).toBe(0);
    expect(result[0].strategyType).toBe('moving_average_crossover');
    expect(result[0].entryDate).toBe('2024-01-05');
    expect(result[0].entryPrice).toBe(100);
    expect(result[0].exitDate).toBe('2024-03-01');
    expect(result[0].exitPrice).toBe(130);
    expect(result[0].profitLossPercent).toBe(30);
  });

  it('should use simple reasoning for non-composite params', () => {
    const backtestResult = makeBacktestResult([makeTrade()]);
    const result = annotateTradesWithReasoning(backtestResult, { shortWindow: 10, longWindow: 50 });

    expect(result[0].entryReasoning).toContain('moving_average_crossover');
    expect(result[0].entryReasoning).toContain('shortWindow: 10');
  });

  it('should use composite reasoning when params has config', () => {
    const compositeParams: CompositeStrategyParams = { config: sampleConfig };
    const trade = makeTrade();
    const backtestResult: BacktestResult = {
      ...makeBacktestResult([trade]),
      strategyType: 'momentum_continuation',
    };

    const result = annotateTradesWithReasoning(backtestResult, compositeParams);

    expect(result[0].entryReasoning).toContain('Direction filters:');
    expect(result[0].exitReasoning).toContain('Exit rules:');
  });
});
