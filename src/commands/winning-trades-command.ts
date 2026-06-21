// ============================================================
// Winning Trades Command — Scan signal history for target-hit trades
// ============================================================
// Reads both signal-history.ndjson and signal-history-tech.ndjson,
// filters for signals ≥ min-age days old that have hit their targets,
// calculates P&L, de-duplicates, generates annotated chart PNGs,
// and writes a date-based manifest.
//
// Usage: cli.js winning-trades [--min-age 30] [--output /path/to/dir]
// ============================================================

import { readFileSync, writeFileSync, copyFileSync, accessSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as fs from 'node:fs';
import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { HistoricalDataCache } from '../data/historical-data-cache.js';
import { parseEntries } from '../signal-history/ndjson.js';
import type { SignalEntry, ActiveSignal } from '../signal-history/signal-entry.js';
import { buildPriceMapFromCache } from '../utils/price-map.js';
import { todayPST } from '../utils/date-utils.js';
import { generateChartImages } from '../chart-image-generator.js';
import type { SignalInput } from '../chart-types.js';

// ============================================================
// Interfaces
// ============================================================

export interface WinningTradesCommandDeps {
  dataDir: string;
  cachingProvider: HistoricalDataCache;
}

export interface WinningTradeResult {
  ticker: string;
  strategy: string;
  entryDate: string;        // YYYY-MM-DD from parent SignalEntry.date
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  currentPrice: number;
  pnlPercent: number;       // rounded to 2 decimal places
  chartFilename: string | null;
}

export interface WinningTradesManifest {
  date: string;             // YYYY-MM-DD (Pacific time)
  generatedAt: string;      // ISO 8601 timestamp
  trades: WinningTradeResult[];
}

// ============================================================
// Helpers
// ============================================================

/**
 * Read a signal history file, returning parsed entries or empty array on failure.
 */
function readHistoryFile(filePath: string): SignalEntry[] {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }
  return parseEntries(content);
}

/**
 * Compute the number of calendar days between two YYYY-MM-DD date strings.
 * Returns the difference in days (today - signalDate).
 */
function daysBetween(signalDate: string, today: string): number {
  const d1 = new Date(signalDate + 'T12:00:00');
  const d2 = new Date(today + 'T12:00:00');
  const diffMs = d2.getTime() - d1.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Determine if a signal is short based on stop vs entry.
 * Short: stop > entry (profit from price going down)
 * Long: stop < entry (profit from price going up)
 */
function isShortSignal(signal: ActiveSignal): boolean {
  return signal.stop > signal.entry;
}

/**
 * Check win condition based on direction.
 * Long: currentPrice >= target
 * Short: currentPrice <= target
 */
function checkWinCondition(signal: ActiveSignal, currentPrice: number): boolean {
  if (isShortSignal(signal)) {
    return currentPrice <= signal.target;
  }
  return currentPrice >= signal.target;
}

/**
 * Calculate P&L percentage based on direction.
 * Long: ((currentPrice - entry) / entry) * 100
 * Short: ((entry - currentPrice) / entry) * 100
 * Rounded to 2 decimal places.
 */
function calculatePnl(signal: ActiveSignal, currentPrice: number): number {
  let pnl: number;
  if (isShortSignal(signal)) {
    pnl = ((signal.entry - currentPrice) / signal.entry) * 100;
  } else {
    pnl = ((currentPrice - signal.entry) / signal.entry) * 100;
  }
  return Math.round(pnl * 100) / 100;
}

/**
 * Validate the --min-age flag value.
 * Must be an integer between 1 and 365 (inclusive).
 */
function validateMinAge(value: string): { valid: true; minAge: number } | { valid: false; error: string } {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
    return {
      valid: false,
      error: `Invalid --min-age value '${value}'. Must be an integer between 1 and 365.`,
    };
  }
  return { valid: true, minAge: parsed };
}

/**
 * Validate the --output flag by checking if the path can be written to.
 */
function validateOutputPath(outputPath: string): { valid: true } | { valid: false; error: string } {
  const resolved = resolve(outputPath);
  try {
    mkdirSync(resolved, { recursive: true });
    accessSync(resolved, fs.constants.W_OK);
    return { valid: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      error: `Output path '${resolved}' is not accessible or writable: ${message}`,
    };
  }
}

// ============================================================
// loadLightweightChartsJs
// ============================================================

/**
 * Load the lightweight-charts standalone JS from node_modules.
 * Tries production build first, then development build.
 * Returns null if neither is found.
 */
function loadLightweightChartsJs(): string | null {
  // Use __dirname to resolve from the compiled JS location — cwd in production
  // points to the data volume, not the application directory.
  // Compiled JS is at dist/src/commands/winning-trades-command.js → go up 3 levels.
  const appRoot = resolve(__dirname, '..', '..', '..');
  const lwcPaths = [
    resolve(appRoot, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js'),
    resolve(appRoot, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.development.js'),
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
// createWinningTradesHandler
// ============================================================

export function createWinningTradesHandler(deps: WinningTradesCommandDeps): CommandHandler {
  const { dataDir, cachingProvider } = deps;

  return async (opts: Record<string, string>) => {
    // ----------------------------------------------------------
    // 1. Parse and validate CLI options
    // ----------------------------------------------------------
    const minAgeArg = opts['min-age'];
    const outputArg = opts['output'];

    let minAge = 30; // default
    if (minAgeArg !== undefined) {
      const validation = validateMinAge(minAgeArg);
      if (!validation.valid) {
        return errorResult('winning-trades', 'INVALID_PARAM_RANGE', validation.error);
      }
      minAge = validation.minAge;
    }

    if (outputArg !== undefined) {
      const validation = validateOutputPath(outputArg);
      if (!validation.valid) {
        return errorResult('winning-trades', 'INVALID_OUTPUT_PATH', validation.error);
      }
    }

    // ----------------------------------------------------------
    // 2. Read signal history from both NDJSON files
    // ----------------------------------------------------------
    const mainHistoryPath = join(dataDir, 'signal-history.ndjson');
    const techHistoryPath = join(dataDir, 'signal-history-tech.ndjson');

    const mainEntries = readHistoryFile(mainHistoryPath);
    const techEntries = readHistoryFile(techHistoryPath);
    const allEntries = [...mainEntries, ...techEntries];

    // ----------------------------------------------------------
    // 3. Build price map from history-cache
    // ----------------------------------------------------------
    // buildPriceMapFromCache expects the parent directory of .stock-tracker
    const homeDir = resolve(dataDir, '..');
    const priceMap = buildPriceMapFromCache(homeDir);

    // ----------------------------------------------------------
    // 4. Filter for winning trades
    // ----------------------------------------------------------
    const today = todayPST();
    const winners: WinningTradeResult[] = [];

    for (const entry of allEntries) {
      // Age filter: skip entries newer than minAge days
      const age = daysBetween(entry.date, today);
      if (age < minAge) {
        continue;
      }

      // Process each active signal in this entry
      for (const signal of entry.active) {
        const ticker = signal.ticker.toUpperCase();
        const currentPrice = priceMap.get(ticker);

        // Skip if no price data available
        if (currentPrice === undefined) {
          continue;
        }

        // Check win condition
        if (!checkWinCondition(signal, currentPrice)) {
          continue;
        }

        // Calculate P&L
        const pnlPercent = calculatePnl(signal, currentPrice);

        winners.push({
          ticker,
          strategy: signal.strategy,
          entryDate: entry.date,
          entryPrice: signal.entry,
          stopPrice: signal.stop,
          targetPrice: signal.target,
          currentPrice,
          pnlPercent,
          chartFilename: null, // Will be updated after chart generation
        });
      }
    }

    // ----------------------------------------------------------
    // 5. De-duplicate: key by ticker:strategy:entry, keep earliest date
    // ----------------------------------------------------------
    const deduped = new Map<string, WinningTradeResult>();
    for (const trade of winners) {
      const key = `${trade.ticker}:${trade.strategy}:${trade.entryPrice}`;
      const existing = deduped.get(key);
      if (!existing || trade.entryDate < existing.entryDate) {
        deduped.set(key, trade);
      }
    }

    // ----------------------------------------------------------
    // 6. Sort by pnlPercent descending
    // ----------------------------------------------------------
    const sortedTrades = Array.from(deduped.values()).sort((a, b) => b.pnlPercent - a.pnlPercent);

    // ----------------------------------------------------------
    // 7. Compute output directory (date-based, Pacific time)
    // ----------------------------------------------------------
    const [year, month, day] = today.split('-');
    const defaultOutputDir = join(dataDir, 'winning-trades', year, month, day);
    const outputDir = outputArg ? resolve(outputArg) : defaultOutputDir;

    // Create output directory
    mkdirSync(outputDir, { recursive: true });

    // ----------------------------------------------------------
    // 8. Generate charts for winning trades
    // ----------------------------------------------------------
    let chartsGenerated = 0;

    if (sortedTrades.length > 0) {
      // Load lightweight-charts JS
      const lightweightChartsJs = loadLightweightChartsJs();

      if (lightweightChartsJs) {
        // Build SignalInput[] from winning trades
        const signalInputs: SignalInput[] = sortedTrades.map((trade) => ({
          ticker: trade.ticker,
          strategy: trade.strategy,
          entry: trade.entryPrice,
          stop: trade.stopPrice,
          target: trade.targetPrice,
          signalStartDate: trade.entryDate,
        }));

        // Generate charts using the existing pipeline
        const chartResults = await generateChartImages(signalInputs, {
          dataProvider: cachingProvider,
          lightweightChartsJs,
        });

        // Write successful PNGs and update trade results
        for (let i = 0; i < sortedTrades.length; i++) {
          const chartResult = chartResults[i];
          if (chartResult && chartResult.success) {
            const filename = `${sortedTrades[i].strategy}_${sortedTrades[i].ticker}_${sortedTrades[i].entryDate}.png`;
            const pngPath = join(outputDir, filename);
            writeFileSync(pngPath, chartResult.pngBuffer);
            sortedTrades[i].chartFilename = filename;
            chartsGenerated++;
          } else {
            // Chart generation failed — log reason and leave chartFilename as null
            const reason = chartResult && !chartResult.success ? chartResult.reason : 'Unknown error';
            process.stderr.write(
              `[winning-trades] Chart failed for ${sortedTrades[i].ticker}/${sortedTrades[i].strategy}: ${reason}\n`
            );
            sortedTrades[i].chartFilename = null;
          }
        }
      } else {
        process.stderr.write(
          '[winning-trades] Warning: lightweight-charts library not found, skipping chart generation\n'
        );
      }
    }

    // ----------------------------------------------------------
    // 9. Build and write manifest
    // ----------------------------------------------------------
    const manifest: WinningTradesManifest = {
      date: today,
      generatedAt: new Date().toISOString(),
      trades: sortedTrades,
    };

    try {
      const manifestPath = join(outputDir, 'manifest.json');
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');

      // Copy to latest.json at the winning-trades root
      const winningTradesRoot = join(dataDir, 'winning-trades');
      mkdirSync(winningTradesRoot, { recursive: true });
      const latestPath = join(winningTradesRoot, 'latest.json');
      copyFileSync(manifestPath, latestPath);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult('winning-trades', 'MANIFEST_WRITE_FAILED', `Failed to write manifest: ${message}`);
    }

    // ----------------------------------------------------------
    // 10. Print summary to stdout
    // ----------------------------------------------------------
    process.stdout.write(
      `[winning-trades] ${sortedTrades.length} winning trade(s) found, ${chartsGenerated} chart(s) generated → ${outputDir}\n`
    );

    // ----------------------------------------------------------
    // 11. Return success result
    // ----------------------------------------------------------
    return successResult('winning-trades', {
      trades: sortedTrades,
      count: sortedTrades.length,
      chartsGenerated,
      minAge,
      scanDate: today,
      outputDir,
    });
  };
}
