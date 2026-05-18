// ============================================================
// Parallel Tune Orchestrator
// ============================================================
// Orchestrates parallel tuning of multiple tickers using the
// WorkerPool. Handles: data fetching → pool dispatch → result
// collection → post-processing (backtest + chart + profile save).
//
// Single-ticker bypass: when only one ticker is specified, runs
// tuneV3() directly on the main thread without spawning workers.
// ============================================================

import { join } from 'node:path';
import type { HistoricalDataCache } from '../data/historical-data-cache.js';
import type { TuneSummary, TuneBatchResult } from '../commands/tune-command.js';
import type { V3TuneResult, TuneResult } from './pipeline-functions.js';
import { tuneV3, backtestV3, renderChart } from './pipeline-functions.js';
import { saveStrategyProfile, computeExpiry } from '../data/profile-store.js';
import type { StrategyProfile, WalkForwardMetrics } from '../data/profile-store.js';
import type { TuningPerformanceMetrics } from './tuning-engine.js';
import { WorkerPool } from './worker-pool.js';
import type { WorkerTask, WorkerResult } from './worker-pool.js';
import { fetchHistoricalDataStream } from '../data/data-fetcher.js';
import { createProgressReporter } from '../formatters/progress-reporter.js';
import type { HistoricalDataPoint } from '../types.js';

// ============================================================
// Options Interface
// ============================================================

export interface ParallelTuneOptions {
  tickers: string[];
  concurrency: number;
  shouldSave: boolean;
  noCache: boolean;
  /** Whether to run backtest + chart after tuning (v3 command behavior) */
  runBacktest: boolean;
  cachingProvider: HistoricalDataCache;
  dataDir: string;
}

// ============================================================
// Internal Helpers
// ============================================================

function toWalkForwardMetrics(m: TuningPerformanceMetrics): WalkForwardMetrics {
  return {
    return: m.totalReturnPercent,
    benchmark: 0,
    win_rate: m.winRate,
    trades: m.tradeCount,
    max_drawdown: m.maxDrawdownPercent,
    sharpe: m.sharpeRatio,
  };
}

function buildStrategySummary(
  ticker: string,
  strategyName: string,
  result: TuneResult | { error: string },
  shouldSave: boolean,
  dataDir: string,
): TuneSummary {
  if ('error' in result) {
    const errorMsg = result.error;
    const isInsufficientData = errorMsg.toLowerCase().includes('insufficient data');
    const isNoViable = errorMsg.toLowerCase().includes('no viable');

    if (isInsufficientData) {
      return {
        ticker,
        strategy: strategyName,
        status: 'insufficient_data',
        profile_saved: false,
        error_message: errorMsg,
      };
    } else if (isNoViable) {
      return {
        ticker,
        strategy: strategyName,
        status: 'no_viable_configs',
        profile_saved: false,
        error_message: errorMsg,
      };
    } else {
      return {
        ticker,
        strategy: strategyName,
        status: 'error',
        profile_saved: false,
        error_message: errorMsg,
      };
    }
  }

  // Successful tune — save profile if requested
  let profileSaved = false;

  if (shouldSave) {
    const lastTunedAt = new Date().toISOString();
    const validUntil = computeExpiry(lastTunedAt);

    const profile: StrategyProfile = {
      ticker,
      strategy: strategyName,
      params: result.bestParams,
      walk_forward_metrics: toWalkForwardMetrics(result.oosMetrics),
      last_tuned_at: lastTunedAt,
      valid_until: validUntil,
    };

    const saveResult = saveStrategyProfile(profile, dataDir);
    profileSaved = saveResult.success;
  }

  return {
    ticker,
    strategy: strategyName,
    status: 'success',
    in_sample: result.isMetrics,
    out_of_sample: result.oosMetrics,
    configurations_evaluated: result.configurationsEvaluated,
    profile_saved: profileSaved,
  };
}

function generateTaskId(taskType: string, ticker: string): string {
  return `${taskType}:${ticker}:${Date.now()}`;
}

/**
 * Process a single ticker's tune result on the main thread.
 * Handles: summary building, backtest + chart (if enabled), profile saving.
 */
function processTickerResult(
  ticker: string,
  v3Result: V3TuneResult,
  data: HistoricalDataPoint[],
  options: ParallelTuneOptions,
): { summaries: TuneSummary[]; succeeded: number; failed: number; skipped: number } {
  const summaries: TuneSummary[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  // Build summaries for all strategies
  const cbSummary = buildStrategySummary(
    ticker, 'consolidation_breakout', v3Result.consolidation_breakout, options.shouldSave, options.dataDir,
  );
  summaries.push(cbSummary);

  const tpSummary = buildStrategySummary(
    ticker, 'trend_pullback', v3Result.trend_pullback, options.shouldSave, options.dataDir,
  );
  summaries.push(tpSummary);

  const bbSummary = buildStrategySummary(
    ticker, 'bear_breakdown', v3Result.bear_breakdown, options.shouldSave, options.dataDir,
  );
  summaries.push(bbSummary);

  const kmrSummary = buildStrategySummary(
    ticker, 'keltner_mean_reversion', v3Result.keltner_mean_reversion, options.shouldSave, options.dataDir,
  );
  summaries.push(kmrSummary);

  // Update counters
  if (cbSummary.status === 'success') succeeded++;
  else if (cbSummary.status === 'error') failed++;
  else skipped++;

  if (tpSummary.status === 'success') succeeded++;
  else if (tpSummary.status === 'error') failed++;
  else skipped++;

  if (bbSummary.status === 'success') succeeded++;
  else if (bbSummary.status === 'error') failed++;
  else skipped++;

  if (kmrSummary.status === 'success') succeeded++;
  else if (kmrSummary.status === 'error') failed++;
  else skipped++;

  // Run backtest + chart on main thread if enabled and at least one strategy succeeded
  if (options.runBacktest) {
    const cbResult = v3Result.consolidation_breakout;
    const tpResult = v3Result.trend_pullback;
    const kmrResult = v3Result.keltner_mean_reversion;
    const bbResult = v3Result.bear_breakdown;

    const hasCbParams = !('error' in cbResult);
    const hasTpParams = !('error' in tpResult);
    const hasKmrParams = !('error' in kmrResult);
    const hasBbParams = !('error' in bbResult);

    if (hasCbParams || hasTpParams) {
      try {
        const cbParams = hasCbParams ? cbResult.bestParams : {};
        const tpParams = hasTpParams ? tpResult.bestParams : {};
        const kmrParams = hasKmrParams ? kmrResult.bestParams : {};
        const bbParams = hasBbParams ? bbResult.bestParams : {};

        if (hasCbParams && hasTpParams) {
          const btResult = backtestV3(data, cbParams, tpParams, kmrParams, bbParams);
          // Render chart for the combined backtest (use consolidation_breakout result for chart)
          renderChart(btResult.consolidation_breakout, data, options.dataDir, ticker);
        }
      } catch {
        // Backtest/chart failures are non-fatal — tuning still succeeded
      }
    }
  }

  return { summaries, succeeded, failed, skipped };
}

// ============================================================
// Single-Ticker Bypass (main thread execution)
// ============================================================

async function tuneSingleTicker(options: ParallelTuneOptions): Promise<TuneBatchResult> {
  const ticker = options.tickers[0];
  const summaries: TuneSummary[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  try {
    // Fetch data on main thread
    let dataResult;
    dataResult = await options.cachingProvider.getHistoricalData(ticker, '5y');

    if (!dataResult.success) {
      return {
        summaries: [
          { ticker, strategy: 'consolidation_breakout', status: 'error', profile_saved: false, error_message: dataResult.error },
          { ticker, strategy: 'trend_pullback', status: 'error', profile_saved: false, error_message: dataResult.error },
          { ticker, strategy: 'bear_breakdown', status: 'error', profile_saved: false, error_message: dataResult.error },
        ],
        total: 2,
        succeeded: 0,
        failed: 2,
        skipped: 0,
      };
    }

    const dataPoints = dataResult.data.dataPoints;

    // Run tuneV3 directly on main thread
    const v3Result = tuneV3(dataPoints);

    // Process result (backtest + chart + profile save)
    const processed = processTickerResult(ticker, v3Result, dataPoints, options);
    summaries.push(...processed.summaries);
    succeeded += processed.succeeded;
    failed += processed.failed;
    skipped += processed.skipped;
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    summaries.push(
      { ticker, strategy: 'consolidation_breakout', status: 'error', profile_saved: false, error_message: message },
      { ticker, strategy: 'trend_pullback', status: 'error', profile_saved: false, error_message: message },
      { ticker, strategy: 'bear_breakdown', status: 'error', profile_saved: false, error_message: message },
    );
    failed += 3;
  }

  return {
    summaries,
    total: 3,
    succeeded,
    failed,
    skipped,
  };
}

// ============================================================
// parallelTune — Main orchestration function
// ============================================================

/**
 * Run tuning for multiple tickers in parallel using the worker pool.
 * Handles: data fetching → pool dispatch → result collection → profile saving.
 * Returns the same TuneBatchResult as sequential execution.
 *
 * When tickers.length === 1, bypasses the pool and runs on the main thread.
 */
export async function parallelTune(options: ParallelTuneOptions): Promise<TuneBatchResult> {
  const { tickers, concurrency, cachingProvider } = options;

  // Single-ticker bypass: run on main thread without pool
  if (tickers.length === 1) {
    return tuneSingleTicker(options);
  }

  // Multi-ticker: use worker pool
  const workerScript = join(__dirname, 'worker-entry.js');
  const pool = new WorkerPool({ concurrency, workerScript });
  const progress = createProgressReporter(tickers.length);

  // Track data per ticker for post-processing on main thread
  const tickerData = new Map<string, HistoricalDataPoint[]>();

  const summaries: TuneSummary[] = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  // Wire progress reporter to pool events
  pool.on('task:start', (ticker: string) => {
    progress.onStart(ticker);
  });

  pool.on('task:complete', (result: WorkerResult) => {
    progress.onComplete(result.ticker, result.success, result.elapsedMs);
  });

  try {
    await pool.initialize();

    // Use streaming fetch to dispatch tasks as data arrives
    const fetchStream = fetchHistoricalDataStream(tickers, cachingProvider, {
      maxConcurrent: 5,
      useCache: !options.noCache,
    });

    // Track which tickers were dispatched to workers
    const dispatchedTickers = new Set<string>();

    // Register result-collecting listener BEFORE dispatching tasks.
    // This prevents a race condition where workers complete tasks during
    // the for-await loop and those 'task:complete' events are missed.
    let completedCount = 0;
    let expectedCount = 0;
    let completionResolve: (() => void) | null = null;

    const onComplete = (result: WorkerResult) => {
      if (!dispatchedTickers.has(result.ticker)) return;

      // Process result on main thread
      if (result.success && result.result) {
        const v3Result = result.result as V3TuneResult;
        const data = tickerData.get(result.ticker);

        if (data) {
          const processed = processTickerResult(result.ticker, v3Result, data, options);
          summaries.push(...processed.summaries);
          succeeded += processed.succeeded;
          failed += processed.failed;
          skipped += processed.skipped;
        }
      } else {
        // Worker failed — record error for all strategies
        const errorMsg = result.error?.message ?? 'Worker execution failed';
        summaries.push(
          { ticker: result.ticker, strategy: 'consolidation_breakout', status: 'error', profile_saved: false, error_message: errorMsg },
          { ticker: result.ticker, strategy: 'trend_pullback', status: 'error', profile_saved: false, error_message: errorMsg },
          { ticker: result.ticker, strategy: 'bear_breakdown', status: 'error', profile_saved: false, error_message: errorMsg },
        );
        failed += 3;
      }

      completedCount++;
      if (completionResolve && completedCount >= expectedCount) {
        pool.removeListener('task:complete', onComplete);
        completionResolve();
      }
    };

    pool.on('task:complete', onComplete);

    for await (const fetchResult of fetchStream) {
      if (!fetchResult.success || !fetchResult.data) {
        // Data fetch failed — record as error for all strategies
        summaries.push(
          { ticker: fetchResult.ticker, strategy: 'consolidation_breakout', status: 'error', profile_saved: false, error_message: fetchResult.error ?? 'Unknown fetch error' },
          { ticker: fetchResult.ticker, strategy: 'trend_pullback', status: 'error', profile_saved: false, error_message: fetchResult.error ?? 'Unknown fetch error' },
          { ticker: fetchResult.ticker, strategy: 'bear_breakdown', status: 'error', profile_saved: false, error_message: fetchResult.error ?? 'Unknown fetch error' },
        );
        failed += 3;
        // Still report progress for skipped tickers
        progress.onStart(fetchResult.ticker);
        progress.onComplete(fetchResult.ticker, false, 0);
        continue;
      }

      // Store data for post-processing
      tickerData.set(fetchResult.ticker, fetchResult.data);

      // Create and submit task
      const task: WorkerTask = {
        taskId: generateTaskId('tune', fetchResult.ticker),
        taskType: 'tune',
        ticker: fetchResult.ticker,
        data: fetchResult.data,
      };

      dispatchedTickers.add(fetchResult.ticker);
      pool.submit(task);
    }

    // Wait for all dispatched tasks to complete (some may have already finished)
    expectedCount = dispatchedTickers.size;
    if (expectedCount > 0 && completedCount < expectedCount) {
      await new Promise<void>((resolve) => {
        completionResolve = resolve;
        // Check again in case all completed between setting expectedCount and here
        if (completedCount >= expectedCount) {
          pool.removeListener('task:complete', onComplete);
          resolve();
        }
      });
    } else {
      pool.removeListener('task:complete', onComplete);
    }
  } finally {
    await pool.shutdown();
  }

  // Print final summary
  progress.printSummary();

  // Free data references
  tickerData.clear();

  const total = tickers.length * 2; // 2 strategies per ticker

  return {
    summaries,
    total,
    succeeded,
    failed,
    skipped,
  };
}
