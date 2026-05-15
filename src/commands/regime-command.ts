// ============================================================
// Regime Command — Standalone regime detection CLI handler
// ============================================================
// Runs the RegimeDetector for all configured tickers plus SPY/QQQ.
// Accepts --tickers (optional, defaults to top100 or configured list),
// --json (raw JSON output), --st-period and --st-multiplier
// (SuperTrend parameter overrides).
// ============================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { HistoricalDataCache } from '../data/historical-data-cache.js';
import { RegimeDetector } from '../indicators/regime-detector.js';
import type { RegimeDetectorOptions } from '../indicators/regime-detector.js';
import { formatRegimeOutput } from '../formatters/regime-formatter.js';

// ============================================================
// Dependencies
// ============================================================

export interface RegimeCommandDeps {
  cachingProvider: HistoricalDataCache;
  dataDir: string;
}

// ============================================================
// Top-100 Ticker Resolution
// ============================================================

function resolveTickerList(tickersArg: string | undefined, dataDir: string): string[] | { error: string } {
  // If no tickers specified, default to top100
  const effectiveArg = tickersArg ?? 'top100';

  if (effectiveArg.toLowerCase() === 'top100') {
    try {
      const top100Path = join(dataDir, 'data', 'top100.json');
      const content = readFileSync(top100Path, 'utf-8');
      const parsed = JSON.parse(content) as { tickers?: string[] };
      if (!Array.isArray(parsed.tickers) || parsed.tickers.length === 0) {
        return { error: `top100.json at ${top100Path} is missing or has empty 'tickers' array` };
      }
      return parsed.tickers.map((t: string) => t.toUpperCase());
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { error: `Failed to load top100.json: ${message}` };
    }
  }

  return effectiveArg.split(',').map(t => t.trim().toUpperCase()).filter(t => t.length > 0);
}

// ============================================================
// createRegimeHandler
// ============================================================

/**
 * Creates the 'regime' command handler.
 * Accepts: --tickers (optional, defaults to top100 or configured list)
 *          --json (output raw JSON)
 *          --st-period, --st-multiplier (SuperTrend overrides)
 */
export function createRegimeHandler(deps: RegimeCommandDeps): CommandHandler {
  const { cachingProvider, dataDir } = deps;

  return async (opts: Record<string, string>) => {
    const tickersArg = opts['tickers'];
    const jsonOutput = opts['json'] !== undefined;

    // Parse optional SuperTrend parameter overrides
    const stPeriodRaw = opts['st-period'];
    const stMultiplierRaw = opts['st-multiplier'];

    let stPeriod: number | undefined;
    let stMultiplier: number | undefined;

    if (stPeriodRaw !== undefined) {
      stPeriod = Number(stPeriodRaw);
      if (!Number.isFinite(stPeriod) || !Number.isInteger(stPeriod) || stPeriod < 1) {
        return errorResult('regime', 'INVALID_PARAM_RANGE',
          `Invalid value for --st-period: '${stPeriodRaw}'. Must be a positive integer.`);
      }
    }

    if (stMultiplierRaw !== undefined) {
      stMultiplier = Number(stMultiplierRaw);
      if (!Number.isFinite(stMultiplier) || stMultiplier <= 0) {
        return errorResult('regime', 'INVALID_PARAM_RANGE',
          `Invalid value for --st-multiplier: '${stMultiplierRaw}'. Must be a positive number.`);
      }
    }

    // Resolve ticker list
    const tickers = resolveTickerList(tickersArg, dataDir);
    if ('error' in tickers) {
      return errorResult('regime', 'CONFIG_ERROR', tickers.error);
    }

    if (tickers.length === 0) {
      return errorResult('regime', 'MISSING_PARAM', 'No tickers specified');
    }

    // Build SuperTrend params override (only include fields that were explicitly set)
    const superTrendParams = (stPeriod !== undefined || stMultiplier !== undefined)
      ? {
          ...(stPeriod !== undefined ? { period: stPeriod } : {}),
          ...(stMultiplier !== undefined ? { multiplier: stMultiplier } : {}),
        }
      : undefined;

    // Instantiate RegimeDetector
    const detectorOptions: RegimeDetectorOptions = {
      cachingProvider,
      superTrendParams,
      cacheDir: dataDir,
    };

    const detector = new RegimeDetector(detectorOptions);

    // Run detection
    try {
      const result = await detector.detect(tickers);

      // JSON output mode
      if (jsonOutput) {
        return successResult('regime', result);
      }

      // Formatted table output
      const formatted = formatRegimeOutput(result);
      return successResult('regime', {
        ...result,
        formatted,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return errorResult('regime', 'INTERNAL_ERROR',
        `Regime detection failed: ${message}`);
    }
  };
}
