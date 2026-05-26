// ============================================================
// Parallel Scan Orchestrator
// ============================================================
// Orchestrates parallel signal detection for multiple tickers
// using the WorkerPool. Handles: data fetching → profile loading
// → pool dispatch → result collection → sort by signal priority.
//
// Single-ticker bypass: when only one ticker is specified, runs
// detectSignal() directly on the main thread without spawning workers.
// ============================================================

import { join } from 'node:path';
import type { HistoricalDataCache } from '../data/historical-data-cache.js';
import type { SignalOutput } from '../strategies/strategy-registry.js';
import { detectSignal } from '../strategies/signal-detector.js';
import type { DetectSignalOptions } from '../strategies/signal-detector.js';
import { loadStrategyProfile } from '../data/profile-store.js';
import { sortBySignalPriority, isProfileScopedToUniverse } from '../commands/scan-command.js';
import { WorkerPool } from './worker-pool.js';
import type { WorkerTask, WorkerResult } from './worker-pool.js';
import { fetchHistoricalDataStream } from '../data/data-fetcher.js';
import { EarningsDateProvider } from '../data/earnings-date-provider.js';
import { DEFAULT_PEAD_CONFIG } from '../strategies/strategy-configs.js';
import { createProgressReporter } from '../formatters/progress-reporter.js';
import type { HistoricalDataPoint } from '../types.js';
import { computeConfluence } from '../indicators/confluence-calculator.js';
import { computeRvol } from './rvol.js';
import type { CapTier } from '../utils/universe.js';

// ============================================================
// Options and Result Interfaces
// ============================================================

export interface ParallelScanOptions {
  tickers: string[];
  concurrency: number;
  strategyName: string;
  allowStale: boolean;
  cachingProvider: HistoricalDataCache;
  dataDir: string;
  activeUniverse?: CapTier;
}

export interface ParallelScanResult {
  signals: SignalOutput[];
  warnings: string[];
  total: number;
  scanned: number;
  skipped: number;
}

// ============================================================
// Internal Helpers
// ============================================================

function generateTaskId(taskType: string, ticker: string, strategy: string): string {
  return `${taskType}:${ticker}:${strategy}:${Date.now()}`;
}

/**
 * Resolve which strategies to scan based on the strategyName option.
 * 'v3' expands to both consolidation_breakout and trend_pullback.
 */
function resolveStrategies(strategyName: string): string[] {
  if (strategyName === 'v3') {
    return ['consolidation_breakout', 'trend_pullback', 'bear_breakdown', 'post_earnings_drift', 'keltner_mean_reversion', 'volume_dry_up'];
  }
  return [strategyName];
}

// ============================================================
// Single-Ticker Bypass (main thread execution)
// ============================================================

async function scanSingleTicker(options: ParallelScanOptions): Promise<ParallelScanResult> {
  const ticker = options.tickers[0];
  const signals: SignalOutput[] = [];
  const warnings: string[] = [];

  try {
    // Fetch data on main thread
    const dataResult = await options.cachingProvider.getHistoricalData(ticker, '1y');

    if (!dataResult.success) {
      warnings.push(`[${ticker}] Failed to fetch data: ${dataResult.error}`);
      return {
        signals: [],
        warnings,
        total: 1,
        scanned: 0,
        skipped: 1,
      };
    }

    const dataPoints = dataResult.data.dataPoints;
    const strategies = resolveStrategies(options.strategyName);

    for (const strat of strategies) {
      let params: Record<string, number>;
      let signalOptions: DetectSignalOptions | undefined;

      if (strat === 'post_earnings_drift') {
        // PEAD uses universal defaults — no per-ticker tuning needed
        params = DEFAULT_PEAD_CONFIG as unknown as Record<string, number>;
        const earningsResult = await new EarningsDateProvider({ cacheDir: options.dataDir }).getEarningsDates(ticker);
        signalOptions = { earningsDates: earningsResult.success ? earningsResult.data.dates : [] };
      } else {
        // Load profile
        const profileResult = loadStrategyProfile(ticker, strat, {
          allowStale: options.allowStale,
          baseDir: options.dataDir,
        });

        if (!profileResult.success) {
          if (profileResult.error.code === 'PROFILE_NOT_FOUND') {
            warnings.push(
              `[${ticker}/${strat}] Profile not found. Run: npm run v3 -- --ticker ${ticker}`,
            );
            continue;
          }

          if (profileResult.error.code === 'PROFILE_EXPIRED' && !options.allowStale) {
            warnings.push(
              `[${ticker}/${strat}] Profile expired. Retune with: npm run v3 -- --ticker ${ticker} --force, or use --allow-stale`,
            );
            continue;
          }

          warnings.push(`[${ticker}/${strat}] ${profileResult.error.message}`);
          continue;
        }

        // Profile scoping: check cap_tier matches active universe
        if (options.activeUniverse && !isProfileScopedToUniverse(profileResult.data, options.activeUniverse)) {
          process.stderr.write(
            `[WARN] Skipping profile for ${ticker}: profile cap_tier '${profileResult.data.cap_tier}' does not match active universe '${options.activeUniverse}'. Re-tune with --universe ${options.activeUniverse}.\n`
          );
          // Use default params for this ticker's signal detection
          params = {};
        } else {
          params = profileResult.data.params;
        }
      }

      const signal = detectSignal(dataPoints, params, strat, signalOptions);
      signal.ticker = ticker;
      signals.push(signal);
    }

    // Compute and attach RVOL for all signals from this ticker
    const rvol = computeRvol(dataPoints);
    for (const sig of signals) {
      sig.rvol = rvol;
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    warnings.push(`[${ticker}] Error: ${message}`);
  }

  // Compute and attach confluence for v3 scans
  if (options.strategyName === 'v3' && signals.length > 0) {
    const result = computeConfluence(signals);
    for (const sig of signals) {
      sig.confluence = result.score;
    }
  }

  // Sort by signal priority
  const sorted = sortBySignalPriority(signals);

  return {
    signals: sorted,
    warnings,
    total: 1,
    scanned: signals.length,
    skipped: signals.length === 0 ? 1 : 0,
  };
}

// ============================================================
// parallelScan — Main orchestration function
// ============================================================

/**
 * Run signal detection for multiple tickers in parallel using the worker pool.
 * Handles: data fetching → profile loading → pool dispatch → result collection.
 * Results are sorted by signal priority before returning.
 *
 * When tickers.length === 1, bypasses the pool and runs on the main thread.
 */
export async function parallelScan(options: ParallelScanOptions): Promise<ParallelScanResult> {
  const { tickers, concurrency, cachingProvider, strategyName, allowStale, dataDir } = options;

  // Single-ticker bypass: run on main thread without pool
  if (tickers.length === 1) {
    return scanSingleTicker(options);
  }

  // Multi-ticker: use worker pool
  const workerScript = join(__dirname, 'worker-entry.js');
  const pool = new WorkerPool({ concurrency, workerScript });
  const progress = createProgressReporter(tickers.length);

  const signals: SignalOutput[] = [];
  const warnings: string[] = [];
  let scannedCount = 0;

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
      useCache: true,
    });

    // Track dispatched tasks for completion tracking
    const dispatchedTaskIds = new Set<string>();
    // Map taskId → { ticker, strategy, rvol } for result processing
    const taskMeta = new Map<string, { ticker: string; strategy: string; rvol: number | null }>();

    // Register result-collecting listener BEFORE dispatching tasks.
    // This prevents a race condition where workers complete tasks during
    // the for-await loop and those 'task:complete' events are missed.
    let completedCount = 0;
    let expectedCount = 0;
    let completionResolve: (() => void) | null = null;

    const onComplete = (result: WorkerResult) => {
      if (!dispatchedTaskIds.has(result.taskId)) return;

      if (result.success && result.result) {
        const signalOutput = result.result as SignalOutput;
        const meta = taskMeta.get(result.taskId);
        if (meta) {
          signalOutput.ticker = meta.ticker;
          signalOutput.rvol = meta.rvol;
        }
        signals.push(signalOutput);
        scannedCount++;
      } else {
        // Worker failed — record warning
        const meta = taskMeta.get(result.taskId);
        const errorMsg = result.error?.message ?? 'Worker execution failed';
        if (meta) {
          warnings.push(`[${meta.ticker}/${meta.strategy}] ${errorMsg}`);
        } else {
          warnings.push(`[${result.ticker}] ${errorMsg}`);
        }
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
        // Data fetch failed — record warning and skip
        warnings.push(`[${fetchResult.ticker}] Failed to fetch data: ${fetchResult.error ?? 'Unknown fetch error'}`);
        // Report progress for skipped tickers
        progress.onStart(fetchResult.ticker);
        progress.onComplete(fetchResult.ticker, false, 0);
        continue;
      }

      const strategies = resolveStrategies(strategyName);
      let tickerDispatched = false;

      // Compute RVOL on main thread from fetched data (workers don't return raw bars)
      const tickerRvol = computeRvol(fetchResult.data);

      for (const strat of strategies) {
        let params: Record<string, number>;
        let earningsDates: string[] | undefined;

        if (strat === 'post_earnings_drift') {
          // PEAD uses universal defaults — no per-ticker tuning needed
          params = DEFAULT_PEAD_CONFIG as unknown as Record<string, number>;
          const earningsResult = await new EarningsDateProvider({ cacheDir: dataDir }).getEarningsDates(fetchResult.ticker);
          earningsDates = earningsResult.success ? earningsResult.data.dates : [];
        } else {
          // Load profile on main thread (I/O-bound, lightweight)
          const profileResult = loadStrategyProfile(fetchResult.ticker, strat, {
            allowStale,
            baseDir: dataDir,
          });

          if (!profileResult.success) {
            if (profileResult.error.code === 'PROFILE_NOT_FOUND') {
              warnings.push(
                `[${fetchResult.ticker}/${strat}] Profile not found. Run: npm run v3 -- --ticker ${fetchResult.ticker}`,
              );
              continue;
            }

            if (profileResult.error.code === 'PROFILE_EXPIRED' && !allowStale) {
              warnings.push(
                `[${fetchResult.ticker}/${strat}] Profile expired. Retune with: npm run v3 -- --ticker ${fetchResult.ticker} --force, or use --allow-stale`,
              );
              continue;
            }

            warnings.push(`[${fetchResult.ticker}/${strat}] ${profileResult.error.message}`);
            continue;
          }

          // Profile scoping: check cap_tier matches active universe
          if (options.activeUniverse && !isProfileScopedToUniverse(profileResult.data, options.activeUniverse)) {
            process.stderr.write(
              `[WARN] Skipping profile for ${fetchResult.ticker}: profile cap_tier '${profileResult.data.cap_tier}' does not match active universe '${options.activeUniverse}'. Re-tune with --universe ${options.activeUniverse}.\n`
            );
            // Use default params for this ticker's signal detection
            params = {};
          } else {
            params = profileResult.data.params;
          }
        }

        // Create and submit scan task to worker pool
        const taskId = generateTaskId('scan', fetchResult.ticker, strat);
        const task: WorkerTask = {
          taskId,
          taskType: 'scan',
          ticker: fetchResult.ticker,
          data: fetchResult.data,
          strategy: strat,
          params,
          earningsDates,
        };

        dispatchedTaskIds.add(taskId);
        taskMeta.set(taskId, { ticker: fetchResult.ticker, strategy: strat, rvol: tickerRvol });
        tickerDispatched = true;
        pool.submit(task);
      }

      // If no tasks were dispatched for this ticker (all profiles missing/expired),
      // still report progress
      if (!tickerDispatched) {
        progress.onStart(fetchResult.ticker);
        progress.onComplete(fetchResult.ticker, false, 0);
      }
    }

    // Wait for all dispatched tasks to complete (some may have already finished)
    expectedCount = dispatchedTaskIds.size;
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

  // Compute and attach confluence for v3 scans
  if (strategyName === 'v3' && signals.length > 0) {
    const byTicker = new Map<string, SignalOutput[]>();
    for (const sig of signals) {
      const group = byTicker.get(sig.ticker) ?? [];
      group.push(sig);
      byTicker.set(sig.ticker, group);
    }

    for (const [, tickerSignals] of byTicker) {
      const result = computeConfluence(tickerSignals);
      for (const sig of tickerSignals) {
        sig.confluence = result.score;
      }
    }
  }

  // Sort results by signal priority before returning (same ordering as sequential)
  const sorted = sortBySignalPriority(signals);

  return {
    signals: sorted,
    warnings,
    total: tickers.length,
    scanned: scannedCount,
    skipped: tickers.length - scannedCount,
  };
}
