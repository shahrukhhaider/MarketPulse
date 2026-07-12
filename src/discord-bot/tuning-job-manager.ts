/**
 * Tuning Job Manager
 *
 * Tracks in-progress tuning jobs and provides the `runTuningJob` function
 * for fire-and-forget background tuning of individual tickers.
 */

import * as path from 'node:path';
import type { TuneSummary } from '../commands/tune-command.js';
import { executeScanTicker } from './scan-ticker-executor.js';
import type { ScanTickerResult } from './scan-ticker-executor.js';

/**
 * Module-level set tracking uppercase ticker symbols currently being tuned.
 * Used for deduplication — prevents the same ticker from being tuned concurrently.
 */
export const inProgressTickers: Set<string> = new Set();

// ============================================================
// Strategy display names
// ============================================================

const STRATEGY_DISPLAY_NAMES: Record<string, string> = {
  consolidation_breakout: 'Consolidation Breakout',
  trend_pullback: 'Trend Pullback',
  bear_breakdown: 'Bear Breakdown',
  keltner_mean_reversion: 'Keltner Mean Reversion',
  volume_dry_up: 'Volume Dry-Up',
};

// ============================================================
// Message Formatting Helpers
// ============================================================

function formatStrategyResult(summary: TuneSummary): string {
  const name = STRATEGY_DISPLAY_NAMES[summary.strategy] ?? summary.strategy;

  if (summary.status === 'no_viable_configs') {
    return `• ${name} — no viable config found`;
  }

  if (summary.status === 'insufficient_data') {
    return `• ${name} — insufficient data`;
  }

  if (summary.status === 'error') {
    return `• ${name} — error during tuning`;
  }

  // success — format OOS metrics
  const oos = summary.out_of_sample;
  if (!oos) {
    return `• ${name} — tuned (no OOS data)`;
  }

  const returnSign = oos.totalReturnPercent >= 0 ? '+' : '';
  const returnPct = `${returnSign}${Math.round(oos.totalReturnPercent)}%`;
  const winRate = `${Math.round(oos.winRate * 100)}%`;
  const trades = oos.tradeCount;

  return `• ${name} — OOS return: ${returnPct}, win rate: ${winRate}, ${trades} trades`;
}

function formatScanSignal(scanResult: ScanTickerResult): string {
  if (!scanResult.best) {
    return '• No active setup right now';
  }

  const stratName = STRATEGY_DISPLAY_NAMES[scanResult.best.strategy] ?? scanResult.best.strategy;
  const signal = scanResult.best.signal;
  const confidence = Math.round(scanResult.best.confidence * 100);

  return `• ${stratName} — ${signal} signal (${confidence}% confidence), entry $${scanResult.best.entry}, stop $${scanResult.best.stop}, target $${scanResult.best.target}`;
}

function buildCompletionMessage(
  ticker: string,
  summaries: TuneSummary[],
  scanResult: ScanTickerResult | null,
): string {
  const lines: string[] = [];

  lines.push(`**${ticker} tuning complete!**`);
  lines.push('');
  lines.push('Walk-forward results (5y in-sample / out-of-sample):');

  for (const summary of summaries) {
    lines.push(formatStrategyResult(summary));
  }

  lines.push('');
  lines.push('Current signal after tuning:');

  if (scanResult) {
    lines.push(formatScanSignal(scanResult));
  } else {
    lines.push('• Signal scan unavailable');
  }

  lines.push('');
  lines.push(`Add ${ticker} to your watchlist to get live alerts when it triggers.`);

  return lines.join('\n');
}

// ============================================================
// runTuningJob
// ============================================================

/**
 * Fire-and-forget tuning job for a single ticker.
 *
 * Adds ticker to inProgressTickers, runs parallelTune in a detached promise,
 * posts completion/error message via postToChannel, and cleans up the set.
 *
 * Return type is void — does NOT await the tuning promise.
 */
export function runTuningJob(
  ticker: string,
  postToChannel: (msg: string) => Promise<void>,
): void {
  const normalizedTicker = ticker.toUpperCase();
  inProgressTickers.add(normalizedTicker);

  // Fire-and-forget — detached async IIFE
  void (async () => {
    try {
      // Resolve paths same way as scan-ticker-executor.ts
      const basePath = process.env.STOCK_TRACKER_HOME ?? process.cwd();
      const dataDir = path.join(basePath, '.stock-tracker');

      // Dynamic import to avoid circular dependency issues
      const { YahooFinanceAdapter } = await import('../data/yahoo-finance-adapter.js');
      const { HistoricalDataCache } = await import('../data/historical-data-cache.js');
      const { parallelTune } = await import('../pipeline/parallel-tune.js');

      const yahooAdapter = new YahooFinanceAdapter();
      const cachingProvider = new HistoricalDataCache(yahooAdapter, {
        cacheDir: path.join(basePath, '.stock-tracker', 'history-cache'),
      });

      // Run the tune
      const result = await parallelTune({
        tickers: [normalizedTicker],
        concurrency: 1,
        shouldSave: true,
        noCache: false,
        cachingProvider,
        dataDir,
      });

      // Post-tune signal scan
      let scanResult: ScanTickerResult | null = null;
      const scanOutput = await executeScanTicker(normalizedTicker);
      if (!('error' in scanOutput)) {
        scanResult = scanOutput;
      }

      // Format and post completion message
      const message = buildCompletionMessage(normalizedTicker, result.summaries, scanResult);
      await postToChannel(message);
    } catch (e: unknown) {
      // Format and post error message
      const reason = e instanceof Error ? e.message : String(e);
      await postToChannel(`Tuning failed for ${normalizedTicker}: ${reason}. Try again later.`);
    } finally {
      inProgressTickers.delete(normalizedTicker);
    }
  })();
}
