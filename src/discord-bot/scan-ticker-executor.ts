// ============================================================
// Scan Ticker Executor — On-demand single-ticker signal scan
// ============================================================
// Performs a full v3 signal scan for a single ticker on demand.
// Uses strategy profiles when available, falls back to DEFAULT_SCAN_PARAMS.
// Never throws — wraps all errors in { error: string }.
// ============================================================

import * as path from 'node:path';
import type { HistoricalDataPoint } from '../types.js';
import type { SignalOutput } from '../strategies/strategy-registry.js';
import { detectSignal } from '../strategies/signal-detector.js';
import { loadStrategyProfile } from '../data/profile-store.js';
import { DEFAULT_SCAN_PARAMS } from '../strategies/default-scan-params.js';
import { computeRvol } from '../pipeline/rvol.js';

// ============================================================
// Result Types
// ============================================================

export interface ScanTickerStrategyResult {
  strategy: string;
  signal: string;
  confidence: number;
  entry: number;
  stop: number;
  target: number;
  used_default_params: boolean;
}

export interface ScanTickerResult {
  ticker: string;
  indicative: boolean;
  bars_available: number;
  best: {
    strategy: string;
    signal: string;
    confidence: number;
    entry: number;
    stop: number;
    target: number;
  } | null;
  strategies: ScanTickerStrategyResult[];
}

export interface ScanTickerError {
  error: string;
}

// ============================================================
// Constants
// ============================================================

/** Strategies to scan (excludes post_earnings_drift which requires earnings dates). */
const SCAN_STRATEGIES = [
  'consolidation_breakout',
  'trend_pullback',
  'bear_breakdown',
  'keltner_mean_reversion',
  'volume_dry_up',
] as const;

/** Signal priority for determining the "best" signal (higher index = higher priority). */
const SIGNAL_PRIORITY: Record<string, number> = {
  none: 0,
  forming: 1,
  near: 2,
  active_late: 3,
  active: 4,
};

/** Rate-limit error patterns that trigger a retry. */
const RATE_LIMIT_PATTERNS = ['Too Many Requests', '429', 'rate limit'];

// ============================================================
// Helpers
// ============================================================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function isRateLimitError(errorMsg: string): boolean {
  const lower = errorMsg.toLowerCase();
  return RATE_LIMIT_PATTERNS.some((p) => lower.includes(p.toLowerCase()));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Compute a simple target from entry/stop using a 2:1 reward-to-risk ratio.
 * For bear_breakdown (short), target is below entry.
 */
function computeTarget(entry: number, stop: number, strategy: string): number {
  if (entry === 0) return 0;
  const risk = Math.abs(entry - stop);
  if (strategy === 'bear_breakdown') {
    return round2(entry - risk * 2);
  }
  return round2(entry + risk * 2);
}

// ============================================================
// Main Executor
// ============================================================

/**
 * Execute a full on-demand signal scan for a single ticker.
 * Returns a structured result or an error object. Never throws.
 */
export async function executeScanTicker(
  ticker: string
): Promise<ScanTickerResult | ScanTickerError> {
  try {
    const normalizedTicker = ticker.toUpperCase();
    const basePath = process.env.STOCK_TRACKER_HOME ?? process.cwd();
    const dataDir = path.join(basePath, '.stock-tracker');

    // ── 1. Instantiate data providers (dynamic import to avoid circular deps) ──
    const { YahooFinanceAdapter } = await import('../data/yahoo-finance-adapter.js');
    const { HistoricalDataCache } = await import('../data/historical-data-cache.js');

    const yahooAdapter = new YahooFinanceAdapter();
    const dataProvider = new HistoricalDataCache(yahooAdapter, {
      cacheDir: path.join(basePath, '.stock-tracker', 'history-cache'),
    });

    // ── 2. Ticker validation with 8s timeout ──
    const validationResult = await Promise.race([
      dataProvider.validateTicker(normalizedTicker),
      new Promise<{ success: false; error: string }>((resolve) =>
        setTimeout(() => resolve({ success: false, error: 'TIMEOUT: Ticker validation timed out (8s)' }), 8000)
      ),
    ]);

    if (!validationResult.success) {
      const err = validationResult.error;
      if (err.includes('TIMEOUT')) {
        return { error: `Could not verify ticker '${normalizedTicker}' — Yahoo Finance is not responding. Try again in a few minutes.` };
      }
      if (err.includes('INVALID_TICKER')) {
        return { error: `Ticker '${normalizedTicker}' not found — check the symbol and try again.` };
      }
      // PRICE_FEED_UNAVAILABLE or other network error — skip validation and try fetching anyway
      // Yahoo quote endpoint can be flaky but getHistoricalData may still work
    }

    // ── 3. Data fetch with retry-once on rate-limit ──
    let dataResult = await dataProvider.getHistoricalData(normalizedTicker, '1y');

    if (!dataResult.success && isRateLimitError(dataResult.error)) {
      await sleep(2000);
      dataResult = await dataProvider.getHistoricalData(normalizedTicker, '1y');
    }

    if (!dataResult.success) {
      return { error: `Data unavailable for '${normalizedTicker}' right now. Try again in a few minutes.` };
    }

    const dataPoints: HistoricalDataPoint[] = dataResult.data.dataPoints;

    // ── 4. Check bar count ≥ 100 ──
    if (dataPoints.length < 100) {
      return {
        error: `Insufficient data for ${normalizedTicker}: only ${dataPoints.length} bars available (need ≥ 100)`,
      };
    }

    // ── 5. Loop over all 5 strategies ──
    const strategyResults: ScanTickerStrategyResult[] = [];
    let anyUsedDefault = false;

    for (const strategyName of SCAN_STRATEGIES) {
      let params: Record<string, number>;
      let usedDefaultParams = false;

      // Try to load tuned profile, fall back to DEFAULT_SCAN_PARAMS
      const profileResult = loadStrategyProfile(normalizedTicker, strategyName, {
        allowStale: true,
        baseDir: dataDir,
      });

      if (profileResult.success) {
        params = profileResult.data.params;
      } else {
        // Fall back to default scan params
        const defaults = DEFAULT_SCAN_PARAMS[strategyName];
        if (!defaults) {
          // Skip strategy if no defaults available (shouldn't happen for the 5 we scan)
          continue;
        }
        params = defaults;
        usedDefaultParams = true;
        anyUsedDefault = true;
      }

      // ── 6. Call detectSignal ──
      const signal: SignalOutput = detectSignal(dataPoints, params, strategyName);
      signal.ticker = normalizedTicker;

      // Compute target from entry/stop
      const target = computeTarget(signal.entry, signal.stop, strategyName);

      strategyResults.push({
        strategy: strategyName,
        signal: signal.signal,
        confidence: round2(signal.confidence),
        entry: round2(signal.entry),
        stop: round2(signal.stop),
        target,
        used_default_params: usedDefaultParams,
      });
    }

    // ── 7. Compute RVOL and attach to all results ──
    const rvol = computeRvol(dataPoints);
    // RVOL is a ticker-level metric; we include it in the top-level result
    // (mirrors parallelScan which attaches to each SignalOutput)

    // ── 8. Determine best signal per priority ──
    let best: ScanTickerResult['best'] = null;
    let bestPriority = -1;

    for (const result of strategyResults) {
      const priority = SIGNAL_PRIORITY[result.signal] ?? 0;
      if (priority > bestPriority) {
        bestPriority = priority;
        best = {
          strategy: result.strategy,
          signal: result.signal,
          confidence: result.confidence,
          entry: result.entry,
          stop: result.stop,
          target: result.target,
        };
      }
    }

    // If best signal is "none", return null for best
    if (best && best.signal === 'none') {
      best = null;
    }

    // ── 9. Build and return result ──
    return {
      ticker: normalizedTicker,
      indicative: anyUsedDefault,
      bars_available: dataPoints.length,
      best,
      strategies: strategyResults,
      ...(rvol != null ? { rvol: round2(rvol) } : {}),
    } as ScanTickerResult;
  } catch (e: unknown) {
    // ── 10. Never throw — wrap in error object ──
    const message = e instanceof Error ? e.message : String(e);
    return { error: `Scan failed: ${message}` };
  }
}
