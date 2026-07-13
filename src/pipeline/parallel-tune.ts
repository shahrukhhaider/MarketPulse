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
import type { V3TuneResult } from './pipeline-functions.js';
import { tuneV3, backtestV3 } from './pipeline-functions.js';
import { loadStrategyProfile, saveStrategyProfile } from '../data/profile-store.js';
import type { Trade } from '../types.js';
import { WorkerPool } from './worker-pool.js';
import type { WorkerTask, WorkerResult } from './worker-pool.js';
import { fetchHistoricalDataStream } from '../data/data-fetcher.js';
import { createProgressReporter } from '../formatters/progress-reporter.js';
import type { HistoricalDataPoint } from '../types.js';
import { buildStrategySummary, toWalkForwardMetrics } from './strategy-summary.js';


// ============================================================
// Options Interface
// ============================================================

export interface ParallelTuneOptions {
  tickers: string[];
  concurrency: number;
  shouldSave: boolean;
  noCache: boolean;
  cachingProvider: HistoricalDataCache;
  dataDir: string;
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

  const vduSummary = buildStrategySummary(
    ticker, 'volume_dry_up', v3Result.volume_dry_up, options.shouldSave, options.dataDir,
  );
  summaries.push(vduSummary);

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

  if (vduSummary.status === 'success') succeeded++;
  else if (vduSummary.status === 'error') failed++;
  else skipped++;

  // Run backtestV3 to extract full trade history and patch saved profiles with all_trades.
  // Non-fatal: if it fails, profiles still have oos_trades for chart fallback.
  if (options.shouldSave) {
    try {
      const cbResult = v3Result.consolidation_breakout;
      const tpResult = v3Result.trend_pullback;
      const hasCb = !('error' in cbResult);
      const hasTp = !('error' in tpResult);
      if (hasCb || hasTp) {
        const kmrResult = v3Result.keltner_mean_reversion;
        const bbResult = v3Result.bear_breakdown;
        const vduResult = v3Result.volume_dry_up;
        const cbParams = hasCb ? cbResult.bestParams : {};
        const tpParams = hasTp ? tpResult.bestParams : {};
        const kmrParams = !('error' in kmrResult) ? kmrResult.bestParams : {};
        const bbParams = !('error' in bbResult) ? bbResult.bestParams : {};
        const vduParams = !('error' in vduResult) ? vduResult.bestParams : {};

        const btResult = backtestV3(data, cbParams, tpParams, kmrParams, bbParams, vduParams);

        const mapTrades = (trades: Trade[]) => trades.map((t) => ({
          entry_date: t.buySignal.timestamp.split('T')[0],
          exit_date: t.sellSignal.timestamp.split('T')[0],
          entry_price: t.buySignal.price,
          exit_price: t.sellSignal.price,
          won: t.profitLossPercent > 0,
          pnl_pct: t.profitLossPercent,
        }));

        const strategyTradeMap: Record<string, ReturnType<typeof mapTrades>> = {
          consolidation_breakout: mapTrades(btResult.consolidation_breakout.performanceSummary.trades),
          trend_pullback: mapTrades(btResult.trend_pullback.performanceSummary.trades),
          keltner_mean_reversion: btResult.keltner_mean_reversion
            ? mapTrades(btResult.keltner_mean_reversion.performanceSummary.trades) : [],
          bear_breakdown: btResult.bear_breakdown
            ? mapTrades(btResult.bear_breakdown.performanceSummary.trades) : [],
          volume_dry_up: btResult.volume_dry_up
            ? mapTrades(btResult.volume_dry_up.performanceSummary.trades) : [],
        };

        for (const [strategyName, allTrades] of Object.entries(strategyTradeMap)) {
          const profileResult = loadStrategyProfile(ticker, strategyName, {
            allowStale: true,
            baseDir: options.dataDir,
          });
          if (profileResult.success) {
            saveStrategyProfile({ ...profileResult.data, all_trades: allTrades }, options.dataDir);
          }
        }
      }
    } catch {
      // Non-fatal — oos_trades fallback still works for chart display
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
