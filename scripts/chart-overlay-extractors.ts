/**
 * Chart Overlay Extractors — Strategy-specific overlay data extraction
 *
 * Provides:
 * - loadTunedParams: Load tuned parameters from profile store for chart generation
 * - extractOverlayData: Dispatch to per-strategy extractors
 * - Per-strategy extractor functions
 */

export { loadTunedParams } from '../src/data/load-tuned-params.js';

import type { HistoricalDataPoint } from '../src/types.js';
import { ConsolidationBreakoutEngine } from '../src/strategies/consolidation-breakout-engine.js';
import { BearBreakdownEngine } from '../src/strategies/bear-breakdown-engine.js';
import { buildConsolidationBreakoutConfig, buildBearBreakdownConfig, buildKeltnerMeanReversionConfig } from '../src/strategies/parameter-grid.js';
import {
  detectVolumeDryUp,
  isValidBar,
  DEFAULT_VDU_CONFIG,
} from '../src/strategies/vdu-engine.js';
import { KeltnerMeanReversionEngine } from '../src/strategies/keltner-mean-reversion-engine.js';
import type { KeltnerMeanReversionConfiguration } from '../src/strategies/strategy-configs.js';
import { TrendPullbackEngine } from '../src/strategies/trend-pullback-engine.js';
import type { SetupConfig, TriggerConfig } from '../src/strategies/trend-pullback-engine.js';
import { sma } from '../src/indicators/indicators.js';

// ============================================================
// Overlay Data Interfaces
// ============================================================

export interface LegendEntry {
  name: string;
  color: string;
  style: 'solid' | 'dashed' | 'zone' | 'marker';
}

export interface BaseOverlayData {
  strategy: string;
  legendEntries: LegendEntry[];
}

export interface ConsolidationBreakoutOverlay extends BaseOverlayData {
  strategy: 'consolidation_breakout';
  zone: {
    high: number;
    low: number;
    startDate: string;
    endDate: string;
    rangePct: number;
  } | null;
  breakoutMarker: {
    date: string;
    price: number;
    shape: 'arrowUp';
    color: string;
  } | null;
}

export interface BearBreakdownOverlay extends BaseOverlayData {
  strategy: 'bear_breakdown';
  zone: {
    high: number;
    low: number;
    startDate: string;
    endDate: string;
    rangePct: number;
  } | null;
  breakdownMarker: {
    date: string;
    price: number;
    shape: 'arrowDown';
    color: string;
  } | null;
}

export interface KeltnerMeanReversionOverlay extends BaseOverlayData {
  strategy: 'keltner_mean_reversion';
  upperBand: Array<{ time: string; value: number }>;
  lowerBand: Array<{ time: string; value: number }>;
  dipMarker: {
    date: string;
    price: number;
    shape: 'arrowDown';
    color: string;
  } | null;
  reclaimMarker: {
    date: string;
    price: number;
    shape: 'arrowUp';
    color: string;
  } | null;
}

export interface TrendPullbackOverlay extends BaseOverlayData {
  strategy: 'trend_pullback';
  sma10: Array<{ time: string; value: number }>;
  pullbackBars: string[];
  triggerMarker: {
    date: string;
    price: number;
    shape: 'arrowUp';
    color: string;
    text: string;
  } | null;
}

export interface VolumeDryUpOverlay extends BaseOverlayData {
  strategy: 'volume_dry_up';
  zone: {
    high: number;
    low: number;
    startDate: string;
    endDate: string;
  } | null;
  dryUpBars: string[];
  volumeRatioLabel: {
    date: string;
    value: number;
  } | null;
}

export type StrategyOverlayData =
  | ConsolidationBreakoutOverlay
  | BearBreakdownOverlay
  | KeltnerMeanReversionOverlay
  | TrendPullbackOverlay
  | VolumeDryUpOverlay;

// ============================================================
// Color Palette
// ============================================================

const VDU_BASE_ZONE_COLOR = 'rgba(0, 150, 136, 0.15)';   // teal
const VDU_DRY_UP_BAR_COLOR = 'rgba(33, 150, 243, 0.6)';  // blue

const KELTNER_BAND_COLOR = '#E91E63';     // magenta/pink
const DIP_MARKER_COLOR = '#F44336';       // red
const RECLAIM_MARKER_COLOR = '#4CAF50';   // green

const SMA10_COLOR = '#FF9800';                              // orange
const PULLBACK_HIGHLIGHT_COLOR = 'rgba(255, 193, 7, 0.3)'; // amber
const TRIGGER_MARKER_COLOR = '#FFC107';                     // gold/amber

// ============================================================
// Main Dispatch Function
// ============================================================

/**
 * Extract overlay data for a given strategy from historical data and params.
 * Returns null if no actionable signal is detected or strategy is unknown.
 */
export function extractOverlayData(
  strategy: string,
  dataPoints: HistoricalDataPoint[],
  params: Record<string, number>,
): StrategyOverlayData | null {
  switch (strategy) {
    case 'consolidation_breakout':
      return extractConsolidationBreakoutOverlay(dataPoints, params);
    case 'bear_breakdown':
      return extractBearBreakdownOverlay(dataPoints, params);
    case 'keltner_mean_reversion':
      return extractKeltnerMeanReversionOverlay(dataPoints, params);
    case 'trend_pullback':
      return extractTrendPullbackOverlay(dataPoints, params);
    case 'volume_dry_up':
      return extractVolumeDryUpOverlay(dataPoints, params);
    default:
      console.warn(`[chart-overlay] Unknown strategy: ${strategy}`);
      return null;
  }
}

// ============================================================
// Consolidation Breakout Extractor
// ============================================================

/**
 * Extract consolidation breakout overlay data.
 *
 * Re-runs ConsolidationBreakoutEngine.shouldEnter on the last bar to confirm
 * a signal exists, then scans backwards for the consolidation zone and
 * identifies the breakout bar.
 */
export function extractConsolidationBreakoutOverlay(
  dataPoints: HistoricalDataPoint[],
  params: Record<string, number>,
): ConsolidationBreakoutOverlay | null {
  if (dataPoints.length < 51) return null;

  const config = buildConsolidationBreakoutConfig(params);
  const lastBarIndex = dataPoints.length - 1;

  // Check if there's an actionable signal on the last bar
  const entryResult = ConsolidationBreakoutEngine.shouldEnter(
    dataPoints,
    lastBarIndex,
    config,
  );

  if (!entryResult) return null;

  // Scan backwards from the bar before the breakout to find the consolidation zone
  const maxStaleness = config.consolidation.max_staleness;
  let consolidationResult: {
    detected: boolean;
    consolidationHigh: number;
    consolidationLow: number;
    consolidationBar: number;
  } | null = null;

  for (let i = lastBarIndex - 1; i >= Math.max(lastBarIndex - maxStaleness, 0); i--) {
    const result = ConsolidationBreakoutEngine.detectConsolidation(
      dataPoints,
      i,
      {
        consolidation_window: config.consolidation.consolidation_window,
        max_range_pct: config.consolidation.max_range_pct,
        atr_ratio_threshold: config.consolidation.atr_ratio_threshold,
        sma_proximity_pct: config.consolidation.sma_proximity_pct,
      },
    );
    if (result.detected) {
      consolidationResult = result;
      break;
    }
  }

  if (!consolidationResult) return null;

  // Compute zone date bounds from the consolidation window bars
  const consolidationBar = consolidationResult.consolidationBar;
  const windowSize = config.consolidation.consolidation_window;
  const startBarIndex = Math.max(0, consolidationBar - windowSize + 1);
  const endBarIndex = consolidationBar;

  const startDate = dataPoints[startBarIndex].date;
  const endDate = dataPoints[endBarIndex].date;

  const high = consolidationResult.consolidationHigh;
  const low = consolidationResult.consolidationLow;

  // Compute rangePct: (high - low) / low * 100
  const rangePct = low > 0 ? (high - low) / low * 100 : 0;

  // Breakout marker is at the last bar (where breakout was detected)
  const breakoutMarker = {
    date: dataPoints[lastBarIndex].date,
    price: dataPoints[lastBarIndex].close,
    shape: 'arrowUp' as const,
    color: '#9C27B0',
  };

  // Legend entries for zone and breakout marker
  const legendEntries: LegendEntry[] = [
    {
      name: 'Consolidation Zone',
      color: 'rgba(156, 39, 176, 0.15)',
      style: 'zone',
    },
    {
      name: 'Breakout',
      color: '#9C27B0',
      style: 'marker',
    },
  ];

  return {
    strategy: 'consolidation_breakout',
    zone: {
      high,
      low,
      startDate,
      endDate,
      rangePct,
    },
    breakoutMarker,
    legendEntries,
  };
}

// ============================================================
// Volume Dry-Up Extractor
// ============================================================

/**
 * Extract volume dry-up overlay data from historical data and parameters.
 *
 * Identifies:
 * - Bars within volume_lookback where volume_ratio < volume_threshold
 * - Base zone bounds from consolidation window (high/low/startDate/endDate)
 * - Volume ratio label (current volume / average volume over lookback)
 *
 * Returns null if data is insufficient or no dry-up pattern detected.
 */
export function extractVolumeDryUpOverlay(
  dataPoints: HistoricalDataPoint[],
  params: Record<string, number>,
): VolumeDryUpOverlay | null {
  // Resolve parameters with defaults
  const volumeLookback = params.volume_lookback ?? DEFAULT_VDU_CONFIG.volume_lookback;
  const volumeThreshold = params.volume_threshold ?? params.volume_threshold_forming ?? DEFAULT_VDU_CONFIG.volume_threshold_forming;
  const consolidationWindow = params.consolidation_window ?? DEFAULT_VDU_CONFIG.consolidation_window;
  const minDecliningDays = params.min_declining_days ?? DEFAULT_VDU_CONFIG.min_declining_days;

  // Need enough data for lookback + consolidation window
  const minBars = Math.max(volumeLookback, consolidationWindow, 51);
  if (!dataPoints || dataPoints.length < minBars) {
    return null;
  }

  const lastBarIndex = dataPoints.length - 1;

  // --- Identify dry-up bars within the volume_lookback window ---
  const dryUpBars: string[] = [];
  const lookbackStart = Math.max(0, lastBarIndex - volumeLookback + 1);

  for (let i = lookbackStart; i <= lastBarIndex; i++) {
    const bar = dataPoints[i];
    if (!bar || !isValidBar(bar)) continue;

    const result = detectVolumeDryUp(
      dataPoints,
      i,
      { volume_lookback: volumeLookback, min_declining_days: minDecliningDays },
      volumeThreshold,
    );

    if (result.volume_ratio > 0 && result.volume_ratio < volumeThreshold) {
      dryUpBars.push(bar.date);
    }
  }

  // If no dry-up bars found, no pattern detected
  if (dryUpBars.length === 0) {
    return null;
  }

  // --- Compute base zone bounds from consolidation window ---
  let zone: VolumeDryUpOverlay['zone'] = null;

  if (lastBarIndex >= consolidationWindow - 1) {
    const windowStart = lastBarIndex - consolidationWindow + 1;
    let consolidationHigh = -Infinity;
    let consolidationLow = Infinity;
    let startDate: string | null = null;
    let endDate: string | null = null;

    for (let i = windowStart; i <= lastBarIndex; i++) {
      const bar = dataPoints[i];
      if (!bar || !isValidBar(bar)) continue;

      if (bar.high > consolidationHigh) consolidationHigh = bar.high;
      if (bar.low < consolidationLow) consolidationLow = bar.low;
      if (startDate === null) startDate = bar.date;
      endDate = bar.date;
    }

    if (
      consolidationHigh !== -Infinity &&
      consolidationLow !== Infinity &&
      startDate !== null &&
      endDate !== null
    ) {
      zone = {
        high: consolidationHigh,
        low: consolidationLow,
        startDate,
        endDate,
      };
    }
  }

  // --- Compute volume ratio label (current bar volume / average over lookback) ---
  let volumeRatioLabel: VolumeDryUpOverlay['volumeRatioLabel'] = null;

  const lastResult = detectVolumeDryUp(
    dataPoints,
    lastBarIndex,
    { volume_lookback: volumeLookback, min_declining_days: minDecliningDays },
    volumeThreshold,
  );

  if (lastResult.volume_ratio > 0) {
    volumeRatioLabel = {
      date: dataPoints[lastBarIndex].date,
      value: parseFloat(lastResult.volume_ratio.toFixed(2)),
    };
  }

  // --- Populate legend entries ---
  const legendEntries: LegendEntry[] = [];

  if (zone) {
    legendEntries.push({
      name: 'Base Zone',
      color: VDU_BASE_ZONE_COLOR,
      style: 'zone',
    });
  }

  legendEntries.push({
    name: 'Dry-Up Bars',
    color: VDU_DRY_UP_BAR_COLOR,
    style: 'marker',
  });

  if (volumeRatioLabel) {
    legendEntries.push({
      name: `Vol Ratio: ${volumeRatioLabel.value.toFixed(2)}x`,
      color: VDU_DRY_UP_BAR_COLOR,
      style: 'solid',
    });
  }

  return {
    strategy: 'volume_dry_up',
    zone,
    dryUpBars,
    volumeRatioLabel,
    legendEntries,
  };
}

// ============================================================
// Trend Pullback Extractor
// ============================================================

/**
 * Extract trend pullback overlay data from historical data and params.
 *
 * Computes:
 * - SMA10 line series for all bars with sufficient data (≥10 bars)
 * - Pullback bars identified via TrendPullbackEngine.detectPullback across the visible range
 * - Trigger bar (close above SMA10 with volume expansion)
 * - Legend entries for SMA10 line, pullback highlight, and trigger marker
 *
 * Returns null if data is insufficient for SMA10 computation (< 10 bars).
 */
export function extractTrendPullbackOverlay(
  dataPoints: HistoricalDataPoint[],
  params: Record<string, number>,
): TrendPullbackOverlay | null {
  // Need at least 10 bars for SMA10 computation
  if (!dataPoints || dataPoints.length < 10) {
    return null;
  }

  // --- Compute SMA10 line series for all bars with sufficient data ---
  const sma10Series: Array<{ time: string; value: number }> = [];
  for (let i = 9; i < dataPoints.length; i++) {
    const closes = dataPoints.slice(0, i + 1).map(d => d.close);
    const sma10Value = sma(closes, 10);
    if (sma10Value !== undefined) {
      sma10Series.push({ time: dataPoints[i].date, value: sma10Value });
    }
  }

  if (sma10Series.length === 0) {
    return null;
  }

  // --- Build SetupConfig from flat params ---
  const setupConfig: SetupConfig = {
    pullback_proximity_pct: params.pullback_proximity_pct ?? 3,
    atr_contraction_threshold: params.atr_contraction_threshold ?? 0.8,
    volume_below_avg_multiplier: params.volume_below_avg_multiplier ?? 0.8,
    swing_lookback: params.swing_lookback ?? 10,
    max_pullback_staleness: params.max_pullback_staleness ?? 5,
  };

  // --- Build TriggerConfig from flat params ---
  const triggerConfig: TriggerConfig = {
    trigger_volume_multiplier: params.trigger_volume_multiplier ?? 1.2,
  };

  // --- Identify pullback bars across the visible range ---
  const pullbackBars: string[] = [];
  for (let i = 0; i < dataPoints.length; i++) {
    const result = TrendPullbackEngine.detectPullback(dataPoints, i, setupConfig);
    if (result.detected) {
      pullbackBars.push(dataPoints[i].date);
    }
  }

  // --- Identify trigger bar (close above SMA10 with volume expansion) ---
  // Scan from the end backwards to find the most recent trigger bar
  let triggerMarker: TrendPullbackOverlay['triggerMarker'] = null;
  for (let i = dataPoints.length - 1; i >= 19; i--) {
    const triggered = TrendPullbackEngine.detectTrigger(dataPoints, i, triggerConfig);
    if (triggered) {
      triggerMarker = {
        date: dataPoints[i].date,
        price: dataPoints[i].close,
        shape: 'arrowUp',
        color: TRIGGER_MARKER_COLOR,
        text: 'Trigger',
      };
      break;
    }
  }

  // --- Populate legend entries ---
  const legendEntries: LegendEntry[] = [
    { name: 'SMA10', color: SMA10_COLOR, style: 'solid' },
    { name: 'Pullback Bar', color: PULLBACK_HIGHLIGHT_COLOR, style: 'zone' },
    { name: 'Trigger', color: TRIGGER_MARKER_COLOR, style: 'marker' },
  ];

  return {
    strategy: 'trend_pullback',
    sma10: sma10Series,
    pullbackBars,
    triggerMarker,
    legendEntries,
  };
}

// ============================================================
// Bear Breakdown Extractor
// ============================================================

/**
 * Extract bear breakdown overlay data.
 *
 * Re-runs BearBreakdownEngine.shouldEnter on the last bar to confirm
 * a signal exists, then scans backwards for the consolidation zone and
 * identifies the breakdown bar.
 *
 * Returns null if no actionable signal is detected or data is insufficient.
 */
export function extractBearBreakdownOverlay(
  dataPoints: HistoricalDataPoint[],
  params: Record<string, number>,
): BearBreakdownOverlay | null {
  if (dataPoints.length < 51) return null;

  const config = buildBearBreakdownConfig(params);
  const lastBarIndex = dataPoints.length - 1;

  // Check if there's an actionable signal on the last bar
  const entryResult = BearBreakdownEngine.shouldEnter(
    dataPoints,
    lastBarIndex,
    config,
  );

  if (!entryResult) return null;

  // Scan backwards from the bar before the breakdown to find the consolidation zone
  const maxStaleness = config.consolidation.max_staleness;
  let consolidationResult: {
    detected: boolean;
    consolidationHigh: number;
    consolidationLow: number;
    consolidationBar: number;
  } | null = null;

  for (let i = lastBarIndex - 1; i >= Math.max(lastBarIndex - maxStaleness, 0); i--) {
    const result = BearBreakdownEngine.detectConsolidation(
      dataPoints,
      i,
      {
        consolidation_window: config.consolidation.consolidation_window,
        max_range_pct: config.consolidation.max_range_pct,
        atr_ratio_threshold: config.consolidation.atr_ratio_threshold,
      },
    );
    if (result.detected) {
      consolidationResult = result;
      break;
    }
  }

  if (!consolidationResult) return null;

  // Verify breakdown is detected at the last bar
  const breakdownDetected = BearBreakdownEngine.detectBreakdown(
    dataPoints,
    lastBarIndex,
    consolidationResult.consolidationLow,
    { volume_multiplier: config.breakdown.volume_multiplier },
  );

  if (!breakdownDetected) return null;

  // Compute zone date bounds from the consolidation window bars
  const consolidationBar = consolidationResult.consolidationBar;
  const windowSize = config.consolidation.consolidation_window;
  const startBarIndex = Math.max(0, consolidationBar - windowSize + 1);
  const endBarIndex = consolidationBar;

  const startDate = dataPoints[startBarIndex].date;
  const endDate = dataPoints[endBarIndex].date;

  const high = consolidationResult.consolidationHigh;
  const low = consolidationResult.consolidationLow;

  // Compute rangePct: (high - low) / low * 100
  const rangePct = low > 0 ? (high - low) / low * 100 : 0;

  // Breakdown marker is at the last bar (where breakdown was detected)
  const breakdownMarker = {
    date: dataPoints[lastBarIndex].date,
    price: dataPoints[lastBarIndex].close,
    shape: 'arrowDown' as const,
    color: '#FF9800',
  };

  // Legend entries for zone and breakdown marker
  const legendEntries: LegendEntry[] = [
    {
      name: 'Consolidation Zone',
      color: 'rgba(255, 152, 0, 0.15)',
      style: 'zone',
    },
    {
      name: 'Breakdown',
      color: '#FF9800',
      style: 'marker',
    },
  ];

  return {
    strategy: 'bear_breakdown',
    zone: {
      high,
      low,
      startDate,
      endDate,
      rangePct,
    },
    breakdownMarker,
    legendEntries,
  };
}

// ============================================================
// Keltner Mean Reversion Extractor
// ============================================================

/**
 * Extract Keltner Mean Reversion overlay data from historical data and params.
 *
 * Computes upper/lower Keltner bands for all bars, identifies dip and reclaim bars,
 * and returns structured overlay data for client-side rendering.
 *
 * Returns null if data is insufficient for band computation.
 */
export function extractKeltnerMeanReversionOverlay(
  dataPoints: HistoricalDataPoint[],
  params: Record<string, number>,
): KeltnerMeanReversionOverlay | null {
  const config: KeltnerMeanReversionConfiguration = buildKeltnerMeanReversionConfig(params);

  // Minimum bars needed to compute at least one band value
  const minRequired = Math.max(config.ema_period, config.atr_period + 1);
  if (dataPoints.length < minRequired) {
    return null;
  }

  // Compute bands for all bars
  const upperBand: Array<{ time: string; value: number }> = [];
  const lowerBand: Array<{ time: string; value: number }> = [];

  for (let i = 0; i < dataPoints.length; i++) {
    const bands = KeltnerMeanReversionEngine.computeBands(dataPoints, i, config);
    if (bands !== undefined) {
      upperBand.push({ time: dataPoints[i].date, value: bands.upperBand });
      lowerBand.push({ time: dataPoints[i].date, value: bands.lowerBand });
    }
  }

  // If no bands could be computed, return null
  if (upperBand.length === 0) {
    return null;
  }

  // Detect dip bar: search backwards from the last bar within reclaim_lookback
  const lastBarIndex = dataPoints.length - 1;
  const dipResult = KeltnerMeanReversionEngine.detectDip(dataPoints, lastBarIndex, config);

  let dipMarker: KeltnerMeanReversionOverlay['dipMarker'] = null;
  let reclaimMarker: KeltnerMeanReversionOverlay['reclaimMarker'] = null;

  if (dipResult.detected) {
    const dipBarIndex = dipResult.dipBarIndex;
    dipMarker = {
      date: dataPoints[dipBarIndex].date,
      price: dataPoints[dipBarIndex].close,
      shape: 'arrowDown',
      color: DIP_MARKER_COLOR,
    };

    // Find reclaim bar: first bar after dip where close > lower band
    for (let i = dipBarIndex + 1; i <= lastBarIndex; i++) {
      const bands = KeltnerMeanReversionEngine.computeBands(dataPoints, i, config);
      if (bands !== undefined && dataPoints[i].close > bands.lowerBand) {
        reclaimMarker = {
          date: dataPoints[i].date,
          price: dataPoints[i].close,
          shape: 'arrowUp',
          color: RECLAIM_MARKER_COLOR,
        };
        break;
      }
    }
  }

  // Build legend entries
  const legendEntries: LegendEntry[] = [
    { name: 'Keltner Upper Band', color: KELTNER_BAND_COLOR, style: 'solid' },
    { name: 'Keltner Lower Band', color: KELTNER_BAND_COLOR, style: 'solid' },
  ];

  if (dipMarker) {
    legendEntries.push({ name: 'Dip Bar', color: DIP_MARKER_COLOR, style: 'marker' });
  }
  if (reclaimMarker) {
    legendEntries.push({ name: 'Reclaim Bar', color: RECLAIM_MARKER_COLOR, style: 'marker' });
  }

  return {
    strategy: 'keltner_mean_reversion',
    legendEntries,
    upperBand,
    lowerBand,
    dipMarker,
    reclaimMarker,
  };
}
