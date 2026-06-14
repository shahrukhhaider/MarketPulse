// ============================================================
// Blog Charts Command — Generate PNG charts for blog posts
// ============================================================
// Reads signal-history.ndjson, selects the best example signal
// for each target strategy, generates PNG charts via the existing
// chart generator pipeline, and writes them to the web repo's
// public assets folder.
//
// Usage: cli.js generate-blog-charts [--output <dir>] [--strategy <name>] [--data-dir <path>]
// ============================================================

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { ActiveSignal, SignalEntry } from '../signal-history/signal-entry.js';
import type { HistoricalDataCache } from '../data/historical-data-cache.js';
import type { SignalInput } from '../chart-types.js';
import { generateChartImages } from '../chart-image-generator.js';

// ============================================================
// Constants
// ============================================================

/** Preferred tickers — recognisable large-cap names for blog readability. */
export const PREFERRED_TICKERS = [
  'AAPL',
  'NVDA',
  'MSFT',
  'AMZN',
  'META',
  'TSLA',
  'GOOGL',
  'GOOG',
  'AVGO',
  'JPM',
] as const;

/** Target strategies that we want blog chart examples for. */
export const TARGET_STRATEGIES = [
  'consolidation_breakout',
  'trend_pullback',
  'volume_dry_up',
  'bear_breakdown',
  'keltner_mean_reversion',
] as const;

// ============================================================
// Types
// ============================================================

export interface SignalCandidate {
  ticker: string;
  strategy: string;
  entry: number;
  stop: number;
  target: number;
  confidence: number;
  date: string;
  ageDays: number;
  isPreferred: boolean;
}

export interface BlogChartsCommandDeps {
  dataDir: string;
  cachingProvider: HistoricalDataCache;
}

// ============================================================
// selectBestSignal — Core selection logic
// ============================================================

/**
 * Reads NDJSON signal history, filters for active signals matching the
 * given strategy, scores candidates by preferred ticker membership +
 * confidence + age (must be ≥30 days old), and returns the best match.
 *
 * Scoring: preferred ticker bonus (100) + confidence (0–1) + age bonus (0.01 per day, capped at 1).
 * Signals younger than 30 days are excluded so that the chart shows
 * enough post-signal price action.
 */
export function selectBestSignal(
  strategy: string,
  historyPath: string,
  preferredTickers: readonly string[]
): SignalCandidate | null {
  const entries = readSignalHistory(historyPath);
  const now = new Date();
  const candidates: SignalCandidate[] = [];

  for (const entry of entries) {
    const entryDate = new Date(entry.date);
    const ageDays = Math.floor(
      (now.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Must be at least 30 days old
    if (ageDays < 30) continue;

    for (const signal of entry.active) {
      if (signal.strategy !== strategy) continue;

      candidates.push({
        ticker: signal.ticker,
        strategy: signal.strategy,
        entry: signal.entry,
        stop: signal.stop,
        target: signal.target,
        confidence: signal.confidence,
        date: entry.date,
        ageDays,
        isPreferred: preferredTickers.includes(signal.ticker),
      });
    }
  }

  if (candidates.length === 0) return null;

  // Score and sort: preferred ticker bonus + confidence + age bonus
  const scored = candidates.map((c) => ({
    candidate: c,
    score: scoreCandidate(c),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored[0].candidate;
}

/**
 * Score a candidate signal.
 * - Preferred ticker: +100 points (dominant factor)
 * - Confidence: 0–1 points
 * - Age bonus: 0.01 per day, capped at 1 point (older signals show more aftermath)
 */
function scoreCandidate(candidate: SignalCandidate): number {
  const preferredBonus = candidate.isPreferred ? 100 : 0;
  const ageBonus = Math.min(candidate.ageDays * 0.01, 1);
  return preferredBonus + candidate.confidence + ageBonus;
}

// ============================================================
// NDJSON Reader
// ============================================================

/**
 * Read signal-history.ndjson and parse each line into a SignalEntry.
 * Skips blank lines and malformed entries gracefully.
 */
function readSignalHistory(historyPath: string): SignalEntry[] {
  let content: string;
  try {
    content = readFileSync(historyPath, 'utf-8');
  } catch {
    return [];
  }

  const entries: SignalEntry[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const parsed = JSON.parse(trimmed) as SignalEntry;
      if (parsed.date && Array.isArray(parsed.active)) {
        entries.push(parsed);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return entries;
}

// ============================================================
// Default output directory (relative to project root)
// ============================================================

const DEFAULT_OUTPUT_DIR = '../marketpulse-web/public/images/blog/';

// ============================================================
// Lightweight Charts JS loader
// ============================================================

function loadLightweightChartsJs(): string | null {
  const lwcPaths = [
    resolve(__dirname, '..', '..', 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js'),
    resolve(__dirname, '..', '..', 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.development.js'),
    resolve(__dirname, '..', 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js'),
    resolve(__dirname, '..', 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.development.js'),
  ];

  for (const lwcPath of lwcPaths) {
    try {
      return readFileSync(lwcPath, 'utf-8');
    } catch {
      // Try next path
    }
  }
  return null;
}

// ============================================================
// createBlogChartsHandler
// ============================================================

export function createBlogChartsHandler(deps: BlogChartsCommandDeps): CommandHandler {
  const { dataDir, cachingProvider } = deps;

  return async (opts: Record<string, string>) => {
    // Use --data-dir override or fall back to the wired dataDir
    const effectiveDataDir = opts['data-dir'] ?? dataDir;
    const historyPath = join(effectiveDataDir, 'signal-history.ndjson');
    const strategyFilter = opts['strategy'];
    const outputDir = resolve(opts['output'] ?? DEFAULT_OUTPUT_DIR);

    // Determine which strategies to process
    const strategies = strategyFilter
      ? TARGET_STRATEGIES.filter((s) => s === strategyFilter)
      : [...TARGET_STRATEGIES];

    if (strategyFilter && strategies.length === 0) {
      return errorResult(
        'generate-blog-charts',
        'INVALID_PARAM_RANGE',
        `Unknown strategy '${strategyFilter}'. Available: ${TARGET_STRATEGIES.join(', ')}`
      );
    }

    // Select best signal for each strategy
    const selections: Array<{ strategy: string; signal: SignalCandidate | null }> = [];

    for (const strategy of strategies) {
      const signal = selectBestSignal(strategy, historyPath, PREFERRED_TICKERS);
      selections.push({ strategy, signal });

      if (signal) {
        process.stdout.write(
          `[blog-charts] Selected ${signal.ticker} ${signal.date} confidence=${signal.confidence.toFixed(2)} for ${strategy}\n`
        );
      } else {
        process.stdout.write(
          `[blog-charts] No suitable signal found for ${strategy}\n`
        );
      }
    }

    // Filter out strategies with no signal
    const validSelections = selections.filter((s) => s.signal !== null) as Array<{
      strategy: string;
      signal: SignalCandidate;
    }>;

    if (validSelections.length === 0) {
      return errorResult(
        'generate-blog-charts',
        'NO_SIGNALS',
        'No suitable signals found for any target strategy'
      );
    }

    // Load lightweight-charts JS for rendering
    const lightweightChartsJs = loadLightweightChartsJs();
    if (!lightweightChartsJs) {
      return errorResult(
        'generate-blog-charts',
        'MISSING_DEPENDENCY',
        'lightweight-charts library not found in node_modules. Run npm install.'
      );
    }

    // Create output directory if it doesn't exist
    mkdirSync(outputDir, { recursive: true });

    // Generate charts for each valid selection
    const results: Array<{
      strategy: string;
      ticker: string;
      date: string;
      filename: string;
      success: boolean;
      reason?: string;
    }> = [];

    for (const { strategy, signal } of validSelections) {
      try {
        // Fetch 6 months of historical data
        const dataResult = await cachingProvider.getHistoricalData(signal.ticker, '6mo');

        if (!dataResult.success) {
          process.stderr.write(
            `[blog-charts] Warning: Failed to fetch data for ${signal.ticker}: ${dataResult.error}. Skipping ${strategy}.\n`
          );
          results.push({
            strategy,
            ticker: signal.ticker,
            date: signal.date,
            filename: '',
            success: false,
            reason: `Data fetch failed: ${dataResult.error}`,
          });
          continue;
        }

        // Build SignalInput for chart generation
        const signalInput: SignalInput = {
          ticker: signal.ticker,
          strategy: signal.strategy,
          entry: signal.entry,
          stop: signal.stop,
          target: signal.target,
          signalStartDate: signal.date,
        };

        // Generate chart via Puppeteer pipeline
        const chartResults = await generateChartImages([signalInput], {
          dataProvider: cachingProvider,
          lightweightChartsJs,
        });

        const chartResult = chartResults[0];

        if (!chartResult || !chartResult.success) {
          const reason = chartResult && !chartResult.success ? chartResult.reason : 'Unknown error';
          process.stderr.write(
            `[blog-charts] Warning: Chart generation failed for ${signal.ticker}/${strategy}: ${reason}. Skipping.\n`
          );
          results.push({
            strategy,
            ticker: signal.ticker,
            date: signal.date,
            filename: '',
            success: false,
            reason,
          });
          continue;
        }

        // Write PNG to output directory with naming pattern: {strategy}_{ticker}_{date}.png
        const filename = `${strategy}_${signal.ticker}_${signal.date}.png`;
        const outputPath = join(outputDir, filename);
        writeFileSync(outputPath, chartResult.pngBuffer);

        results.push({
          strategy,
          ticker: signal.ticker,
          date: signal.date,
          filename,
          success: true,
        });
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `[blog-charts] Warning: Error processing ${signal.ticker}/${strategy}: ${reason}. Skipping.\n`
        );
        results.push({
          strategy,
          ticker: signal.ticker,
          date: signal.date,
          filename: '',
          success: false,
          reason,
        });
      }
    }

    // Print summary table
    const successCount = results.filter((r) => r.success).length;
    process.stdout.write('\n');
    process.stdout.write('Strategy                       Ticker   Date         Output\n');
    process.stdout.write('─'.repeat(90) + '\n');

    for (const result of results) {
      const strategyCol = result.strategy.padEnd(30);
      const tickerCol = result.ticker.padEnd(8);
      const dateCol = result.date.padEnd(12);
      const statusIcon = result.success ? '✓' : '✗';
      const outputCol = result.success ? `${result.filename} ${statusIcon}` : `SKIPPED ${statusIcon}`;
      process.stdout.write(`${strategyCol} ${tickerCol} ${dateCol} ${outputCol}\n`);
    }

    process.stdout.write('\n');
    process.stdout.write(`[blog-charts] Done: ${successCount}/${results.length} charts generated → ${outputDir}\n`);

    return successResult('generate-blog-charts', {
      outputDir,
      results: results.map((r) => ({
        strategy: r.strategy,
        ticker: r.ticker,
        date: r.date,
        filename: r.filename,
        success: r.success,
        reason: r.reason,
      })),
    });
  };
}
