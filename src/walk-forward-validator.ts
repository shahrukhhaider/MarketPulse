import type { HistoricalDataPoint } from './types.js';
import type { GridEntry } from './parameter-grid.js';
import type { TunableStrategy, TuningPerformanceMetrics } from './tuning-engine.js';
import { BacktestEngine, convertHistoricalData } from './backtest-engine.js';
import { CompositeStrategyEngine } from './strategies/composite-engine.js';
import type { CompositeStrategyParams } from './strategies/strategy-configs.js';

export type { TuningPerformanceMetrics } from './tuning-engine.js';

export interface WalkForwardResult {
  params: Record<string, number>;
  inSample: TuningPerformanceMetrics;
  outOfSample: TuningPerformanceMetrics;
}

export interface DataSplit {
  inSample: HistoricalDataPoint[];
  outOfSample: HistoricalDataPoint[];
}

/**
 * Split historical data into in-sample (70%) and out-of-sample (30%) windows.
 * Returns a validation error if fewer than 100 data points.
 */
export function splitData(
  dataPoints: HistoricalDataPoint[]
): DataSplit | { error: string } {
  if (dataPoints.length < 100) {
    return {
      error: `Insufficient data: need at least 100 data points, got ${dataPoints.length}`,
    };
  }

  const splitIndex = Math.floor(0.7 * dataPoints.length);

  return {
    inSample: dataPoints.slice(0, splitIndex),
    outOfSample: dataPoints.slice(splitIndex),
  };
}

/**
 * Run backtest on a single grid entry against a data window,
 * returning TuningPerformanceMetrics including profit_factor.
 */
export function evaluateConfiguration(
  entry: GridEntry,
  dataPoints: HistoricalDataPoint[],
  strategy: TunableStrategy
): TuningPerformanceMetrics {
  const ticker = 'TUNE';
  const pricePoints = convertHistoricalData(dataPoints, ticker);

  // Create a fresh engine for each evaluation to avoid state leakage
  const engine = new CompositeStrategyEngine(strategy);

  const params: CompositeStrategyParams = {
    config: entry.config,
    primaryDataPoints: dataPoints,
  };

  const backtestEngine = new BacktestEngine();
  const result = backtestEngine.run(pricePoints, engine, params);

  const { performanceSummary } = result;
  const trades = performanceSummary.trades;

  // Compute profit factor from the trade list
  let profitFactor: number;
  if (trades.length === 0) {
    profitFactor = 0;
  } else {
    let grossProfits = 0;
    let grossLosses = 0;
    for (const trade of trades) {
      if (trade.profitLossPercent > 0) {
        grossProfits += trade.profitLossPercent;
      } else if (trade.profitLossPercent < 0) {
        grossLosses += Math.abs(trade.profitLossPercent);
      }
    }
    profitFactor = grossLosses === 0 ? Infinity : grossProfits / grossLosses;
  }

  return {
    totalReturnPercent: performanceSummary.totalReturnPercent,
    sharpeRatio: performanceSummary.sharpeRatio,
    maxDrawdownPercent: performanceSummary.maxDrawdownPercent,
    winRate: performanceSummary.winRate,
    tradeCount: performanceSummary.numberOfTrades,
    profitFactor,
  };
}

/**
 * Run walk-forward validation for all grid entries:
 * split data, run in-sample + out-of-sample backtests for each.
 */
export function walkForwardValidate(
  grid: GridEntry[],
  dataPoints: HistoricalDataPoint[],
  strategy: TunableStrategy
): WalkForwardResult[] | { error: string } {
  const splitResult = splitData(dataPoints);
  if ('error' in splitResult) {
    return splitResult;
  }

  const { inSample, outOfSample } = splitResult;

  return grid.map(entry => ({
    params: entry.params,
    inSample: evaluateConfiguration(entry, inSample, strategy),
    outOfSample: evaluateConfiguration(entry, outOfSample, strategy),
  }));
}
