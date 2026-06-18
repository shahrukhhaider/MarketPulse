import path from 'node:path';
import type { PostEarningsDriftConfiguration } from './strategy-configs.js';
import type { HistoricalDataPoint } from '../types.js';
import { DEFAULT_PEAD_CONFIG, validatePeadConfig } from './strategy-configs.js';
import { CacheFileStore } from '../data/cache-file-store.js';
import { EarningsDateProvider } from '../data/earnings-date-provider.js';

// ============================================================
// Interfaces
// ============================================================

/**
 * Input data for a single earnings event after extraction from cache.
 */
export interface EarningsEventData {
  earningsDate: string;           // ISO date of earnings announcement
  preClose: number;               // Close price on the trading day before earnings
  postOpen: number;               // Open price on the trading day after earnings
  earningsDayVolume: number;      // Volume on the earnings day
  avgVolume20d: number;           // 20-day average volume preceding the earnings date
  postGapBars: HistoricalDataPoint[]; // Up to 10 trading days after earnings gap day
}

/**
 * Result of threshold calibration.
 */
export interface CalibrationResult {
  config: PostEarningsDriftConfiguration;
  calibrated: boolean;            // true if adaptive, false if fallback
  reason?: string;                // Explanation when fallback is used
  eventsUsed: number;             // Number of earnings events used (0 if fallback)
}

/**
 * Options for the calibrator function.
 */
export interface CalibratorOptions {
  cacheDir: string;               // Base directory for cache files
  scalingFactor?: number;         // Gap scaling factor, default 0.8
  volumeScalingFactor?: number;   // Volume scaling factor, default 0.7
  rangeMultiplier?: number;       // Range multiplier, default 1.2
  maxEvents?: number;             // Max events to use, default 8
  minEvents?: number;             // Min events required, default 4
  logger?: (msg: string) => void; // Optional warning logger
}

// ============================================================
// Statistical Helpers (internal)
// ============================================================

/**
 * Compute median of a numeric array. Returns 0 for empty arrays.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Compute the nth percentile (0-100) of a numeric array.
 * Uses linear interpolation between closest ranks.
 * Returns 0 for empty arrays.
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];

  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const weight = rank - lower;

  if (lower === upper) return sorted[lower];
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/**
 * Clamp a value to [min, max].
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ============================================================
// Exported Functions
// ============================================================

/**
 * Pure function: computes adaptive PEAD thresholds for a ticker.
 * Uses only cached data (sync reads). Falls back to DEFAULT_PEAD_CONFIG
 * when data is insufficient or computed thresholds fail validation.
 */
export function calibratePeadThresholds(
  ticker: string,
  options: CalibratorOptions
): CalibrationResult {
  const maxEvents = options.maxEvents ?? 8;
  const minEvents = options.minEvents ?? 4;
  const scalingFactor = options.scalingFactor ?? 0.8;
  const volumeScalingFactor = options.volumeScalingFactor ?? 0.7;
  const rangeMultiplier = options.rangeMultiplier ?? 1.2;

  const fallback = (reason: string): CalibrationResult => {
    options.logger?.(`[calibrate] ${ticker}: ${reason}`);
    return {
      config: { ...DEFAULT_PEAD_CONFIG },
      calibrated: false,
      reason,
      eventsUsed: 0,
    };
  };

  // 1. Read earnings dates from cache
  const earningsProvider = new EarningsDateProvider({ cacheDir: options.cacheDir });
  const earningsDates = earningsProvider.getEarningsDatesFromCache(ticker);

  if (earningsDates.length < minEvents) {
    return fallback(
      `Insufficient earnings dates for ${ticker}: found ${earningsDates.length}, need at least ${minEvents}`
    );
  }

  // 2. Read price data from cache
  const priceStore = new CacheFileStore(path.join(options.cacheDir, 'history-cache'));
  const cacheFile = priceStore.read(ticker);

  if (!cacheFile) {
    return fallback(`No cached price data available for ${ticker}`);
  }

  const dataPoints = cacheFile.dataPoints; // sorted ascending by date

  // 3. Take the most recent min(N, maxEvents) earnings dates
  const recentDates = earningsDates.slice(-Math.min(earningsDates.length, maxEvents));

  // 4. Extract event data for each earnings date
  const events: EarningsEventData[] = [];

  for (const earningsDate of recentDates) {
    // Find the index of the first bar with date >= earningsDate (the gap day / earnings day bar)
    const gapDayIndex = dataPoints.findIndex(bar => bar.date >= earningsDate);

    if (gapDayIndex < 0) {
      // No bar on or after this earnings date — skip
      continue;
    }

    if (gapDayIndex === 0) {
      // No bar before earnings date for preClose — skip
      continue;
    }

    const preCloseBar = dataPoints[gapDayIndex - 1];
    const gapDayBar = dataPoints[gapDayIndex];

    const preClose = preCloseBar.close;
    const postOpen = gapDayBar.open;
    const earningsDayVolume = gapDayBar.volume;

    // Skip if preClose is zero (prevents division by zero in gap calculation)
    if (preClose === 0) {
      continue;
    }

    // Compute avgVolume20d: mean volume of the 20 bars preceding the gap day bar
    const volumeLookbackStart = Math.max(0, gapDayIndex - 20);
    const volumeBars = dataPoints.slice(volumeLookbackStart, gapDayIndex);
    if (volumeBars.length === 0) {
      continue;
    }
    const avgVolume20d = volumeBars.reduce((sum, bar) => sum + bar.volume, 0) / volumeBars.length;

    // Skip if avgVolume is zero (prevents division by zero in volume ratio)
    if (avgVolume20d === 0) {
      continue;
    }

    // Extract postGapBars: up to 10 bars starting from (and including) the gap day bar
    const postGapBars = dataPoints.slice(gapDayIndex, gapDayIndex + 10);

    events.push({
      earningsDate,
      preClose,
      postOpen,
      earningsDayVolume,
      avgVolume20d,
      postGapBars,
    });
  }

  // 5. Check if enough valid events remain
  if (events.length < minEvents) {
    return fallback(
      `Insufficient valid earnings events for ${ticker}: extracted ${events.length}, need at least ${minEvents}`
    );
  }

  // 6. Compute adaptive thresholds
  const computedConfig = computeAdaptiveThresholds(events, {
    scalingFactor,
    volumeScalingFactor,
    rangeMultiplier,
  });

  // 7. Validate computed config
  const validationResult = validatePeadConfig(computedConfig);
  if (!validationResult.success) {
    return fallback(
      `Validation failed for ${ticker}: ${validationResult.error}`
    );
  }

  return {
    config: computedConfig,
    calibrated: true,
    eventsUsed: events.length,
  };
}

/**
 * Pure computation: given extracted earnings event data, compute thresholds.
 * Separated for testability — this is the core logic without I/O.
 *
 * Returns DEFAULT_PEAD_CONFIG when fewer than 4 valid events are provided.
 */
export function computeAdaptiveThresholds(
  events: EarningsEventData[],
  options?: {
    scalingFactor?: number;
    volumeScalingFactor?: number;
    rangeMultiplier?: number;
  }
): PostEarningsDriftConfiguration {
  const scalingFactor = options?.scalingFactor ?? 0.8;
  const volumeScalingFactor = options?.volumeScalingFactor ?? 0.7;
  const rangeMultiplier = options?.rangeMultiplier ?? 1.2;

  // Filter valid events for gap/volume computation:
  // preClose must be > 0 and avgVolume20d must be > 0
  const validEvents = events.filter(
    (e) => e.preClose > 0 && e.avgVolume20d > 0
  );

  // Require at least 4 valid events for calibration
  if (validEvents.length < 4) {
    return { ...DEFAULT_PEAD_CONFIG };
  }

  // 1. Compute absolute gaps: |(postOpen - preClose) / preClose × 100|
  const absGaps = validEvents.map(
    (e) => Math.abs((e.postOpen - e.preClose) / e.preClose * 100)
  );

  // 2. Compute volume ratios: earningsDayVolume / avgVolume20d
  const volumeRatios = validEvents.map(
    (e) => e.earningsDayVolume / e.avgVolume20d
  );

  // 3. Compute post-gap ranges for events that have postGapBars
  // Use all bars in postGapBars to find maxHigh/minLow.
  // The first bar is the gap day — use its close as gapDayClose.
  // Skip events with empty postGapBars for range computation only.
  const postGapRanges: number[] = [];
  for (const event of validEvents) {
    if (event.postGapBars.length === 0) {
      continue;
    }
    const gapDayClose = event.postGapBars[0].close;
    if (gapDayClose <= 0) {
      continue;
    }
    const maxHigh = Math.max(...event.postGapBars.map((b) => b.high));
    const minLow = Math.min(...event.postGapBars.map((b) => b.low));
    const range = (maxHigh - minLow) / gapDayClose * 100;
    postGapRanges.push(range);
  }

  // 4. Derive gap_min_pct = max(clamp(median(absGaps) × scalingFactor, 1, 50), 1.5)
  const gap_min_pct = Math.max(
    clamp(median(absGaps) * scalingFactor, 1, 50),
    1.5
  );

  // 5. Derive gap_volume_multiplier = max(clamp(median(volumeRatios) × volumeScalingFactor, 1.0, 10.0), 1.2)
  const gap_volume_multiplier = Math.max(
    clamp(median(volumeRatios) * volumeScalingFactor, 1.0, 10.0),
    1.2
  );

  // 6. Derive max_range_pct = clamp(P75(postGapRanges) × rangeMultiplier, 1, 30)
  // If no valid post-gap ranges, use default
  const max_range_pct = postGapRanges.length > 0
    ? clamp(percentile(postGapRanges, 75) * rangeMultiplier, 1, 30)
    : DEFAULT_PEAD_CONFIG.max_range_pct;

  // 7. Copy non-adapted parameters from DEFAULT_PEAD_CONFIG
  return {
    gap_min_pct,
    gap_volume_multiplier,
    max_range_pct,
    consolidation_min_days: DEFAULT_PEAD_CONFIG.consolidation_min_days,
    consolidation_max_days: DEFAULT_PEAD_CONFIG.consolidation_max_days,
    breakout_volume_multiplier: DEFAULT_PEAD_CONFIG.breakout_volume_multiplier,
    stop_buffer_atr: DEFAULT_PEAD_CONFIG.stop_buffer_atr,
    r_multiple: DEFAULT_PEAD_CONFIG.r_multiple,
    max_risk_pct: DEFAULT_PEAD_CONFIG.max_risk_pct,
    trend_exit_sma_period: DEFAULT_PEAD_CONFIG.trend_exit_sma_period,
  };
}

// Re-export helpers for testing purposes (internal use only)
export const _internals = { median, percentile, clamp };
