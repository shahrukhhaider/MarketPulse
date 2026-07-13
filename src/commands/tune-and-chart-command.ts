// ============================================================
// Tune-and-Chart Command — Tune strategy parameters then backtest and chart
// ============================================================

import * as nodePath from 'node:path';
import { writeFileSync } from 'node:fs';
import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { AppDependencies } from '../di/container.js';
import type { HistoricalPeriod } from '../types.js';
import type { TunableStrategy, TimeHorizon, RiskProfile } from '../pipeline/tuning-engine.js';
import { TuningEngine } from '../pipeline/tuning-engine.js';
import type { TuningInput } from '../pipeline/tuning-engine.js';
import { BacktestEngine } from '../pipeline/backtest-engine.js';
import { convertHistoricalData } from '../pipeline/backtest-engine.js';
import { CompositeStrategyEngine } from '../strategies/composite-engine.js';
import { PhasedStrategyEngine } from '../strategies/phased-engine.js';
import type { CompositeStrategyParams, PhasedStrategyParams } from '../strategies/strategy-configs.js';
import { buildConfig, buildV2Config, generateV2Grid } from '../strategies/parameter-grid.js';
import { tuneV3, backtestV3 } from '../pipeline/pipeline-functions.js';
import type { V3TuneResult, V3BacktestResult } from '../pipeline/pipeline-functions.js';
import { loadStrategyProfile, saveStrategyProfile, computeExpiry } from '../data/profile-store.js';
import type { StrategyProfile } from '../data/profile-store.js';
import { generateChartHtml, generateCombinedChartHtml, getChartFilePath } from '../formatters/chart-generator.js';

// ============================================================
// createTuneAndChartHandler
// ============================================================

export function createTuneAndChartHandler(deps: AppDependencies): CommandHandler {
  const { cachingProvider, priceFeedClient, dataDir } = deps;

  return async (opts: Record<string, string>) => {
    const ticker = opts['ticker'].toUpperCase();
    const strategy = opts['strategy'] as TunableStrategy;
    const horizon = (opts['horizon'] as TimeHorizon) ?? 'long_term';
    const noCache = opts['no-cache'] !== undefined;
    const isV3 = opts['v3'] !== undefined;
    const isV2 = opts['v2'] !== undefined;

    if (isV3) {
      return handleV3TuneAndChart(opts, ticker, strategy, horizon, cachingProvider, dataDir);
    }

    if (isV2) {
      return handleV2TuneAndChart(opts, ticker, strategy, horizon, cachingProvider, dataDir);
    }

    // V1 tune-and-chart path
    return handleV1TuneAndChart(opts, ticker, strategy, horizon, noCache, cachingProvider, priceFeedClient, dataDir);
  };
}

// ============================================================
// V3 Tune-and-Chart
// ============================================================

async function handleV3TuneAndChart(
  opts: Record<string, string>,
  ticker: string,
  strategy: TunableStrategy,
  horizon: TimeHorizon,
  cachingProvider: AppDependencies['cachingProvider'],
  dataDir: string,
) {
  const period = '5y';
  const forceTune = opts['force'] !== undefined;

  try {
    // Step 1: Fetch data
    const dataResult = await cachingProvider.getHistoricalData(ticker, period);

    if (!dataResult.success) {
      return errorResult('tune-and-chart', 'DATA_PROVIDER_ERROR', dataResult.error);
    }

    const dataPoints = dataResult.data.dataPoints;

    // Step 2: Check for fresh profiles — skip tuning if both exist and are valid
    let cbBestParams: Record<string, number> = {};
    let tpBestParams: Record<string, number> = {};
    let bbBestParams: Record<string, number> = {};
    let kmrBestParams: Record<string, number> = {};
    let vduBestParams: Record<string, number> = {};
    let cbTuneResult: V3TuneResult['consolidation_breakout'] = { error: 'skipped' };
    let tpTuneResult: V3TuneResult['trend_pullback'] = { error: 'skipped' };
    let bbTuneResult: V3TuneResult['bear_breakdown'] = { error: 'skipped' };
    let kmrTuneResult: V3TuneResult['keltner_mean_reversion'] = { error: 'skipped' };
    let vduTuneResult: V3TuneResult['volume_dry_up'] = { error: 'skipped' };
    let tuningSkipped = false;

    if (!forceTune) {
      const cbProfile = loadStrategyProfile(ticker, 'consolidation_breakout', { baseDir: dataDir });
      const tpProfile = loadStrategyProfile(ticker, 'trend_pullback', { baseDir: dataDir });
      const bbProfile = loadStrategyProfile(ticker, 'bear_breakdown', { baseDir: dataDir });
      const kmrProfile = loadStrategyProfile(ticker, 'keltner_mean_reversion', { baseDir: dataDir });
      const vduProfile = loadStrategyProfile(ticker, 'volume_dry_up', { baseDir: dataDir });

      if (cbProfile.success && tpProfile.success) {
        // Both core profiles are fresh — skip tuning
        cbBestParams = cbProfile.data.params;
        tpBestParams = tpProfile.data.params;
        if (bbProfile.success) {
          bbBestParams = bbProfile.data.params;
        }
        if (kmrProfile.success) {
          kmrBestParams = kmrProfile.data.params;
        }
        if (vduProfile.success) {
          vduBestParams = vduProfile.data.params;
        }
        tuningSkipped = true;
      }
    }

    if (!tuningSkipped) {
      // Run full tuning
      const v3TuneResult = tuneV3(dataPoints);

      cbTuneResult = v3TuneResult.consolidation_breakout;
      tpTuneResult = v3TuneResult.trend_pullback;
      bbTuneResult = v3TuneResult.bear_breakdown;
      kmrTuneResult = v3TuneResult.keltner_mean_reversion;
      vduTuneResult = v3TuneResult.volume_dry_up;

      cbBestParams = !('error' in cbTuneResult) ? cbTuneResult.bestParams : {};
      tpBestParams = !('error' in tpTuneResult) ? tpTuneResult.bestParams : {};
      bbBestParams = !('error' in bbTuneResult) ? bbTuneResult.bestParams : {};
      kmrBestParams = !('error' in kmrTuneResult) ? kmrTuneResult.bestParams : {};
      vduBestParams = !('error' in vduTuneResult) ? vduTuneResult.bestParams : {};
    }

    // Step 3: Backtest both strategies with their best params
    const v3BacktestResult: V3BacktestResult = backtestV3(dataPoints, cbBestParams, tpBestParams, kmrBestParams, bbBestParams, vduBestParams);
    v3BacktestResult.consolidation_breakout.ticker = ticker;
    v3BacktestResult.trend_pullback.ticker = ticker;
    if (v3BacktestResult.keltner_mean_reversion) {
      v3BacktestResult.keltner_mean_reversion.ticker = ticker;
    }
    if (v3BacktestResult.bear_breakdown) {
      v3BacktestResult.bear_breakdown.ticker = ticker;
    }
    if (v3BacktestResult.volume_dry_up) {
      v3BacktestResult.volume_dry_up.ticker = ticker;
    }

    // Step 4: Build tuning summary data
    const riskProfile = (opts['risk'] as RiskProfile) ?? 'low';
    const profile = `${horizon}_${riskProfile}`;

    const tuningData = {
      ticker,
      strategy,
      profile,
      tuning_skipped: tuningSkipped,
      consolidation_breakout: tuningSkipped ? 'used_cached_profile' : cbTuneResult,
      trend_pullback: tuningSkipped ? 'used_cached_profile' : tpTuneResult,
      bear_breakdown: tuningSkipped ? 'used_cached_profile' : bbTuneResult,
      keltner_mean_reversion: tuningSkipped ? 'used_cached_profile' : kmrTuneResult,
      volume_dry_up: tuningSkipped ? 'used_cached_profile' : vduTuneResult,
      computed_at: new Date().toISOString(),
      v3: true,
    };

    // Step 5: Generate combined chart
    const chartFilePath = getChartFilePath(dataDir, ticker);
    const html = generateCombinedChartHtml({
      cbResult: v3BacktestResult.consolidation_breakout,
      tpResult: v3BacktestResult.trend_pullback,
      kmrResult: v3BacktestResult.keltner_mean_reversion,
      bbResult: v3BacktestResult.bear_breakdown,
      dataPoints,
      combinedMetrics: v3BacktestResult.combined,
    });
    writeFileSync(chartFilePath, html, 'utf-8');

    // Step 6: Save profiles if --save is specified and tuning was actually performed
    let profileSaved = false;
    if (opts['save'] !== undefined && !tuningSkipped) {
      profileSaved = saveAllProfiles(
        ticker, dataDir,
        cbBestParams, tpBestParams, bbBestParams, kmrBestParams, vduBestParams,
        cbTuneResult, tpTuneResult, bbTuneResult, kmrTuneResult, vduTuneResult,
        v3BacktestResult,
      );
    }

    return successResult('tune-and-chart', {
      tuning: tuningData,
      best_params: {
        consolidation_breakout: cbBestParams,
        trend_pullback: tpBestParams,
        bear_breakdown: bbBestParams,
        keltner_mean_reversion: kmrBestParams,
        volume_dry_up: vduBestParams,
      },
      profile_saved: profileSaved,
      backtest: {
        ...v3BacktestResult,
        chartFilePath,
        chartUrl: `file://${nodePath.resolve(chartFilePath)}`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult('tune-and-chart', 'BACKTEST_ERROR', message);
  }
}

// ============================================================
// V2 Tune-and-Chart
// ============================================================

async function handleV2TuneAndChart(
  opts: Record<string, string>,
  ticker: string,
  strategy: TunableStrategy,
  horizon: TimeHorizon,
  cachingProvider: AppDependencies['cachingProvider'],
  dataDir: string,
) {
  const period = horizon === 'short_term' ? '2y' : '5y';

  try {
    // Step 1: Run V2 tuning inline (same logic as tune --v2)
    const dataResult = await cachingProvider.getHistoricalData(ticker, period);

    if (!dataResult.success) {
      return errorResult('tune-and-chart', 'DATA_PROVIDER_ERROR', dataResult.error);
    }

    const dataPoints = dataResult.data.dataPoints;
    if (dataPoints.length < 100) {
      return errorResult('tune-and-chart', 'INSUFFICIENT_DATA',
        `Insufficient data: need at least 100 data points, got ${dataPoints.length}`);
    }

    const grid = generateV2Grid(horizon);
    const v2Results: Array<{
      params: Record<string, number>;
      outOfSample: { totalReturnPercent: number; sharpeRatio: number; maxDrawdownPercent: number; winRate: number; tradeCount: number; profitFactor: number };
    }> = [];

    for (const entry of grid) {
      const v2Params: PhasedStrategyParams = { config: entry.config };

      const btEngine = new PhasedStrategyEngine(strategy);
      btEngine.reset();
      const bt = new BacktestEngine();
      const result = bt.runV2(dataPoints, btEngine, v2Params, period);
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

      v2Results.push({
        params: entry.params,
        outOfSample: {
          totalReturnPercent: result.performanceSummary.totalReturnPercent,
          sharpeRatio: result.performanceSummary.sharpeRatio,
          maxDrawdownPercent: result.performanceSummary.maxDrawdownPercent,
          winRate: result.performanceSummary.winRate,
          tradeCount: result.performanceSummary.numberOfTrades,
          profitFactor,
        },
      });
    }

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
      return errorResult('tune-and-chart', 'NO_VIABLE_CONFIGS',
        `No viable V2 configurations found for ${ticker} / ${strategy}`);
    }

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

    const riskProfile = (opts['risk'] as RiskProfile) ?? 'low';
    const profile = `${horizon}_${riskProfile}`;
    const n = topConfigs.length;
    const summaryMetrics = {
      totalReturnPercent: topConfigs.reduce((s, c) => s + c.outOfSample.totalReturnPercent, 0) / n,
      sharpeRatio: topConfigs.reduce((s, c) => s + c.outOfSample.sharpeRatio, 0) / n,
      maxDrawdownPercent: topConfigs.reduce((s, c) => s + c.outOfSample.maxDrawdownPercent, 0) / n,
      winRate: topConfigs.reduce((s, c) => s + c.outOfSample.winRate, 0) / n,
      tradeCount: topConfigs.reduce((s, c) => s + c.outOfSample.tradeCount, 0) / n,
      profitFactor: topConfigs.reduce((s, c) => s + c.outOfSample.profitFactor, 0) / n,
    };

    const tuningData = {
      ticker,
      strategy,
      profile,
      best_region: bestRegion,
      summary_metrics: summaryMetrics,
      configurations_evaluated: grid.length,
      configurations_passed_filter: candidates.length,
      computed_at: new Date().toISOString(),
      v2: true,
    };

    // Step 2: Compute midpoint params from best_region
    const midpointParams: Record<string, number> = {};
    for (const [key, range] of Object.entries(bestRegion)) {
      midpointParams[key] = (range.min + range.max) / 2;
    }

    // Step 3: Build V2 config from midpoint params
    const minHoldDays = horizon === 'short_term' ? 7 : 30;
    const v2Config = buildV2Config(midpointParams, minHoldDays);
    const v2Params: PhasedStrategyParams = { config: v2Config, primaryDataPoints: dataPoints };

    // Step 4: Run backtest with V2 config on full data
    const v2Engine = new PhasedStrategyEngine(strategy);
    v2Engine.reset();
    const btEngine = new BacktestEngine();
    const backtestResult = btEngine.runV2(dataPoints, v2Engine, v2Params, period);

    // Step 5: Generate chart
    const chartFilePath = getChartFilePath(dataDir, ticker);
    const html = generateChartHtml({
      backtestResult,
      dataPoints,
      strategyParams: v2Params,
    });
    writeFileSync(chartFilePath, html, 'utf-8');

    return successResult('tune-and-chart', {
      tuning: tuningData,
      midpoint_params: midpointParams,
      backtest: { ...backtestResult, chartFilePath, chartUrl: `file://${nodePath.resolve(chartFilePath)}` },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult('tune-and-chart', 'BACKTEST_ERROR', message);
  }
}

// ============================================================
// V1 Tune-and-Chart
// ============================================================

async function handleV1TuneAndChart(
  opts: Record<string, string>,
  ticker: string,
  strategy: TunableStrategy,
  horizon: TimeHorizon,
  noCache: boolean,
  cachingProvider: AppDependencies['cachingProvider'],
  priceFeedClient: AppDependencies['priceFeedClient'],
  dataDir: string,
) {
  // Step 1: Run tuning
  const tuningInput: TuningInput = {
    ticker,
    strategy,
    time_horizon: horizon,
    risk_profile: opts['risk'] as RiskProfile | undefined,
    noCache,
  };

  const tuningEngine = new TuningEngine(cachingProvider, dataDir);
  const outcome = await tuningEngine.run(tuningInput);

  if (!outcome.success) {
    return errorResult('tune-and-chart', outcome.error.code, outcome.error.message);
  }

  // Step 2: Compute midpoint params from best_region
  const bestRegion = outcome.data.best_region;
  const midpointParams: Record<string, number> = {};
  for (const [key, range] of Object.entries(bestRegion)) {
    midpointParams[key] = (range.min + range.max) / 2;
  }

  // Step 3: Build StrategyConfiguration from midpoint params
  const config = buildConfig(strategy, midpointParams);
  const compositeParams: CompositeStrategyParams = { config };

  // Step 4: Fetch historical data for backtest
  const period = horizon === 'short_term' ? '2y' : '5y';
  try {
    const histResult = await priceFeedClient.fetchHistoricalData(ticker, period);
    if (!histResult.success) {
      return errorResult('tune-and-chart', 'DATA_PROVIDER_ERROR', histResult.error);
    }

    const pricePoints = convertHistoricalData(histResult.data.dataPoints, ticker);

    // Inject primary data and auxiliary data
    compositeParams.primaryDataPoints = histResult.data.dataPoints;
    const indexTicker = config.indexTicker;
    if (indexTicker) {
      try {
        const auxResult = await priceFeedClient.fetchHistoricalData(indexTicker, period);
        if (auxResult.success) {
          compositeParams.auxiliaryData = { [indexTicker]: auxResult.data.dataPoints };
        }
      } catch {
        // Non-fatal
      }
    }

    // Step 5: Run backtest
    const strategyInstance = new CompositeStrategyEngine(strategy);
    const engine = new BacktestEngine();
    const backtestResult = engine.run(pricePoints, strategyInstance, compositeParams, period);

    // Step 6: Generate chart
    const chartFilePath = getChartFilePath(dataDir, ticker);
    const html = generateChartHtml({
      backtestResult,
      dataPoints: histResult.data.dataPoints,
      strategyParams: compositeParams,
    });
    writeFileSync(chartFilePath, html, 'utf-8');

    // Step 7: Return combined result
    return successResult('tune-and-chart', {
      tuning: outcome.data,
      midpoint_params: midpointParams,
      backtest: { ...backtestResult, chartFilePath, chartUrl: `file://${nodePath.resolve(chartFilePath)}` },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult('tune-and-chart', 'BACKTEST_ERROR', message);
  }
}

// ============================================================
// Helper: Save all V3 strategy profiles
// ============================================================

function mapBacktestTrades(trades: import('../types.js').Trade[]): import('../data/profile-store.js').ProfileTrade[] {
  return trades.map((t) => ({
    entry_date: t.buySignal.timestamp.split('T')[0],
    exit_date: t.sellSignal.timestamp.split('T')[0],
    entry_price: t.buySignal.price,
    exit_price: t.sellSignal.price,
    won: t.profitLossPercent > 0,
    pnl_pct: t.profitLossPercent,
  }));
}

function mapOosTrades(
  oos: import('../pipeline/tuning-engine.js').TuningPerformanceMetrics | null
): import('../data/profile-store.js').ProfileTrade[] | undefined {
  return oos?.trades?.map((t) => ({
    entry_date: t.entryDate,
    exit_date: t.exitDate,
    entry_price: t.entryPrice,
    exit_price: t.exitPrice,
    won: t.pnlPct > 0,
    pnl_pct: t.pnlPct,
  }));
}

function saveAllProfiles(
  ticker: string,
  dataDir: string,
  cbBestParams: Record<string, number>,
  tpBestParams: Record<string, number>,
  bbBestParams: Record<string, number>,
  kmrBestParams: Record<string, number>,
  vduBestParams: Record<string, number>,
  cbTuneResult: V3TuneResult['consolidation_breakout'],
  tpTuneResult: V3TuneResult['trend_pullback'],
  bbTuneResult: V3TuneResult['bear_breakdown'],
  kmrTuneResult: V3TuneResult['keltner_mean_reversion'],
  vduTuneResult: V3TuneResult['volume_dry_up'],
  v3BacktestResult?: V3BacktestResult,
): boolean {
  const lastTunedAt = new Date().toISOString();
  const validUntil = computeExpiry(lastTunedAt);

  if (Object.keys(cbBestParams).length > 0) {
    const cbOos = !('error' in cbTuneResult) ? cbTuneResult.oosMetrics : null;
    const cbProfile: StrategyProfile = {
      ticker,
      strategy: 'consolidation_breakout',
      params: cbBestParams,
      walk_forward_metrics: {
        return: cbOos ? cbOos.totalReturnPercent : 0,
        benchmark: 0,
        win_rate: cbOos ? cbOos.winRate : 0,
        trades: cbOos ? cbOos.tradeCount : 0,
        max_drawdown: cbOos ? cbOos.maxDrawdownPercent : 0,
        sharpe: cbOos ? cbOos.sharpeRatio : 0,
      },
      last_tuned_at: lastTunedAt,
      valid_until: validUntil,
      oos_trades: mapOosTrades(cbOos),
      all_trades: v3BacktestResult
        ? mapBacktestTrades(v3BacktestResult.consolidation_breakout.performanceSummary.trades)
        : undefined,
    };
    saveStrategyProfile(cbProfile, dataDir);
  }

  if (Object.keys(tpBestParams).length > 0) {
    const tpOos = !('error' in tpTuneResult) ? tpTuneResult.oosMetrics : null;
    const tpProfile: StrategyProfile = {
      ticker,
      strategy: 'trend_pullback',
      params: tpBestParams,
      walk_forward_metrics: {
        return: tpOos ? tpOos.totalReturnPercent : 0,
        benchmark: 0,
        win_rate: tpOos ? tpOos.winRate : 0,
        trades: tpOos ? tpOos.tradeCount : 0,
        max_drawdown: tpOos ? tpOos.maxDrawdownPercent : 0,
        sharpe: tpOos ? tpOos.sharpeRatio : 0,
      },
      last_tuned_at: lastTunedAt,
      valid_until: validUntil,
      oos_trades: mapOosTrades(tpOos),
      all_trades: v3BacktestResult
        ? mapBacktestTrades(v3BacktestResult.trend_pullback.performanceSummary.trades)
        : undefined,
    };
    saveStrategyProfile(tpProfile, dataDir);
  }

  if (Object.keys(bbBestParams).length > 0) {
    const bbOos = !('error' in bbTuneResult) ? bbTuneResult.oosMetrics : null;
    const bbProfile: StrategyProfile = {
      ticker,
      strategy: 'bear_breakdown',
      params: bbBestParams,
      walk_forward_metrics: {
        return: bbOos ? bbOos.totalReturnPercent : 0,
        benchmark: 0,
        win_rate: bbOos ? bbOos.winRate : 0,
        trades: bbOos ? bbOos.tradeCount : 0,
        max_drawdown: bbOos ? bbOos.maxDrawdownPercent : 0,
        sharpe: bbOos ? bbOos.sharpeRatio : 0,
      },
      last_tuned_at: lastTunedAt,
      valid_until: validUntil,
      oos_trades: mapOosTrades(bbOos),
      all_trades: v3BacktestResult?.bear_breakdown
        ? mapBacktestTrades(v3BacktestResult.bear_breakdown.performanceSummary.trades)
        : undefined,
    };
    saveStrategyProfile(bbProfile, dataDir);
  }

  if (Object.keys(kmrBestParams).length > 0) {
    const kmrOos = !('error' in kmrTuneResult) ? kmrTuneResult.oosMetrics : null;
    const kmrProfile: StrategyProfile = {
      ticker,
      strategy: 'keltner_mean_reversion',
      params: kmrBestParams,
      walk_forward_metrics: {
        return: kmrOos ? kmrOos.totalReturnPercent : 0,
        benchmark: 0,
        win_rate: kmrOos ? kmrOos.winRate : 0,
        trades: kmrOos ? kmrOos.tradeCount : 0,
        max_drawdown: kmrOos ? kmrOos.maxDrawdownPercent : 0,
        sharpe: kmrOos ? kmrOos.sharpeRatio : 0,
      },
      last_tuned_at: lastTunedAt,
      valid_until: validUntil,
      oos_trades: mapOosTrades(kmrOos),
      all_trades: v3BacktestResult?.keltner_mean_reversion
        ? mapBacktestTrades(v3BacktestResult.keltner_mean_reversion.performanceSummary.trades)
        : undefined,
    };
    saveStrategyProfile(kmrProfile, dataDir);
  }

  if (Object.keys(vduBestParams).length > 0) {
    const vduOos = !('error' in vduTuneResult) ? vduTuneResult.oosMetrics : null;
    const vduProfile: StrategyProfile = {
      ticker,
      strategy: 'volume_dry_up',
      params: vduBestParams,
      walk_forward_metrics: {
        return: vduOos ? vduOos.totalReturnPercent : 0,
        benchmark: 0,
        win_rate: vduOos ? vduOos.winRate : 0,
        trades: vduOos ? vduOos.tradeCount : 0,
        max_drawdown: vduOos ? vduOos.maxDrawdownPercent : 0,
        sharpe: vduOos ? vduOos.sharpeRatio : 0,
      },
      last_tuned_at: lastTunedAt,
      valid_until: validUntil,
      oos_trades: mapOosTrades(vduOos),
      all_trades: v3BacktestResult?.volume_dry_up
        ? mapBacktestTrades(v3BacktestResult.volume_dry_up.performanceSummary.trades)
        : undefined,
    };
    saveStrategyProfile(vduProfile, dataDir);
  }

  return true;
}
