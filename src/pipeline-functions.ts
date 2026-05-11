import type { HistoricalDataPoint, BacktestResult, PerformanceSummary, Trade } from './types.js';
import type { TuningPerformanceMetrics } from './tuning-engine.js';
import type { ConsolidationBreakoutGridEntry, TrendPullbackGridEntry } from './parameter-grid.js';
import { generateConsolidationBreakoutGrid, buildConsolidationBreakoutConfig, generateTrendPullbackGrid, buildTrendPullbackGridConfig } from './parameter-grid.js';
import { splitData, evaluateV3Configuration, evaluateTrendPullbackConfiguration } from './walk-forward-validator.js';
import { BacktestEngine } from './backtest-engine.js';
import { ConsolidationBreakoutEngine } from './strategies/consolidation-breakout-engine.js';
import { TrendPullbackEngine } from './strategies/trend-pullback-engine.js';
import type { ConsolidationBreakoutParams, TrendPullbackParams } from './strategies/strategy-configs.js';
import { generateChartHtml, getChartFilePath } from './chart-generator.js';
import { writeFileSync } from 'node:fs';
import { IndicatorCache, getDefaultCacheConfig } from './indicator-cache.js';

// ============================================================
// TuneResult Interface
// ============================================================

export interface TuneResult {
  bestParams: Record<string, number>;
  bestEntry: ConsolidationBreakoutGridEntry | TrendPullbackGridEntry;
  isMetrics: TuningPerformanceMetrics;
  oosMetrics: TuningPerformanceMetrics;
  configurationsEvaluated: number;
  configurationsPassed: number;
}

// ============================================================
// V3TuneResult Interface
// ============================================================

export interface V3TuneResult {
  consolidation_breakout: TuneResult | { error: string };
  trend_pullback: TuneResult | { error: string };
}

// ============================================================
// CombinedPerformanceMetrics Interface
// ============================================================

export interface CombinedPerformanceMetrics {
  totalReturnPercent: number;
  numberOfTrades: number;
  winRate: number;
  maxDrawdownPercent: number;
  sharpeRatio: number;
  profitFactor: number;
  perStrategy: {
    consolidation_breakout: PerformanceSummary;
    trend_pullback: PerformanceSummary;
  };
}

// ============================================================
// V3BacktestResult Interface
// ============================================================

export interface V3BacktestResult {
  consolidation_breakout: BacktestResult;
  trend_pullback: BacktestResult;
  combined: CombinedPerformanceMetrics;
}

// ============================================================
// tuneParams — Grid search with walk-forward validation
// ============================================================

/**
 * Run parameter grid search with walk-forward validation.
 *
 * 1. splitData() for IS (70%) / OOS (30%) split
 * 2. Generate grid entries using generateConsolidationBreakoutGrid()
 * 3. Evaluate each entry on IS data using evaluateV3Configuration()
 * 4. Filter: drawdown ≤ 25%, profit factor ≥ 1.0, positive return, ≥ 3 trades
 * 5. Rank by IS total return (descending)
 * 6. Evaluate best on OOS data
 * 7. Return TuneResult or error
 */
export function tuneParams(
  data: HistoricalDataPoint[],
  strategy: string,
  _paramSpace: Record<string, number[]>
): TuneResult | { error: string } {
  // Step 1: Split data into IS/OOS
  const splitResult = splitData(data);
  if ('error' in splitResult) {
    return splitResult;
  }
  const { inSample: isData, outOfSample: oosData } = splitResult;

  // Build indicator cache for in-sample data
  const isCache = new IndicatorCache(isData, getDefaultCacheConfig());

  // Step 2: Generate grid entries
  let grid: ConsolidationBreakoutGridEntry[] | TrendPullbackGridEntry[];
  if (strategy === 'consolidation_breakout') {
    grid = generateConsolidationBreakoutGrid();
  } else if (strategy === 'trend_pullback') {
    grid = generateTrendPullbackGrid();
  } else {
    return { error: `Unsupported strategy for tuneParams: ${strategy}` };
  }

  // Step 3: Evaluate each entry on IS data
  const isResults: Array<{
    entry: ConsolidationBreakoutGridEntry | TrendPullbackGridEntry;
    isMetrics: TuningPerformanceMetrics;
  }> = [];

  for (const entry of grid) {
    let metrics: TuningPerformanceMetrics;
    if (strategy === 'consolidation_breakout') {
      metrics = evaluateV3Configuration(entry as ConsolidationBreakoutGridEntry, isData, isCache);
    } else {
      metrics = evaluateTrendPullbackConfiguration(entry as TrendPullbackGridEntry, isData, isCache);
    }
    isResults.push({ entry, isMetrics: metrics });
  }

  // Step 4: Filter by IS metrics
  const filtered = isResults.filter(r =>
    r.isMetrics.maxDrawdownPercent <= 25 &&
    r.isMetrics.profitFactor >= 1.0 &&
    r.isMetrics.totalReturnPercent > 0 &&
    r.isMetrics.tradeCount >= 3
  );

  if (filtered.length === 0) {
    return { error: `No viable configurations found for strategy '${strategy}'` };
  }

  // Step 5: Rank by IS total return descending
  filtered.sort((a, b) => b.isMetrics.totalReturnPercent - a.isMetrics.totalReturnPercent);

  const bestEntry = filtered[0].entry;
  const bestIsMetrics = filtered[0].isMetrics;

  // Step 6: Evaluate best on OOS data
  const oosCache = new IndicatorCache(oosData, getDefaultCacheConfig());
  let bestOosMetrics: TuningPerformanceMetrics;
  if (strategy === 'consolidation_breakout') {
    bestOosMetrics = evaluateV3Configuration(bestEntry as ConsolidationBreakoutGridEntry, oosData, oosCache);
  } else {
    bestOosMetrics = evaluateTrendPullbackConfiguration(bestEntry as TrendPullbackGridEntry, oosData, oosCache);
  }

  // Step 7: Return TuneResult
  return {
    bestParams: bestEntry.params,
    bestEntry,
    isMetrics: bestIsMetrics,
    oosMetrics: bestOosMetrics,
    configurationsEvaluated: grid.length,
    configurationsPassed: filtered.length,
  };
}

// ============================================================
// tuneV3 — Tune both V3 strategies and return combined results
// ============================================================

/**
 * Tune both consolidation_breakout and trend_pullback strategies
 * on the same data and return combined results.
 *
 * Each strategy is tuned independently via tuneParams().
 * Returns a V3TuneResult with results (or errors) for both strategies.
 */
export function tuneV3(data: HistoricalDataPoint[]): V3TuneResult {
  const cbResult = tuneParams(data, 'consolidation_breakout', {});
  const tpResult = tuneParams(data, 'trend_pullback', {});

  return {
    consolidation_breakout: cbResult,
    trend_pullback: tpResult,
  };
}

// ============================================================
// runBacktest — Wraps BacktestEngine.runV2()
// ============================================================

/**
 * Run a backtest with the given strategy and parameters.
 * For consolidation_breakout, builds a ConsolidationBreakoutConfiguration
 * from flat params and runs BacktestEngine.runV2().
 */
export function runBacktest(
  data: HistoricalDataPoint[],
  strategy: string,
  params: Record<string, number>
): BacktestResult {
  if (strategy === 'consolidation_breakout') {
    const config = buildConsolidationBreakoutConfig(params);
    const v3Params: ConsolidationBreakoutParams = { config };
    const engine = new ConsolidationBreakoutEngine();
    engine.reset();
    const backtestEngine = new BacktestEngine();
    return backtestEngine.runV2(data, engine, v3Params);
  }

  if (strategy === 'trend_pullback') {
    const config = buildTrendPullbackGridConfig(params);
    const tpParams: TrendPullbackParams = { config };
    const engine = new TrendPullbackEngine();
    engine.reset();
    const backtestEngine = new BacktestEngine();
    return backtestEngine.runV2(data, engine, tpParams);
  }

  throw new Error(`Unsupported strategy for runBacktest: ${strategy}`);
}

// ============================================================
// renderChart — Wraps generateChartHtml() + writeFileSync()
// ============================================================

/**
 * Generate an HTML chart from a backtest result and write it to disk.
 * Returns the file path of the generated chart.
 *
 * Filename pattern: {ticker}_backtest_{timestamp}.html
 */
export function renderChart(
  backtestResult: BacktestResult,
  dataPoints: HistoricalDataPoint[],
  dataDir: string,
  ticker: string
): string {
  const chartFilePath = getChartFilePath(dataDir, ticker);
  const html = generateChartHtml({
    backtestResult,
    dataPoints,
    strategyParams: backtestResult.params,
  });
  writeFileSync(chartFilePath, html, 'utf-8');
  return chartFilePath;
}

// ============================================================
// backtestV3 — Run both V3 strategies and compute combined metrics
// ============================================================

/**
 * Run BacktestEngine.runV2() with both ConsolidationBreakoutEngine and
 * TrendPullbackEngine on the same data, then compute combined metrics.
 *
 * @param data - Historical data points to backtest on
 * @param cbParams - Flat parameter record for consolidation_breakout
 * @param tpParams - Flat parameter record for trend_pullback
 * @returns V3BacktestResult with individual and combined results
 */
export function backtestV3(
  data: HistoricalDataPoint[],
  cbParams: Record<string, number>,
  tpParams: Record<string, number>
): V3BacktestResult {
  const cbResult = runBacktest(data, 'consolidation_breakout', cbParams);
  const tpResult = runBacktest(data, 'trend_pullback', tpParams);
  const combined = computeCombinedMetrics(cbResult, tpResult, data);

  return {
    consolidation_breakout: cbResult,
    trend_pullback: tpResult,
    combined,
  };
}

// ============================================================
// computeCombinedMetrics — Compute combined performance metrics
// ============================================================

/**
 * Compute combined performance metrics from two independent backtest results.
 *
 * - totalReturnPercent: sum of per-bar returns from both streams (combined equity curve)
 * - numberOfTrades: sum of trades from both strategies
 * - winRate: combined win rate across all trades
 * - maxDrawdownPercent: max drawdown of the combined equity curve
 * - sharpeRatio: Sharpe ratio of combined trade returns
 * - profitFactor: total gross profits / total gross losses across all trades
 * - perStrategy: individual PerformanceSummary for each strategy
 */
export function computeCombinedMetrics(
  cbResult: BacktestResult,
  tpResult: BacktestResult,
  _data: HistoricalDataPoint[]
): CombinedPerformanceMetrics {
  const cbTrades = cbResult.performanceSummary.trades;
  const tpTrades = tpResult.performanceSummary.trades;
  const allTrades: Trade[] = [...cbTrades, ...tpTrades];

  const numberOfTrades = allTrades.length;

  // Win rate: combined across all trades
  const wins = allTrades.filter(t => t.profitLossPercent > 0).length;
  const winRate = numberOfTrades > 0 ? wins / numberOfTrades : 0;

  // Total return: combined equity curve by multiplying cumulative returns from both streams
  // Each strategy is treated as an independent capital allocation
  let cbCumulative = 1;
  for (const trade of cbTrades) {
    cbCumulative *= 1 + trade.profitLossPercent / 100;
  }
  let tpCumulative = 1;
  for (const trade of tpTrades) {
    tpCumulative *= 1 + trade.profitLossPercent / 100;
  }
  // Combined return: average of both streams (equal capital allocation)
  const totalReturnPercent = ((cbCumulative + tpCumulative) / 2 - 1) * 100;

  // Max drawdown: computed from combined equity curve
  // Sort all trades by buy signal timestamp to create a time-ordered combined equity curve
  const sortedTrades = [...allTrades].sort((a, b) =>
    a.buySignal.timestamp.localeCompare(b.buySignal.timestamp)
  );

  let maxDrawdownPercent = 0;
  if (sortedTrades.length > 0) {
    let cumulativeValue = 1;
    let peak = 1;
    for (const trade of sortedTrades) {
      cumulativeValue *= 1 + trade.profitLossPercent / 100;
      if (cumulativeValue > peak) {
        peak = cumulativeValue;
      }
      const drawdown = ((peak - cumulativeValue) / peak) * 100;
      if (drawdown > maxDrawdownPercent) {
        maxDrawdownPercent = drawdown;
      }
    }
  }

  // Sharpe ratio: mean / stddev of per-trade returns across all trades
  let sharpeRatio = 0;
  if (numberOfTrades >= 2) {
    const returns = allTrades.map(t => t.profitLossPercent);
    const mean = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const variance = returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / returns.length;
    const stddev = Math.sqrt(variance);
    sharpeRatio = stddev !== 0 ? mean / stddev : 0;
  }

  // Profit factor: total gross profits / total gross losses
  let grossProfits = 0;
  let grossLosses = 0;
  for (const trade of allTrades) {
    if (trade.profitLossPercent > 0) {
      grossProfits += trade.profitLossPercent;
    } else {
      grossLosses += Math.abs(trade.profitLossPercent);
    }
  }
  const profitFactor = grossLosses > 0 ? grossProfits / grossLosses : (grossProfits > 0 ? Infinity : 0);

  return {
    totalReturnPercent,
    numberOfTrades,
    winRate,
    maxDrawdownPercent,
    sharpeRatio,
    profitFactor,
    perStrategy: {
      consolidation_breakout: cbResult.performanceSummary,
      trend_pullback: tpResult.performanceSummary,
    },
  };
}
