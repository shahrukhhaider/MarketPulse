import type { HistoricalDataPoint, BacktestResult } from './types.js';
import type { TuningPerformanceMetrics } from './tuning-engine.js';
import type { ConsolidationBreakoutGridEntry } from './parameter-grid.js';
import { generateConsolidationBreakoutGrid, buildConsolidationBreakoutConfig } from './parameter-grid.js';
import { splitData, evaluateV3Configuration } from './walk-forward-validator.js';
import { BacktestEngine } from './backtest-engine.js';
import { ConsolidationBreakoutEngine } from './strategies/consolidation-breakout-engine.js';
import type { ConsolidationBreakoutParams } from './strategies/strategy-configs.js';
import { generateChartHtml, getChartFilePath } from './chart-generator.js';
import { writeFileSync } from 'node:fs';

// ============================================================
// TuneResult Interface
// ============================================================

export interface TuneResult {
  bestParams: Record<string, number>;
  bestEntry: ConsolidationBreakoutGridEntry;
  isMetrics: TuningPerformanceMetrics;
  oosMetrics: TuningPerformanceMetrics;
  configurationsEvaluated: number;
  configurationsPassed: number;
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

  // Step 2: Generate grid entries
  let grid: ConsolidationBreakoutGridEntry[];
  if (strategy === 'consolidation_breakout') {
    grid = generateConsolidationBreakoutGrid();
  } else {
    return { error: `Unsupported strategy for tuneParams: ${strategy}` };
  }

  // Step 3: Evaluate each entry on IS data
  const isResults: Array<{
    entry: ConsolidationBreakoutGridEntry;
    isMetrics: TuningPerformanceMetrics;
  }> = [];

  for (const entry of grid) {
    const metrics = evaluateV3Configuration(entry, isData);
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
  const bestOosMetrics = evaluateV3Configuration(bestEntry, oosData);

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
