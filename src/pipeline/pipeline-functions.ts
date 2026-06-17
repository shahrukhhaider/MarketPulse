import type { HistoricalDataPoint, BacktestResult, PerformanceSummary, Trade } from '../types.js';
import type { TuningPerformanceMetrics } from './tuning-engine.js';
import type { ConsolidationBreakoutGridEntry, TrendPullbackGridEntry, BearBreakdownGridEntry, KeltnerMeanReversionGridEntry } from '../strategies/parameter-grid.js';
import { generateConsolidationBreakoutGrid, buildConsolidationBreakoutConfig, generateTrendPullbackGrid, buildTrendPullbackGridConfig, generateBearBreakdownGrid, buildBearBreakdownConfig, buildPostEarningsDriftConfig, generateKeltnerMeanReversionGrid, buildKeltnerMeanReversionConfig, atrPctToBucket } from '../strategies/parameter-grid.js';
import type { VolatilityBucket } from '../strategies/parameter-grid.js';
import { computeAtrPct } from '../indicators/indicators.js';
import { splitData, evaluateV3Configuration, evaluateTrendPullbackConfiguration, evaluateBearBreakdownConfiguration, evaluateKeltnerMeanReversionConfiguration } from './walk-forward-validator.js';
import { VduBacktestEngine, DEFAULT_VDU_CONFIG } from '../strategies/vdu-engine.js';
import type { VduConfig, VduParams } from '../strategies/vdu-engine.js';
import { BacktestEngine } from './backtest-engine.js';
import { ConsolidationBreakoutEngine } from '../strategies/consolidation-breakout-engine.js';
import { TrendPullbackEngine } from '../strategies/trend-pullback-engine.js';
import { BearBreakdownEngine } from '../strategies/bear-breakdown-engine.js';
import { PostEarningsDriftEngine } from '../strategies/post-earnings-drift-engine.js';
import { KeltnerMeanReversionEngine } from '../strategies/keltner-mean-reversion-engine.js';
import type { ConsolidationBreakoutParams, TrendPullbackParams, BearBreakdownParams, PostEarningsDriftParams, KeltnerMeanReversionParams } from '../strategies/strategy-configs.js';
import { generateChartHtml, getChartFilePath } from '../formatters/chart-generator.js';
import { writeFileSync } from 'node:fs';
import { IndicatorCache, getDefaultCacheConfig } from '../indicators/indicator-cache.js';
import { EarningsDateProvider } from '../data/earnings-date-provider.js';

// ============================================================
// TuneResult Interface
// ============================================================

export interface TuneResult {
  bestParams: Record<string, number>;
  bestEntry: ConsolidationBreakoutGridEntry | TrendPullbackGridEntry | BearBreakdownGridEntry | KeltnerMeanReversionGridEntry | VduGridEntry;
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
  bear_breakdown: TuneResult | { error: string };
  keltner_mean_reversion: TuneResult | { error: string };
  volume_dry_up: TuneResult | { error: string };
  bucket: VolatilityBucket;
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
    keltner_mean_reversion?: PerformanceSummary;
    bear_breakdown?: PerformanceSummary;
    volume_dry_up?: PerformanceSummary;
  };
}

// ============================================================
// V3BacktestResult Interface
// ============================================================

export interface V3BacktestResult {
  consolidation_breakout: BacktestResult;
  trend_pullback: BacktestResult;
  keltner_mean_reversion?: BacktestResult;
  bear_breakdown: BacktestResult;
  volume_dry_up?: BacktestResult;
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
  _paramSpace: Record<string, number[]>,
  bucket: VolatilityBucket = 'medium'
): TuneResult | { error: string } {
  // Step 1: Split data into IS/OOS
  const splitResult = splitData(data);
  if ('error' in splitResult) {
    return splitResult;
  }
  const { inSample: isData, outOfSample: oosData } = splitResult;

  // Build indicator cache for in-sample data
  const isCache = new IndicatorCache(isData, getDefaultCacheConfig());

  // Step 2 & 3: Generate grid entries lazily and evaluate each on IS data.
  // Only keep entries that pass the filter to avoid storing millions of results.
  const filtered: Array<{
    entry: ConsolidationBreakoutGridEntry | TrendPullbackGridEntry | BearBreakdownGridEntry | KeltnerMeanReversionGridEntry | VduGridEntry;
    isMetrics: TuningPerformanceMetrics;
  }> = [];

  let configurationsEvaluated = 0;

  const grid: Iterable<ConsolidationBreakoutGridEntry | TrendPullbackGridEntry | BearBreakdownGridEntry | KeltnerMeanReversionGridEntry | VduGridEntry> =
    strategy === 'consolidation_breakout'
      ? generateConsolidationBreakoutGrid(bucket)
      : strategy === 'trend_pullback'
        ? generateTrendPullbackGrid(bucket)
        : strategy === 'bear_breakdown'
          ? generateBearBreakdownGrid(bucket)
          : strategy === 'keltner_mean_reversion'
            ? generateKeltnerMeanReversionGrid(bucket)
            : strategy === 'volume_dry_up'
              ? generateVduGrid(bucket)
              : [];

  if (strategy !== 'consolidation_breakout' && strategy !== 'trend_pullback' && strategy !== 'bear_breakdown' && strategy !== 'keltner_mean_reversion' && strategy !== 'volume_dry_up') {
    return { error: `Unsupported strategy for tuneParams: ${strategy}` };
  }

  for (const entry of grid) {
    configurationsEvaluated++;
    let metrics: TuningPerformanceMetrics;
    if (strategy === 'consolidation_breakout') {
      metrics = evaluateV3Configuration(entry as ConsolidationBreakoutGridEntry, isData, isCache);
    } else if (strategy === 'trend_pullback') {
      metrics = evaluateTrendPullbackConfiguration(entry as TrendPullbackGridEntry, isData, isCache);
    } else if (strategy === 'bear_breakdown') {
      metrics = evaluateBearBreakdownConfiguration(entry as BearBreakdownGridEntry, isData, isCache);
    } else if (strategy === 'volume_dry_up') {
      metrics = evaluateVduConfiguration(entry as VduGridEntry, isData);
    } else {
      metrics = evaluateKeltnerMeanReversionConfiguration(entry as KeltnerMeanReversionGridEntry, isData, isCache);
    }

    // Step 4: Filter inline — only keep entries that pass IS metrics thresholds
    if (
      metrics.maxDrawdownPercent <= 25 &&
      metrics.profitFactor >= 1.0 &&
      metrics.totalReturnPercent > 0 &&
      metrics.tradeCount >= 3
    ) {
      filtered.push({ entry, isMetrics: metrics });
    }
  }

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
  } else if (strategy === 'trend_pullback') {
    bestOosMetrics = evaluateTrendPullbackConfiguration(bestEntry as TrendPullbackGridEntry, oosData, oosCache);
  } else if (strategy === 'bear_breakdown') {
    bestOosMetrics = evaluateBearBreakdownConfiguration(bestEntry as BearBreakdownGridEntry, oosData, oosCache);
  } else if (strategy === 'volume_dry_up') {
    bestOosMetrics = evaluateVduConfiguration(bestEntry as VduGridEntry, oosData);
  } else {
    bestOosMetrics = evaluateKeltnerMeanReversionConfiguration(bestEntry as KeltnerMeanReversionGridEntry, oosData, oosCache);
  }

  // Step 7: Return TuneResult
  return {
    bestParams: bestEntry.params,
    bestEntry,
    isMetrics: bestIsMetrics,
    oosMetrics: bestOosMetrics,
    configurationsEvaluated,
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
  const atrPct = computeAtrPct(data);
  const bucket: VolatilityBucket = atrPct === null ? 'medium' : atrPctToBucket(atrPct);

  const cbResult = tuneParams(data, 'consolidation_breakout', {}, bucket);
  const tpResult = tuneParams(data, 'trend_pullback', {}, bucket);
  const bbResult = tuneParams(data, 'bear_breakdown', {}, bucket);
  const kmrResult = tuneParams(data, 'keltner_mean_reversion', {}, bucket);
  const vduResult = tuneParams(data, 'volume_dry_up', {}, bucket);

  return {
    consolidation_breakout: cbResult,
    trend_pullback: tpResult,
    bear_breakdown: bbResult,
    keltner_mean_reversion: kmrResult,
    volume_dry_up: vduResult,
    bucket,
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
  params: Record<string, number>,
  ticker?: string
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

  if (strategy === 'bear_breakdown') {
    const config = buildBearBreakdownConfig(params);
    const bbParams: BearBreakdownParams = { config };
    const engine = new BearBreakdownEngine();
    engine.reset();
    const backtestEngine = new BacktestEngine();
    return backtestEngine.runV2(data, engine, bbParams);
  }

  if (strategy === 'post_earnings_drift') {
    const config = buildPostEarningsDriftConfig(params);
    const earningsDates = ticker
      ? new EarningsDateProvider().getEarningsDatesFromCache(ticker)
      : [];
    const peadParams: PostEarningsDriftParams = { config, earningsDates };
    const engine = new PostEarningsDriftEngine();
    engine.reset();
    const backtestEngine = new BacktestEngine();
    return backtestEngine.runV2(data, engine, peadParams);
  }

  if (strategy === 'keltner_mean_reversion') {
    const config = buildKeltnerMeanReversionConfig(params);
    const kmrParams: KeltnerMeanReversionParams = { config };
    const engine = new KeltnerMeanReversionEngine();
    engine.reset();
    const backtestEngine = new BacktestEngine();
    return backtestEngine.runV2(data, engine, kmrParams);
  }

  if (strategy === 'volume_dry_up') {
    const config = buildVduConfig(params);
    const vduParams: VduParams = { config };
    const engine = new VduBacktestEngine();
    engine.reset();
    const backtestEngine = new BacktestEngine();
    return backtestEngine.runV2(data, engine, vduParams as any);
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
  tpParams: Record<string, number>,
  kmrParams?: Record<string, number>,
  bbParams?: Record<string, number>,
  vduParams?: Record<string, number>
): V3BacktestResult {
  const cbResult = runBacktest(data, 'consolidation_breakout', cbParams);
  const tpResult = runBacktest(data, 'trend_pullback', tpParams);

  let kmrResult: BacktestResult | undefined;
  if (kmrParams && Object.keys(kmrParams).length > 0) {
    kmrResult = runBacktest(data, 'keltner_mean_reversion', kmrParams);
  }

  const bbResult = runBacktest(data, 'bear_breakdown', bbParams ?? {});

  let vduResult: BacktestResult | undefined;
  if (vduParams && Object.keys(vduParams).length > 0) {
    vduResult = runBacktest(data, 'volume_dry_up', vduParams);
  }

  const combined = computeCombinedMetrics(cbResult, tpResult, data, kmrResult, bbResult, vduResult);

  return {
    consolidation_breakout: cbResult,
    trend_pullback: tpResult,
    keltner_mean_reversion: kmrResult,
    bear_breakdown: bbResult,
    volume_dry_up: vduResult,
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
  _data: HistoricalDataPoint[],
  kmrResult?: BacktestResult,
  bbResult?: BacktestResult,
  vduResult?: BacktestResult
): CombinedPerformanceMetrics {
  const cbTrades = cbResult.performanceSummary.trades;
  const tpTrades = tpResult.performanceSummary.trades;
  const kmrTrades = kmrResult ? kmrResult.performanceSummary.trades : [];
  const bbTrades = bbResult ? bbResult.performanceSummary.trades : [];
  const vduTrades = vduResult ? vduResult.performanceSummary.trades : [];
  const allTrades: Trade[] = [...cbTrades, ...tpTrades, ...kmrTrades, ...bbTrades, ...vduTrades];

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
  let kmrCumulative = 1;
  for (const trade of kmrTrades) {
    kmrCumulative *= 1 + trade.profitLossPercent / 100;
  }
  let bbCumulative = 1;
  for (const trade of bbTrades) {
    bbCumulative *= 1 + trade.profitLossPercent / 100;
  }
  let vduCumulative = 1;
  for (const trade of vduTrades) {
    vduCumulative *= 1 + trade.profitLossPercent / 100;
  }
  // Combined return: average of all active streams (equal capital allocation)
  let streamCount = 2; // CB + TP always active
  let streamSum = cbCumulative + tpCumulative;
  if (kmrTrades.length > 0) { streamCount++; streamSum += kmrCumulative; }
  if (bbTrades.length > 0) { streamCount++; streamSum += bbCumulative; }
  if (vduTrades.length > 0) { streamCount++; streamSum += vduCumulative; }
  const totalReturnPercent = (streamSum / streamCount - 1) * 100;

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
      keltner_mean_reversion: kmrResult?.performanceSummary,
      bear_breakdown: bbResult?.performanceSummary,
      volume_dry_up: vduResult?.performanceSummary,
    },
  };
}

// ============================================================
// VDU Config Builder (from flat params)
// ============================================================

/**
 * Build a VduConfig from a flat params record, falling back to defaults.
 */
export function buildVduConfig(params: Record<string, number>): VduConfig {
  const consolidation_window = params.consolidation_window ?? DEFAULT_VDU_CONFIG.consolidation_window;
  const max_range_pct = params.max_range_pct ?? DEFAULT_VDU_CONFIG.max_range_pct;
  const atr_ratio_threshold = params.atr_ratio_threshold ?? DEFAULT_VDU_CONFIG.atr_ratio_threshold;

  return {
    consolidation_window,
    max_range_pct,
    atr_ratio_threshold,
    proximity_to_highs_pct: params.proximity_to_highs_pct ?? DEFAULT_VDU_CONFIG.proximity_to_highs_pct,
    volume_lookback: params.volume_lookback ?? DEFAULT_VDU_CONFIG.volume_lookback,
    volume_threshold_forming: params.volume_threshold_forming ?? DEFAULT_VDU_CONFIG.volume_threshold_forming,
    volume_threshold_near: params.volume_threshold_near ?? DEFAULT_VDU_CONFIG.volume_threshold_near,
    volume_threshold_active: params.volume_threshold_active ?? DEFAULT_VDU_CONFIG.volume_threshold_active,
    min_declining_days: params.min_declining_days ?? DEFAULT_VDU_CONFIG.min_declining_days,
    near_range_pct: params.near_range_pct ?? (max_range_pct - 1),
    near_atr_ratio: params.near_atr_ratio ?? (atr_ratio_threshold * 0.85),
    active_range_pct: params.active_range_pct ?? (max_range_pct - 2),
    active_atr_ratio: params.active_atr_ratio ?? (atr_ratio_threshold * 0.70),
    stopLoss: {
      atr_multiple: params.atr_multiple ?? DEFAULT_VDU_CONFIG.stopLoss.atr_multiple,
      swing_lookback: params.swing_lookback ?? DEFAULT_VDU_CONFIG.stopLoss.swing_lookback,
      buffer: params.buffer ?? DEFAULT_VDU_CONFIG.stopLoss.buffer,
    },
    r_multiple: params.r_multiple ?? DEFAULT_VDU_CONFIG.r_multiple,
    sma_period: params.sma_period ?? DEFAULT_VDU_CONFIG.sma_period,
    max_risk_pct: params.max_risk_pct ?? DEFAULT_VDU_CONFIG.max_risk_pct,
  };
}

// ============================================================
// VDU Grid Generation and Evaluation (for tuneParams)
// ============================================================

export interface VduGridEntry {
  params: Record<string, number>;
  config: VduConfig;
}

/**
 * Generate VDU parameter grid entries for walk-forward tuning.
 */
export function* generateVduGrid(bucket: VolatilityBucket = 'medium'): Iterable<VduGridEntry> {
  const consolidation_windows = [10, 12, 15, 18, 20];

  const maxRangePcts: Record<VolatilityBucket, number[]> = {
    low: [4, 5, 6, 7, 8],
    medium: [5, 6, 7, 8, 10, 12],
    high: [6, 8, 10, 12, 15],
  };
  const volumeThresholdActives: Record<VolatilityBucket, number[]> = {
    low: [0.45, 0.55, 0.65, 0.75],
    medium: [0.45, 0.55, 0.65, 0.75, 0.85],
    high: [0.35, 0.40, 0.45, 0.55, 0.65],
  };
  const volumeThresholdNears: Record<VolatilityBucket, number[]> = {
    low: [0.60, 0.70, 0.80],
    medium: [0.60, 0.70, 0.80, 0.90],
    high: [0.50, 0.60, 0.70, 0.80],
  };

  const max_range_pcts = maxRangePcts[bucket];
  const atr_ratio_thresholds = [0.80, 0.90, 1.0, 1.2, 1.5];
  const volume_threshold_actives = volumeThresholdActives[bucket];
  const volume_threshold_nears = volumeThresholdNears[bucket];
  const volume_threshold_formings = [0.80, 0.85, 0.90, 0.95];
  const min_declining_days_arr = [2, 3, 4];
  const r_multiples = [2.0, 3.0];

  for (const consolidation_window of consolidation_windows) {
    for (const max_range_pct of max_range_pcts) {
      for (const atr_ratio_threshold of atr_ratio_thresholds) {
        for (const volume_threshold_active of volume_threshold_actives) {
          for (const volume_threshold_near of volume_threshold_nears) {
            // Enforce monotonic ordering
            if (volume_threshold_active >= volume_threshold_near) continue;

            for (const volume_threshold_forming of volume_threshold_formings) {
              if (volume_threshold_near >= volume_threshold_forming) continue;

              for (const min_declining_days of min_declining_days_arr) {
                for (const r_multiple of r_multiples) {
                  const params: Record<string, number> = {
                    consolidation_window,
                    max_range_pct,
                    atr_ratio_threshold,
                    volume_threshold_active,
                    volume_threshold_near,
                    volume_threshold_forming,
                    min_declining_days,
                    r_multiple,
                  };
                  const config = buildVduConfig(params);
                  yield { params, config };
                }
              }
            }
          }
        }
      }
    }
  }
}

/**
 * Evaluate a single VDU grid entry against historical data.
 * Uses VduBacktestEngine with BacktestEngine.runV2().
 */
export function evaluateVduConfiguration(
  entry: VduGridEntry,
  dataPoints: HistoricalDataPoint[]
): TuningPerformanceMetrics {
  const engine = new VduBacktestEngine();
  engine.reset();

  const vduParams: VduParams = { config: entry.config };
  const backtestEngine = new BacktestEngine();
  const result = backtestEngine.runV2(dataPoints, engine, vduParams as any);

  const { performanceSummary } = result;
  const trades = performanceSummary.trades;

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
    profitFactor = grossLosses === 0 ? (grossProfits > 0 ? Infinity : 0) : grossProfits / grossLosses;
  }

  return {
    totalReturnPercent: performanceSummary.totalReturnPercent,
    sharpeRatio: performanceSummary.sharpeRatio,
    maxDrawdownPercent: performanceSummary.maxDrawdownPercent,
    winRate: performanceSummary.winRate,
    tradeCount: performanceSummary.numberOfTrades,
    profitFactor,
    trades: trades.map((t) => ({
      entryDate: t.buySignal.timestamp.split('T')[0],
      exitDate: t.sellSignal.timestamp.split('T')[0],
      entryPrice: t.buySignal.price,
      exitPrice: t.sellSignal.price,
      pnlPct: t.profitLossPercent,
    })),
  };
}
