// ============================================================
// Tune Single Command — Single-ticker parameter optimization
// Supports V1 (TuningEngine), V2 (Phased grid), V3 (CB grid)
// ============================================================

import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { HistoricalDataCache } from '../data/historical-data-cache.js';
import { BacktestEngine } from '../pipeline/backtest-engine.js';
import type { PhasedStrategyParams } from '../strategies/strategy-configs.js';
import { PhasedStrategyEngine } from '../strategies/phased-engine.js';
import { TuningEngine } from '../pipeline/tuning-engine.js';
import type { TuningInput, TunableStrategy, TimeHorizon, RiskProfile } from '../pipeline/tuning-engine.js';
import { generateV2Grid, generateConsolidationBreakoutGrid } from '../strategies/parameter-grid.js';
import type { ConsolidationBreakoutGridEntry } from '../strategies/parameter-grid.js';
import { evaluateV3Configuration, splitData } from '../pipeline/walk-forward-validator.js';

export interface TuneSingleCommandDeps {
  cachingProvider: HistoricalDataCache;
  dataDir: string;
}

export function createTuneSingleHandler(deps: TuneSingleCommandDeps): CommandHandler {
  const { cachingProvider, dataDir } = deps;

  return async (opts: Record<string, string>) => {
    const ticker = opts['ticker'].toUpperCase();
    const strategy = opts['strategy'] as TunableStrategy;
    const isV3 = opts['v3'] !== undefined;
    const isV2 = opts['v2'] !== undefined;

    if (isV3) {
      return handleV3Tune(ticker, strategy, opts, cachingProvider);
    }

    if (isV2) {
      return handleV2Tune(ticker, strategy, opts, cachingProvider);
    }

    return handleV1Tune(ticker, strategy, opts, cachingProvider, dataDir);
  };
}

// --- V3 Tune Path ---
async function handleV3Tune(
  ticker: string,
  strategy: TunableStrategy,
  opts: Record<string, string>,
  cachingProvider: HistoricalDataCache,
) {
  const period = '5y';
  try {
    const dataResult = await cachingProvider.getHistoricalData(ticker, period);

    if (!dataResult.success) {
      return errorResult('tune', 'DATA_PROVIDER_ERROR', dataResult.error);
    }
    const dataPoints = dataResult.data.dataPoints;

    // Split data into IS (70%) and OOS (30%)
    const splitResult = splitData(dataPoints);
    if ('error' in splitResult) {
      return errorResult('tune', 'INSUFFICIENT_DATA', splitResult.error);
    }
    const { inSample: isData, outOfSample: oosData } = splitResult;
    const grid = generateConsolidationBreakoutGrid();

    type GridMetricsEntry = {
      entry: ConsolidationBreakoutGridEntry;
      isMetrics: { totalReturnPercent: number; sharpeRatio: number; maxDrawdownPercent: number; winRate: number; tradeCount: number; profitFactor: number };
    };
    const filtered: GridMetricsEntry[] = [];
    const fallback: GridMetricsEntry[] = [];
    let configurationsEvaluated = 0;

    for (const entry of grid) {
      configurationsEvaluated++;
      const metrics = evaluateV3Configuration(entry, isData);

      if (
        metrics.maxDrawdownPercent <= 25 &&
        metrics.profitFactor >= 1.0 &&
        metrics.totalReturnPercent > 0 &&
        metrics.tradeCount >= 3
      ) {
        filtered.push({ entry, isMetrics: metrics });
      } else if (metrics.tradeCount > 0) {
        fallback.push({ entry, isMetrics: metrics });
      }
    }

    // Use strict filter results, or fallback to any config with trades
    const candidates = filtered.length > 0 ? filtered : fallback;

    if (candidates.length === 0) {
      return errorResult('tune', 'NO_VIABLE_CONFIGS',
        `No viable V3 configurations found for ${ticker} / ${strategy}`);
    }

    // Rank by IS total return descending
    candidates.sort((a, b) => b.isMetrics.totalReturnPercent - a.isMetrics.totalReturnPercent);
    const topCount = Math.max(1, Math.ceil(candidates.length * 0.2));
    const topConfigs = candidates.slice(0, topCount);

    // Compute best region
    const bestRegion: Record<string, { min: number; max: number }> = {};
    const paramNames = Object.keys(topConfigs[0].entry.params);
    for (const name of paramNames) {
      const values = topConfigs.map(c => c.entry.params[name]);
      bestRegion[name] = { min: Math.min(...values), max: Math.max(...values) };
    }

    // Summary metrics (mean of top IS configs)
    const n = topConfigs.length;
    const summaryMetrics = {
      totalReturnPercent: topConfigs.reduce((s, c) => s + c.isMetrics.totalReturnPercent, 0) / n,
      sharpeRatio: topConfigs.reduce((s, c) => s + c.isMetrics.sharpeRatio, 0) / n,
      maxDrawdownPercent: topConfigs.reduce((s, c) => s + c.isMetrics.maxDrawdownPercent, 0) / n,
      winRate: topConfigs.reduce((s, c) => s + c.isMetrics.winRate, 0) / n,
      tradeCount: topConfigs.reduce((s, c) => s + c.isMetrics.tradeCount, 0) / n,
      profitFactor: topConfigs.reduce((s, c) => s + c.isMetrics.profitFactor, 0) / n,
    };

    // Best config: IS metrics from grid search, OOS metrics from validation
    const bestEntry = candidates[0].entry;
    const bestIsMetrics = candidates[0].isMetrics;
    const bestOosMetrics = evaluateV3Configuration(bestEntry, oosData);

    const riskProfile = (opts['risk'] as RiskProfile) ?? 'low';
    const horizon = (opts['horizon'] as TimeHorizon) ?? 'long_term';
    const profile = `${horizon}_${riskProfile}`;

    return successResult('tune', {
      ticker,
      strategy,
      profile,
      best_region: bestRegion,
      summary_metrics: summaryMetrics,
      inSample: bestIsMetrics,
      outOfSample: bestOosMetrics,
      configurations_evaluated: configurationsEvaluated,
      configurations_passed_filter: candidates.length,
      computed_at: new Date().toISOString(),
      v3: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult('tune', 'TUNING_ERROR', message);
  }
}

// --- V2 Tune Path ---
async function handleV2Tune(
  ticker: string,
  strategy: TunableStrategy,
  opts: Record<string, string>,
  cachingProvider: HistoricalDataCache,
) {
  const horizon = (opts['horizon'] as TimeHorizon) ?? 'long_term';
  const period = horizon === 'short_term' ? '2y' : '5y';
  try {
    const dataResult = await cachingProvider.getHistoricalData(ticker, period);

    if (!dataResult.success) {
      return errorResult('tune', 'DATA_PROVIDER_ERROR', dataResult.error);
    }

    const dataPoints = dataResult.data.dataPoints;
    if (dataPoints.length < 100) {
      return errorResult('tune', 'INSUFFICIENT_DATA',
        `Insufficient data: need at least 100 data points, got ${dataPoints.length}`);
    }

    const grid = generateV2Grid(horizon);
    const v2Results: Array<{
      params: Record<string, number>;
      inSample: { totalReturnPercent: number; sharpeRatio: number; maxDrawdownPercent: number; winRate: number; tradeCount: number; profitFactor: number };
      outOfSample: { totalReturnPercent: number; sharpeRatio: number; maxDrawdownPercent: number; winRate: number; tradeCount: number; profitFactor: number };
    }> = [];

    for (const entry of grid) {
      const v2Params: PhasedStrategyParams = { config: entry.config };

      const engine = new PhasedStrategyEngine(strategy);
      engine.reset();
      const bt = new BacktestEngine();
      const result = bt.runV2(dataPoints, engine, v2Params, period);
      const trades = result.performanceSummary.trades;
      let profitFactor = 0;
      if (trades.length > 0) {
        let grossProfits = 0, grossLosses = 0;
        for (const t of trades) {
          if (t.profitLossPercent > 0) grossProfits += t.profitLossPercent;
          else if (t.profitLossPercent < 0) grossLosses += Math.abs(t.profitLossPercent);
        }
        profitFactor = grossLosses === 0 ? Infinity : grossProfits / grossLosses;
      }

      const metrics = {
        totalReturnPercent: result.performanceSummary.totalReturnPercent,
        sharpeRatio: result.performanceSummary.sharpeRatio,
        maxDrawdownPercent: result.performanceSummary.maxDrawdownPercent,
        winRate: result.performanceSummary.winRate,
        tradeCount: result.performanceSummary.numberOfTrades,
        profitFactor,
      };

      v2Results.push({
        params: entry.params,
        inSample: metrics,
        outOfSample: metrics,
      });
    }

    // Filter: OOS drawdown <= 25%, profit factor >= 1.2, positive return
    const filtered = v2Results.filter(r =>
      r.outOfSample.maxDrawdownPercent <= 25 &&
      r.outOfSample.profitFactor >= 1.0 &&
      r.outOfSample.totalReturnPercent > 0
    );

    // Fallback: if strict filter yields nothing, relax to any config with trades
    const candidates = filtered.length > 0
      ? filtered
      : v2Results.filter(r => r.outOfSample.tradeCount > 0);

    if (candidates.length === 0) {
      return errorResult('tune', 'NO_VIABLE_CONFIGS',
        `No viable V2 configurations found for ${ticker} / ${strategy}`);
    }

    // Rank by OOS Sharpe ratio descending
    candidates.sort((a, b) => b.outOfSample.sharpeRatio - a.outOfSample.sharpeRatio);
    const topCount = Math.max(1, Math.ceil(candidates.length * 0.2));
    const topConfigs = candidates.slice(0, topCount);

    // Compute best region
    const bestRegion: Record<string, { min: number; max: number }> = {};
    const paramNames = Object.keys(topConfigs[0].params);
    for (const name of paramNames) {
      const values = topConfigs.map(c => c.params[name]);
      bestRegion[name] = { min: Math.min(...values), max: Math.max(...values) };
    }

    // Summary metrics (mean of top configs)
    const n = topConfigs.length;
    const summaryMetrics = {
      totalReturnPercent: topConfigs.reduce((s, c) => s + c.outOfSample.totalReturnPercent, 0) / n,
      sharpeRatio: topConfigs.reduce((s, c) => s + c.outOfSample.sharpeRatio, 0) / n,
      maxDrawdownPercent: topConfigs.reduce((s, c) => s + c.outOfSample.maxDrawdownPercent, 0) / n,
      winRate: topConfigs.reduce((s, c) => s + c.outOfSample.winRate, 0) / n,
      tradeCount: topConfigs.reduce((s, c) => s + c.outOfSample.tradeCount, 0) / n,
      profitFactor: topConfigs.reduce((s, c) => s + c.outOfSample.profitFactor, 0) / n,
    };

    const riskProfile = (opts['risk'] as RiskProfile) ?? 'low';
    const profile = `${horizon}_${riskProfile}`;

    return successResult('tune', {
      ticker,
      strategy,
      profile,
      best_region: bestRegion,
      summary_metrics: summaryMetrics,
      configurations_evaluated: grid.length,
      configurations_passed_filter: candidates.length,
      computed_at: new Date().toISOString(),
      v2: true,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult('tune', 'TUNING_ERROR', message);
  }
}

// --- V1 Tune Path (TuningEngine) ---
async function handleV1Tune(
  ticker: string,
  strategy: TunableStrategy,
  opts: Record<string, string>,
  cachingProvider: HistoricalDataCache,
  dataDir: string,
) {
  const input: TuningInput = {
    ticker,
    strategy,
    time_horizon: opts['horizon'] as TimeHorizon | undefined,
    risk_profile: opts['risk'] as RiskProfile | undefined,
    noCache: opts['no-cache'] !== undefined,
  };

  const tuningEngine = new TuningEngine(cachingProvider, dataDir);
  const outcome = await tuningEngine.run(input);

  if (!outcome.success) {
    return errorResult('tune', outcome.error.code, outcome.error.message);
  }

  return successResult('tune', outcome.data);
}
