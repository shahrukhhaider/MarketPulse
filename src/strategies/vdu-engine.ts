import type { HistoricalDataPoint, BacktestResult, Signal, PerformanceSummary, Trade, V2Signal, SignalDirection, V2CompatibleEngine } from '../types.js';
import type { TunableStrategyInterface, SignalOutput } from './strategy-registry.js';
import type { ParameterSpace } from './parameter-grid.js';
import { atr, sma } from '../indicators/indicators.js';
import { scoreCandlesticks } from '../indicators/candlestick-scorer.js';

// ============================================================
// VDU Configuration Interface
// ============================================================

export interface VduConfig {
  // Base formation parameters
  consolidation_window: number;      // 10–20 bars
  max_range_pct: number;             // 3–6% (used as FORMING threshold)
  atr_ratio_threshold: number;       // 0.60–0.90 (used as FORMING threshold)
  proximity_to_highs_pct: number;    // 2–5%

  // Volume parameters
  volume_lookback: number;           // fixed: 20
  volume_threshold_forming: number;  // 0.75–0.85
  volume_threshold_near: number;     // 0.55–0.70
  volume_threshold_active: number;   // 0.35–0.50
  min_declining_days: number;        // 2–4

  // State-specific thresholds (derived from base for NEAR/ACTIVE)
  near_range_pct: number;            // max_range_pct - 1 (default 5%)
  near_atr_ratio: number;            // atr_ratio_threshold * 0.85 (default 0.85)
  active_range_pct: number;          // max_range_pct - 2 (default 4%)
  active_atr_ratio: number;          // atr_ratio_threshold * 0.70 (default 0.70)

  // Stop-loss parameters
  stopLoss: {
    atr_multiple: number;            // ATR multiplier for stop distance
    swing_lookback: number;          // bars to look back for structure stop
    buffer: number;                  // buffer multiplier for structure stop
  };

  // Profit target
  r_multiple: number;                // risk-reward multiple for target

  // Trend exit
  sma_period: number;                // SMA period for trend exit (backtest)

  // Risk management
  max_risk_pct: number;              // maximum allowed risk percentage
}

// ============================================================
// Default Configuration
// ============================================================

export const DEFAULT_VDU_CONFIG: VduConfig = {
  consolidation_window: 15,
  max_range_pct: 6,
  atr_ratio_threshold: 1.0,
  proximity_to_highs_pct: 3,
  volume_lookback: 20,
  volume_threshold_forming: 0.80,
  volume_threshold_near: 0.60,
  volume_threshold_active: 0.45,
  min_declining_days: 3,
  near_range_pct: 5,
  near_atr_ratio: 0.85,
  active_range_pct: 4,
  active_atr_ratio: 0.70,
  stopLoss: {
    atr_multiple: 1.5,
    swing_lookback: 20,
    buffer: 0.5,
  },
  r_multiple: 2.0,
  sma_period: 50,
  max_risk_pct: 8,
};

// ============================================================
// Data Validation Helpers
// ============================================================

/**
 * Validates that a bar has finite, positive OHLC values,
 * non-negative volume, and high >= low.
 */
export function isValidBar(bar: HistoricalDataPoint): boolean {
  return (
    Number.isFinite(bar.close) && bar.close > 0 &&
    Number.isFinite(bar.high) && bar.high > 0 &&
    Number.isFinite(bar.low) && bar.low > 0 &&
    Number.isFinite(bar.open) && bar.open > 0 &&
    Number.isFinite(bar.volume) && bar.volume >= 0 &&
    bar.high >= bar.low
  );
}

// ============================================================
// Math Helpers
// ============================================================

/**
 * Computes the slope of a simple linear regression (y = mx + b)
 * over the given values, where x = 0, 1, 2, ..., n-1.
 * Returns 0 if fewer than 2 values are provided.
 */
export function linearRegressionSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;

  // x values are 0, 1, 2, ..., n-1
  // sum_x = n*(n-1)/2, sum_x2 = n*(n-1)*(2n-1)/6
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;

  let sumY = 0;
  let sumXY = 0;
  for (let i = 0; i < n; i++) {
    sumY += values[i];
    sumXY += i * values[i];
  }

  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;

  return (n * sumXY - sumX * sumY) / denominator;
}

// ============================================================
// Volume Dry-Up Detection
// ============================================================

/**
 * Detects volume dry-up conditions by computing:
 * - volume_ratio: current volume / mean of last `volume_lookback` volumes
 * - volume_slope: linear regression slope over last `min_declining_days` bars
 * - met: true if volume_ratio < threshold AND volume_slope < 0
 *
 * Returns zero-valued metrics with met=false for invalid inputs
 * (insufficient data, out-of-bounds barIndex, zero average volume).
 */
export function detectVolumeDryUp(
  data: HistoricalDataPoint[],
  barIndex: number,
  params: { volume_lookback: number; min_declining_days: number },
  threshold: number
): { volume_ratio: number; volume_slope: number; met: boolean } {
  const failResult = { volume_ratio: 0, volume_slope: 0, met: false };

  // Validate barIndex bounds
  if (
    !Number.isFinite(barIndex) ||
    barIndex < 0 ||
    barIndex >= data.length ||
    !Array.isArray(data) ||
    data.length === 0
  ) {
    return failResult;
  }

  const { volume_lookback, min_declining_days } = params;

  // Need enough bars for the lookback window
  if (barIndex < volume_lookback - 1) {
    return failResult;
  }

  // Collect volumes over the lookback window, filtering by isValidBar
  const lookbackVolumes: number[] = [];
  for (let i = barIndex - volume_lookback + 1; i <= barIndex; i++) {
    if (i >= 0 && i < data.length && isValidBar(data[i])) {
      lookbackVolumes.push(data[i].volume);
    }
  }

  // Compute average volume
  if (lookbackVolumes.length === 0) {
    return failResult;
  }

  let sumVolumes = 0;
  for (const v of lookbackVolumes) {
    sumVolumes += v;
  }
  const avgVolume = sumVolumes / lookbackVolumes.length;

  // Handle zero average volume edge case
  if (avgVolume === 0) {
    return failResult;
  }

  // Current volume (use raw value from current bar)
  const currentBar = data[barIndex];
  if (!isValidBar(currentBar)) {
    return failResult;
  }
  const currentVolume = currentBar.volume;
  const volumeRatio = currentVolume / avgVolume;

  // Compute volume slope via linear regression over min_declining_days
  const slopeVolumes: number[] = [];
  for (let i = barIndex - min_declining_days + 1; i <= barIndex; i++) {
    if (i >= 0 && i < data.length && isValidBar(data[i])) {
      slopeVolumes.push(data[i].volume);
    }
  }

  const volumeSlope = linearRegressionSlope(slopeVolumes);

  // Determine if volume condition is met
  const met = volumeRatio < threshold && volumeSlope < 0;

  return { volume_ratio: volumeRatio, volume_slope: volumeSlope, met };
}

// ============================================================
// Direction Phase Detection
// ============================================================

/**
 * Computes the simple moving average of close prices over a window,
 * using only valid bars (via isValidBar). Returns NaN if insufficient
 * valid bars are found.
 */
function computeSmaFromCloses(
  data: HistoricalDataPoint[],
  endIndex: number,
  period: number
): number {
  let sum = 0;
  let count = 0;

  for (let i = endIndex - period + 1; i <= endIndex; i++) {
    if (i < 0 || i >= data.length) continue;
    const bar = data[i];
    if (isValidBar(bar)) {
      sum += bar.close;
      count++;
    }
  }

  if (count < period) return NaN;
  return sum / count;
}

/**
 * Detects whether the Direction Phase passes for a given bar.
 *
 * Conditions (all must be true):
 *   1. close[barIndex] > SMA(50) at barIndex
 *   2. SMA(20) at barIndex > SMA(50) at barIndex
 *   3. SMA(50) at barIndex > SMA(50) at barIndex-1 (positive slope)
 *
 * Returns false for barIndex < 50 or insufficient data.
 */
export function detectDirection(
  data: HistoricalDataPoint[],
  barIndex: number
): boolean {
  // Guard: need at least 51 bars (indices 0..50) to compute SMA(50) at barIndex and barIndex-1
  if (barIndex < 50) return false;
  if (barIndex >= data.length) return false;
  if (!data[barIndex] || !isValidBar(data[barIndex])) return false;

  const sma50Current = computeSmaFromCloses(data, barIndex, 50);
  const sma50Prev = computeSmaFromCloses(data, barIndex - 1, 50);
  const sma20 = computeSmaFromCloses(data, barIndex, 20);

  // If any SMA couldn't be computed, direction fails
  if (!Number.isFinite(sma50Current) || !Number.isFinite(sma50Prev) || !Number.isFinite(sma20)) {
    return false;
  }

  return (
    data[barIndex].close > sma50Current &&
    sma20 > sma50Current &&
    sma50Current > sma50Prev
  );
}

// ============================================================
// Entry / Stop / Target Computation
// ============================================================

/**
 * Computes entry, stop, and target prices for a VDU signal.
 *
 * This function does NOT run the full detection pipeline (direction/base/volume).
 * It only computes the trade parameters given the data and config.
 *
 * Returns null when:
 *   - barIndex is out of bounds or insufficient data for the consolidation window
 *   - ATR(14) cannot be computed (need at least 15 bars ending at barIndex)
 *   - rValue (entryPrice - stopPrice) <= 0
 *   - risk_pct exceeds config.max_risk_pct
 */
export function shouldEnter(
  data: HistoricalDataPoint[],
  barIndex: number,
  config: VduConfig
): { entryPrice: number; stopPrice: number; targetPrice: number; risk_pct: number } | null {
  // Guard: barIndex must be valid
  if (barIndex < 0 || barIndex >= data.length) return null;

  const window = config.consolidation_window;

  // Guard: need enough bars for the consolidation window
  if (barIndex - window + 1 < 0) return null;

  // Compute consolidation_high and consolidation_low over the window, using valid bars only
  let consolidationHigh = -Infinity;
  let consolidationLow = Infinity;
  let validCount = 0;

  for (let i = barIndex - window + 1; i <= barIndex; i++) {
    const bar = data[i];
    if (!bar || !isValidBar(bar)) continue;
    if (bar.high > consolidationHigh) consolidationHigh = bar.high;
    if (bar.low < consolidationLow) consolidationLow = bar.low;
    validCount++;
  }

  // Need at least some valid bars
  if (validCount === 0 || consolidationHigh === -Infinity || consolidationLow === Infinity) {
    return null;
  }

  // Entry price: consolidation high + 0.5% buffer
  const entryPrice = consolidationHigh * 1.005;

  // Compute ATR(14) — need at least 15 data points ending at barIndex
  const sliceUpToBar = data.slice(0, barIndex + 1);
  const atr14 = atr(sliceUpToBar, 14);
  if (atr14 === undefined || atr14 === 0) return null;

  // ATR-based stop: consolidation_low - (atr_multiple * ATR(14))
  const atrStop = consolidationLow - (config.stopLoss.atr_multiple * atr14);

  // Structure-based stop: swing_low - (buffer * ATR(14))
  const swingLookback = config.stopLoss.swing_lookback;
  let swingLow = Infinity;

  const swingStart = barIndex - swingLookback + 1;
  for (let i = Math.max(0, swingStart); i <= barIndex; i++) {
    const bar = data[i];
    if (!bar || !isValidBar(bar)) continue;
    if (bar.low < swingLow) swingLow = bar.low;
  }

  // If no valid bars found for swing, fall back to consolidation low
  if (swingLow === Infinity) {
    swingLow = consolidationLow;
  }

  const structureStop = swingLow - (config.stopLoss.buffer * atr14);

  // Final stop: max of the two (tighter stop wins)
  const stopPrice = Math.max(atrStop, structureStop);

  // Risk value
  const rValue = entryPrice - stopPrice;
  if (rValue <= 0) return null;

  // Risk percentage
  const risk_pct = (rValue / entryPrice) * 100;
  if (risk_pct > config.max_risk_pct) return null;

  // Target price
  const targetPrice = entryPrice + (config.r_multiple * rValue);

  return { entryPrice, stopPrice, targetPrice, risk_pct };
}

// ============================================================
// Base Formation Detection
// ============================================================

/**
 * Detects base formation metrics for a given bar.
 *
 * Computes:
 *   - range_pct: (highest_high - lowest_low) / current_close * 100
 *   - proximity_to_highs: (highest_high - current_close) / highest_high * 100
 *   - atr_ratio: ATR(14) / ATR(50)
 *
 * Returns zero-valued metrics for invalid inputs (barIndex out of bounds,
 * insufficient data for the consolidation window or ATR computation).
 */
export function detectBaseFormation(
  data: HistoricalDataPoint[],
  barIndex: number,
  params: {
    consolidation_window: number;
    proximity_to_highs_pct: number;
    atr_ratio_threshold: number;
  }
): { range_pct: number; proximity_to_highs: number; atr_ratio: number } {
  const ZERO_METRICS = { range_pct: 0, proximity_to_highs: 0, atr_ratio: 0 };

  // Guard: barIndex must be valid
  if (barIndex < 0 || barIndex >= data.length) return ZERO_METRICS;

  const window = params.consolidation_window;

  // Guard: need enough bars for the consolidation window
  if (barIndex - window + 1 < 0) return ZERO_METRICS;

  // Guard: current bar must be valid
  if (!data[barIndex] || !isValidBar(data[barIndex])) return ZERO_METRICS;

  // Compute highest high and lowest low over the consolidation window,
  // using only valid bars
  let highestHigh = -Infinity;
  let lowestLow = Infinity;
  let validCount = 0;

  for (let i = barIndex - window + 1; i <= barIndex; i++) {
    const bar = data[i];
    if (!bar || !isValidBar(bar)) continue;
    if (bar.high > highestHigh) highestHigh = bar.high;
    if (bar.low < lowestLow) lowestLow = bar.low;
    validCount++;
  }

  // Need at least some valid bars in the window
  if (validCount === 0 || highestHigh === -Infinity || lowestLow === Infinity) {
    return ZERO_METRICS;
  }

  const currentClose = data[barIndex].close;

  // Compute range_pct
  const range_pct = ((highestHigh - lowestLow) / currentClose) * 100;

  // Compute proximity_to_highs
  const proximity_to_highs = ((highestHigh - currentClose) / highestHigh) * 100;

  // Compute ATR ratio: ATR(14) / ATR(50)
  // The atr() function operates on a slice ending at the last element,
  // so we slice data[0..barIndex] (inclusive)
  const sliceUpToBar = data.slice(0, barIndex + 1);

  // ATR(14) needs at least 15 data points (period + 1)
  const atr14 = atr(sliceUpToBar, 14);
  // ATR(50) needs at least 51 data points (period + 1)
  const atr50 = atr(sliceUpToBar, 50);

  if (atr14 === undefined || atr50 === undefined || atr50 === 0) {
    return ZERO_METRICS;
  }

  const atr_ratio_value = atr14 / atr50;

  return { range_pct, proximity_to_highs, atr_ratio: atr_ratio_value };
}

// ============================================================
// State Classification
// ============================================================

/**
 * Classifies the VDU signal state based on base formation metrics,
 * volume metrics, and state-specific thresholds.
 *
 * Gates on proximity_to_highs and volume_slope first, then checks
 * ACTIVE (tightest), NEAR, and FORMING (loosest) thresholds in
 * priority order. Returns the highest applicable state.
 */
export function classifyState(
  baseMetrics: { range_pct: number; proximity_to_highs: number; atr_ratio: number },
  volumeMetrics: { volume_ratio: number; volume_slope: number; met: boolean },
  thresholds: {
    max_range_pct: number;
    near_range_pct: number;
    active_range_pct: number;
    atr_ratio_threshold: number;
    near_atr_ratio: number;
    active_atr_ratio: number;
    proximity_to_highs_pct: number;
    volume_threshold_forming: number;
    volume_threshold_near: number;
    volume_threshold_active: number;
  }
): 'active' | 'near' | 'forming' | 'none' {
  // Gate: proximity to highs must pass for any state
  if (baseMetrics.proximity_to_highs > thresholds.proximity_to_highs_pct) {
    return 'none';
  }

  // Gate: volume slope must be negative for any state
  if (volumeMetrics.volume_slope >= 0) {
    return 'none';
  }

  // Check ACTIVE (tightest thresholds)
  if (
    baseMetrics.range_pct < thresholds.active_range_pct &&
    baseMetrics.atr_ratio < thresholds.active_atr_ratio &&
    volumeMetrics.volume_ratio < thresholds.volume_threshold_active
  ) {
    return 'active';
  }

  // Check NEAR
  if (
    baseMetrics.range_pct < thresholds.near_range_pct &&
    baseMetrics.atr_ratio < thresholds.near_atr_ratio &&
    volumeMetrics.volume_ratio < thresholds.volume_threshold_near
  ) {
    return 'near';
  }

  // Check FORMING (loosest thresholds)
  if (
    baseMetrics.range_pct < thresholds.max_range_pct &&
    baseMetrics.atr_ratio < thresholds.atr_ratio_threshold &&
    volumeMetrics.volume_ratio < thresholds.volume_threshold_forming
  ) {
    return 'forming';
  }

  return 'none';
}

// ============================================================
// VDU Backtest Types
// ============================================================

export type VduOutcome = 'won' | 'lost' | 'expired';

export interface VduBacktestTrade {
  signalDate: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  outcome: VduOutcome;
  outcomeBar: number;
  outcomePrice: number;
  daysToResolution: number;
}

// ============================================================
// VduEngine — TunableStrategyInterface Implementation
// ============================================================

export class VduEngine implements TunableStrategyInterface {
  readonly name = 'volume_dry_up';

  /**
   * Returns the parameter grid for walk-forward tuning.
   * Each key maps to an array of candidate values to explore.
   */
  paramSpace(): ParameterSpace {
    return {
      consolidation_window: [10, 12, 15, 18, 20],
      max_range_pct: [3, 4, 5, 6],
      atr_ratio_threshold: [0.60, 0.70, 0.80, 0.90],
      volume_threshold_active: [0.35, 0.40, 0.45, 0.50],
      volume_threshold_near: [0.55, 0.60, 0.65, 0.70],
      volume_threshold_forming: [0.75, 0.80, 0.85],
      min_declining_days: [2, 3, 4],
    };
  }

  /**
   * Runs a backtest over historical data, detecting ACTIVE signals and
   * classifying outcomes as won/lost/expired over a 10-bar window.
   *
   * Outcome classification:
   * - "won": daily bar high >= entryPrice on any of the 10 trading days following signal date
   * - "lost": daily bar low <= stopPrice before high reaches entryPrice, or same bar (stop priority)
   * - "expired": neither condition triggers within 10 trading days
   *
   * Returns a BacktestResult conforming to the existing interface.
   */
  runBacktest(data: HistoricalDataPoint[], params: Record<string, number>): BacktestResult {
    const config = buildVduConfigFromParams(params);
    const trades: Trade[] = [];
    const signals: Signal[] = [];
    const vduTrades: VduBacktestTrade[] = [];

    // Constants
    const ENTRY_WINDOW = 10;    // bars to wait for breakout entry
    const MAX_HOLD_BARS = 90;   // max bars to hold after entry

    // Start from index 51 (need enough data for direction phase)
    const startIndex = 51;
    let i = startIndex;

    while (i < data.length) {
      // Run the full detection pipeline at this bar
      if (!detectDirection(data, i)) {
        i++;
        continue;
      }

      const baseMetrics = detectBaseFormation(data, i, {
        consolidation_window: config.consolidation_window,
        proximity_to_highs_pct: config.proximity_to_highs_pct,
        atr_ratio_threshold: config.atr_ratio_threshold,
      });

      const volumeMetrics = detectVolumeDryUp(
        data,
        i,
        { volume_lookback: config.volume_lookback, min_declining_days: config.min_declining_days },
        config.volume_threshold_active
      );

      const state = classifyState(baseMetrics, volumeMetrics, {
        max_range_pct: config.max_range_pct,
        near_range_pct: config.near_range_pct,
        active_range_pct: config.active_range_pct,
        atr_ratio_threshold: config.atr_ratio_threshold,
        near_atr_ratio: config.near_atr_ratio,
        active_atr_ratio: config.active_atr_ratio,
        proximity_to_highs_pct: config.proximity_to_highs_pct,
        volume_threshold_forming: config.volume_threshold_forming,
        volume_threshold_near: config.volume_threshold_near,
        volume_threshold_active: config.volume_threshold_active,
      });

      if (state !== 'active') {
        i++;
        continue;
      }

      // Compute entry/stop/target
      const entryResult = shouldEnter(data, i, config);
      if (entryResult === null) {
        i++;
        continue;
      }

      const { entryPrice, stopPrice, targetPrice } = entryResult;
      const signalDate = data[i].date;

      // ============================================================
      // PHASE 1: Wait for entry (up to ENTRY_WINDOW bars)
      // ============================================================
      let entryBar = -1;
      let entryExpired = false;
      const entryWindowEnd = Math.min(i + ENTRY_WINDOW, data.length - 1);

      for (let j = i + 1; j <= entryWindowEnd; j++) {
        const bar = data[j];
        if (!bar || !isValidBar(bar)) continue;

        // Stop hit before entry → signal invalidated
        if (bar.low <= stopPrice && bar.high < entryPrice) {
          entryExpired = true;
          break;
        }

        // Both on same bar → signal invalidated (stop priority)
        if (bar.low <= stopPrice && bar.high >= entryPrice) {
          entryExpired = true;
          break;
        }

        // Entry triggered
        if (bar.high >= entryPrice) {
          entryBar = j;
          break;
        }
      }

      // Entry never triggered or invalidated
      if (entryBar === -1 || entryExpired) {
        const outcome: VduOutcome = 'expired';
        const lastBar = entryWindowEnd;
        const exitPrice = lastBar < data.length ? data[lastBar].close : 0;

        vduTrades.push({
          signalDate,
          entryPrice,
          stopPrice,
          targetPrice,
          outcome,
          outcomeBar: lastBar,
          outcomePrice: exitPrice,
          daysToResolution: entryWindowEnd - i,
        });

        // No trade opened — skip to after entry window
        i = entryWindowEnd + 1;
        continue;
      }

      // ============================================================
      // PHASE 2: Manage position (up to MAX_HOLD_BARS after entry)
      // Track until target hit, stop hit, or time exit
      // ============================================================
      let outcome: VduOutcome = 'expired';
      let outcomeBar = -1;
      let outcomePrice = 0;
      let daysToResolution = 0;

      const holdEnd = Math.min(entryBar + MAX_HOLD_BARS, data.length - 1);

      for (let j = entryBar + 1; j <= holdEnd; j++) {
        const bar = data[j];
        if (!bar || !isValidBar(bar)) continue;

        const holdDay = j - entryBar;

        // Check stop hit (low <= stopPrice)
        const stopHit = bar.low <= stopPrice;
        // Check target hit (high >= targetPrice)
        const targetHit = bar.high >= targetPrice;

        if (stopHit && targetHit) {
          // Both on same bar — assume stop hit first (conservative)
          outcome = 'lost';
          outcomeBar = j;
          outcomePrice = stopPrice;
          daysToResolution = holdDay;
          break;
        }

        if (stopHit) {
          outcome = 'lost';
          outcomeBar = j;
          outcomePrice = stopPrice;
          daysToResolution = holdDay;
          break;
        }

        if (targetHit) {
          outcome = 'won';
          outcomeBar = j;
          outcomePrice = targetPrice;
          daysToResolution = holdDay;
          break;
        }
      }

      // Time exit: close position at bar close after max hold
      if (outcome === 'expired') {
        outcomeBar = holdEnd;
        if (holdEnd >= 0 && holdEnd < data.length && data[holdEnd]) {
          outcomePrice = data[holdEnd].close;
        }
        daysToResolution = holdEnd - entryBar;
      }

      // Record the VDU trade
      vduTrades.push({
        signalDate,
        entryPrice,
        stopPrice,
        targetPrice,
        outcome,
        outcomeBar,
        outcomePrice,
        daysToResolution,
      });

      // Create Signal and Trade objects for BacktestResult compatibility
      const buySignal: Signal = {
        id: `vdu-buy-${entryBar}`,
        ticker: '',
        direction: 'BUY',
        strategyType: 'volume_dry_up' as any,
        price: entryPrice,
        timestamp: data[entryBar].date,
      };
      signals.push(buySignal);

      const sellSignal: Signal = {
        id: `vdu-sell-${outcomeBar}`,
        ticker: '',
        direction: 'SELL',
        strategyType: 'volume_dry_up' as any,
        price: outcomePrice,
        timestamp: outcomeBar >= 0 && outcomeBar < data.length ? data[outcomeBar].date : signalDate,
      };
      signals.push(sellSignal);

      // Compute profit/loss percent (from entry price)
      const profitLossPercent = ((outcomePrice - entryPrice) / entryPrice) * 100;

      trades.push({
        buySignal,
        sellSignal,
        profitLossPercent,
      });

      // Skip bars while trade is active (no overlapping signals)
      i = (outcomeBar >= 0 ? outcomeBar : holdEnd) + 1;
    }

    // Compute aggregate metrics
    const totalSignals = vduTrades.length;
    const wonTrades = vduTrades.filter(t => t.outcome === 'won');
    const winRate = totalSignals > 0 ? wonTrades.length / totalSignals : 0;

    // Average R-multiple for won trades
    let avgR = 0;
    if (wonTrades.length > 0) {
      let totalR = 0;
      for (const t of wonTrades) {
        const rValue = t.entryPrice - t.stopPrice;
        if (rValue > 0) {
          totalR += (t.outcomePrice - t.entryPrice) / rValue;
        }
      }
      avgR = totalR / wonTrades.length;
    }

    // Compute total return and max drawdown
    let totalReturnPercent = 0;
    let maxDrawdownPercent = 0;
    let peak = 0;
    let cumulative = 0;

    for (const trade of trades) {
      cumulative += trade.profitLossPercent;
      if (cumulative > peak) peak = cumulative;
      const drawdown = peak - cumulative;
      if (drawdown > maxDrawdownPercent) maxDrawdownPercent = drawdown;
    }
    totalReturnPercent = cumulative;

    // Benchmark return (buy and hold)
    let benchmarkReturnPercent = 0;
    if (data.length > startIndex && data[startIndex] && data[data.length - 1]) {
      const startPrice = data[startIndex].close;
      const endPrice = data[data.length - 1].close;
      if (startPrice > 0) {
        benchmarkReturnPercent = ((endPrice - startPrice) / startPrice) * 100;
      }
    }

    // Sharpe ratio approximation (simplified)
    let sharpeRatio = 0;
    if (trades.length > 1) {
      const returns = trades.map(t => t.profitLossPercent);
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / (returns.length - 1);
      const stdDev = Math.sqrt(variance);
      if (stdDev > 0) {
        sharpeRatio = mean / stdDev;
      }
    }

    const performanceSummary: PerformanceSummary = {
      totalReturnPercent,
      benchmarkReturnPercent,
      numberOfTrades: totalSignals,
      winRate,
      maxDrawdownPercent,
      trades,
      sharpeRatio,
    };

    return {
      ticker: '',
      strategyType: 'volume_dry_up' as any,
      params: params as any,
      period: data.length > 0 ? `${data[0].date} to ${data[data.length - 1].date}` : '',
      dataPointsEvaluated: data.length,
      signals,
      performanceSummary,
    };
  }

  /**
   * Orchestrates the full VDU detection pipeline:
   *   Direction → Base Formation → Volume Dry-Up → Classify → Entry → Candlestick Confirmation
   *
   * Returns a SignalOutput with strategy = 'volume_dry_up'.
   */
  detectSignal(data: HistoricalDataPoint[], params: Record<string, number>): SignalOutput {
    const barIndex = data.length - 1;
    const date = data.length > 0 ? data[barIndex].date : new Date().toISOString().slice(0, 10);

    // Build config from params (fall back to defaults for missing values)
    const config = buildVduConfigFromParams(params);

    const noneOutput: SignalOutput = {
      ticker: '',
      strategy: 'volume_dry_up',
      signal: 'none',
      date,
      entry: 0,
      stop: 0,
      risk_pct: 0,
      confidence: 0,
      reason: [],
    };

    // Guard: need at least 51 bars
    if (data.length < 51) {
      noneOutput.reason = [`Insufficient data for VDU detection (need 51+ bars, got ${data.length})`];
      return noneOutput;
    }

    // ---- Phase 1: Direction ----
    const directionPassed = detectDirection(data, barIndex);
    if (!directionPassed) {
      noneOutput.reason = ['Direction phase failed — no uptrend'];
      return noneOutput;
    }

    // ---- Phase 2: Base Formation ----
    const baseMetrics = detectBaseFormation(data, barIndex, {
      consolidation_window: config.consolidation_window,
      proximity_to_highs_pct: config.proximity_to_highs_pct,
      atr_ratio_threshold: config.atr_ratio_threshold,
    });

    // If base metrics are all zero, ATR computation likely failed
    if (baseMetrics.range_pct === 0 && baseMetrics.proximity_to_highs === 0 && baseMetrics.atr_ratio === 0) {
      noneOutput.reason = ['ATR computation failed (insufficient price data)'];
      return noneOutput;
    }

    // ---- Phase 3: Volume Dry-Up ----
    const volumeMetrics = detectVolumeDryUp(
      data,
      barIndex,
      { volume_lookback: config.volume_lookback, min_declining_days: config.min_declining_days },
      config.volume_threshold_forming // use loosest threshold for detection
    );

    // Check for zero volume edge case
    if (volumeMetrics.volume_ratio === 0 && volumeMetrics.volume_slope === 0 && !volumeMetrics.met) {
      // Could be zero volume or insufficient data — check if it's the zero-volume case
      const lookbackStart = barIndex - config.volume_lookback + 1;
      if (lookbackStart >= 0) {
        let allZero = true;
        for (let i = lookbackStart; i <= barIndex; i++) {
          if (i >= 0 && i < data.length && data[i].volume > 0) {
            allZero = false;
            break;
          }
        }
        if (allZero) {
          noneOutput.reason = ['Zero volume across lookback window'];
          return noneOutput;
        }
      }
    }

    // ---- Phase 4: State Classification ----
    const state = classifyState(baseMetrics, volumeMetrics, {
      max_range_pct: config.max_range_pct,
      near_range_pct: config.near_range_pct,
      active_range_pct: config.active_range_pct,
      atr_ratio_threshold: config.atr_ratio_threshold,
      near_atr_ratio: config.near_atr_ratio,
      active_atr_ratio: config.active_atr_ratio,
      proximity_to_highs_pct: config.proximity_to_highs_pct,
      volume_threshold_forming: config.volume_threshold_forming,
      volume_threshold_near: config.volume_threshold_near,
      volume_threshold_active: config.volume_threshold_active,
    });

    if (state === 'none') {
      noneOutput.reason = ['State classification: none — thresholds not met'];
      return noneOutput;
    }

    // ---- Compute consolidation_high for entry (used by all states) ----
    const window = config.consolidation_window;
    let consolidationHigh = -Infinity;
    for (let i = barIndex - window + 1; i <= barIndex; i++) {
      if (i >= 0 && i < data.length && isValidBar(data[i])) {
        if (data[i].high > consolidationHigh) consolidationHigh = data[i].high;
      }
    }
    if (consolidationHigh === -Infinity) consolidationHigh = 0;

    // ---- Phase 5: Entry/Stop/Target for ACTIVE signals ----
    if (state === 'active') {
      const entryResult = shouldEnter(data, barIndex, config);

      if (entryResult === null) {
        // Risk exceeds max_risk_pct — downgrade to "near"
        return {
          ticker: '',
          strategy: 'volume_dry_up',
          signal: 'near',
          date,
          entry: consolidationHigh * 1.005,
          stop: 0,
          risk_pct: 0,
          confidence: 0.6,
          reason: [`Risk exceeds max ${config.max_risk_pct}% — downgraded from active`],
        };
      }

      // Valid active entry — apply candlestick confirmation
      let confidence = computeVduActiveConfidence(entryResult.risk_pct, config.max_risk_pct);
      let candlestickPatterns: string[] | undefined;
      let candlestickAdjustment: number | undefined;

      try {
        // Get last 3 bars for candlestick scoring
        const startIdx = Math.max(0, barIndex - 2);
        const bars = data.slice(startIdx, barIndex + 1).map(d => ({
          open: d.open,
          high: d.high,
          low: d.low,
          close: d.close,
        }));

        const scorerResult = scoreCandlesticks(bars, 'volume_dry_up');

        if (scorerResult.patterns.length > 0) {
          candlestickPatterns = scorerResult.patterns;
          candlestickAdjustment = scorerResult.adjustment;
          confidence = Math.min(1, Math.max(0, confidence * scorerResult.adjustment));
        }
      } catch {
        // Candlestick scorer error — retain original confidence, omit candlestick fields
      }

      const output: SignalOutput = {
        ticker: '',
        strategy: 'volume_dry_up',
        signal: 'active',
        date,
        entry: entryResult.entryPrice,
        stop: entryResult.stopPrice,
        risk_pct: entryResult.risk_pct,
        confidence,
        reason: [
          'VDU active — volume dry-up confirmed',
          `Entry: ${entryResult.entryPrice.toFixed(2)}`,
          `Stop: ${entryResult.stopPrice.toFixed(2)}`,
          `Target: ${entryResult.targetPrice.toFixed(2)}`,
          `Risk: ${entryResult.risk_pct.toFixed(2)}%`,
        ],
      };

      if (candlestickPatterns) {
        output.candlestickPatterns = candlestickPatterns;
      }
      if (candlestickAdjustment !== undefined) {
        output.candlestickAdjustment = candlestickAdjustment;
      }

      return output;
    }

    // ---- Near / Forming signals ----
    const entryLevel = consolidationHigh * 1.005;
    const confidenceMap: Record<string, number> = { near: 0.6, forming: 0.3 };

    return {
      ticker: '',
      strategy: 'volume_dry_up',
      signal: state,
      date,
      entry: entryLevel,
      stop: 0,
      risk_pct: 0,
      confidence: confidenceMap[state] ?? 0,
      reason: [
        `VDU ${state} — volume contracting`,
        `Volume ratio: ${volumeMetrics.volume_ratio.toFixed(3)}`,
        `Range: ${baseMetrics.range_pct.toFixed(2)}%`,
        `ATR ratio: ${baseMetrics.atr_ratio.toFixed(3)}`,
      ],
    };
  }
}

// ============================================================
// VduEngine Helpers
// ============================================================

/**
 * Build a VduConfig from a flat params record, falling back to defaults.
 */
function buildVduConfigFromParams(params: Record<string, number>): VduConfig {
  const consolidation_window = params.consolidation_window ?? DEFAULT_VDU_CONFIG.consolidation_window;
  const max_range_pct = params.max_range_pct ?? DEFAULT_VDU_CONFIG.max_range_pct;
  const atr_ratio_threshold = params.atr_ratio_threshold ?? DEFAULT_VDU_CONFIG.atr_ratio_threshold;

  return {
    consolidation_window,
    max_range_pct,
    atr_ratio_threshold,
    proximity_to_highs_pct: params.proximity_to_highs_pct ?? DEFAULT_VDU_CONFIG.proximity_to_highs_pct,
    volume_lookback: params.volume_lookback ?? DEFAULT_VDU_CONFIG.volume_lookback,
    volume_threshold_forming: params.volume_threshold_forming ?? DEFAULT_VDU_CONFIG.volume_threshold_forming,
    volume_threshold_near: params.volume_threshold_near ?? DEFAULT_VDU_CONFIG.volume_threshold_near,
    volume_threshold_active: params.volume_threshold_active ?? DEFAULT_VDU_CONFIG.volume_threshold_active,
    min_declining_days: params.min_declining_days ?? DEFAULT_VDU_CONFIG.min_declining_days,
    near_range_pct: params.near_range_pct ?? (max_range_pct - 1),
    near_atr_ratio: params.near_atr_ratio ?? (atr_ratio_threshold * 0.85),
    active_range_pct: params.active_range_pct ?? (max_range_pct - 2),
    active_atr_ratio: params.active_atr_ratio ?? (atr_ratio_threshold * 0.70),
    stopLoss: {
      atr_multiple: params.atr_multiple ?? DEFAULT_VDU_CONFIG.stopLoss.atr_multiple,
      swing_lookback: params.swing_lookback ?? DEFAULT_VDU_CONFIG.stopLoss.swing_lookback,
      buffer: params.buffer ?? DEFAULT_VDU_CONFIG.stopLoss.buffer,
    },
    r_multiple: params.r_multiple ?? DEFAULT_VDU_CONFIG.r_multiple,
    sma_period: params.sma_period ?? DEFAULT_VDU_CONFIG.sma_period,
    max_risk_pct: params.max_risk_pct ?? DEFAULT_VDU_CONFIG.max_risk_pct,
  };
}

/**
 * Compute confidence for an active VDU signal based on risk relative to max allowed.
 * Lower risk = higher confidence. Range: [0.6, 1.0]
 */
function computeVduActiveConfidence(riskPct: number, maxRiskPct: number): number {
  if (maxRiskPct <= 0) return 0.5;
  const ratio = Math.min(riskPct / maxRiskPct, 1);
  return 0.6 + (1 - ratio) * 0.4;
}



// ============================================================
// VduParams — For BacktestEngine.runV2() integration
// ============================================================

export interface VduParams {
  config: VduConfig;
  cache?: any; // IndicatorCache (optional)
}

// ============================================================
// VduBacktestEngine — V2CompatibleEngine Implementation
// ============================================================

/**
 * VDU engine compatible with BacktestEngine.runV2().
 *
 * Implements the bar-by-bar evaluateWithOHLCV interface:
 * - When no position: detect VDU ACTIVE signal → BUY
 * - When position open: check stop/target/trend_failsafe → SELL or HOLD
 *
 * Exit priority (same as CB engine):
 * 1. Stop-loss: bar.low <= stopLossPrice
 * 2. Profit target: bar.high >= profitTargetPrice
 * 3. Trend failsafe: close < SMA(sma_period)
 */
export class VduBacktestEngine implements V2CompatibleEngine {
  readonly type = 'volume_dry_up' as any;

  // Internal state
  private currentBarIndex = 0;
  private positionOpen = false;
  private entryPrice = 0;
  private stopLossPrice = 0;
  private profitTargetPrice = 0;
  private rValue = 0;

  reset(): void {
    this.currentBarIndex = 0;
    this.positionOpen = false;
    this.entryPrice = 0;
    this.stopLossPrice = 0;
    this.profitTargetPrice = 0;
    this.rValue = 0;
  }

  minimumDataPointsForParams(_params: VduParams): number {
    return 52; // Need 51 bars for direction phase + 1 for current bar
  }

  evaluateWithOHLCV(dataPoints: HistoricalDataPoint[], params: VduParams): V2Signal {
    const barIndex = this.currentBarIndex;
    this.currentBarIndex++;

    const ticker = '';
    const holdSignal: V2Signal = {
      id: `vdu-${barIndex}`,
      ticker,
      direction: 'HOLD' as SignalDirection,
      strategyType: this.type,
      price: 0,
      timestamp: '',
    };

    if (barIndex >= dataPoints.length) return holdSignal;

    const currentBar = dataPoints[barIndex];
    if (!currentBar || !isValidBar(currentBar)) return holdSignal;

    holdSignal.price = currentBar.close;
    holdSignal.timestamp = currentBar.date;

    const config = params.config;

    // ============================================================
    // POSITION OPEN — Check exits
    // ============================================================
    if (this.positionOpen) {
      // Priority 1: Stop-loss hit
      if (currentBar.low <= this.stopLossPrice) {
        this.positionOpen = false;
        const signal: V2Signal = {
          id: `vdu-sell-${barIndex}`,
          ticker,
          direction: 'SELL' as SignalDirection,
          strategyType: this.type,
          price: this.stopLossPrice,
          timestamp: currentBar.date,
          exitReason: 'stop_loss',
          stopLossPrice: this.stopLossPrice,
          profitTargetPrice: this.profitTargetPrice,
          rValue: this.rValue,
        };
        this.entryPrice = 0;
        this.stopLossPrice = 0;
        this.profitTargetPrice = 0;
        this.rValue = 0;
        return signal;
      }

      // Priority 2: Profit target hit
      if (currentBar.high >= this.profitTargetPrice) {
        this.positionOpen = false;
        const signal: V2Signal = {
          id: `vdu-sell-${barIndex}`,
          ticker,
          direction: 'SELL' as SignalDirection,
          strategyType: this.type,
          price: this.profitTargetPrice,
          timestamp: currentBar.date,
          exitReason: 'profit_target',
          stopLossPrice: this.stopLossPrice,
          profitTargetPrice: this.profitTargetPrice,
          rValue: this.rValue,
        };
        this.entryPrice = 0;
        this.stopLossPrice = 0;
        this.profitTargetPrice = 0;
        this.rValue = 0;
        return signal;
      }

      // Priority 3: Trend failsafe — close < SMA(sma_period)
      const closes = dataPoints.slice(0, barIndex + 1).map(d => d.close);
      const trendSma = sma(closes, config.sma_period);
      if (trendSma !== undefined && currentBar.close < trendSma) {
        this.positionOpen = false;
        const signal: V2Signal = {
          id: `vdu-sell-${barIndex}`,
          ticker,
          direction: 'SELL' as SignalDirection,
          strategyType: this.type,
          price: currentBar.close,
          timestamp: currentBar.date,
          exitReason: 'trend_failsafe',
          stopLossPrice: this.stopLossPrice,
          profitTargetPrice: this.profitTargetPrice,
          rValue: this.rValue,
        };
        this.entryPrice = 0;
        this.stopLossPrice = 0;
        this.profitTargetPrice = 0;
        this.rValue = 0;
        return signal;
      }

      // No exit — HOLD
      return holdSignal;
    }

    // ============================================================
    // NO POSITION — Check for VDU ACTIVE entry
    // ============================================================
    if (barIndex < 51) return holdSignal;

    // Phase 1: Direction
    if (!detectDirection(dataPoints, barIndex)) return holdSignal;

    // Phase 2: Base Formation
    const baseMetrics = detectBaseFormation(dataPoints, barIndex, {
      consolidation_window: config.consolidation_window,
      proximity_to_highs_pct: config.proximity_to_highs_pct,
      atr_ratio_threshold: config.atr_ratio_threshold,
    });
    if (baseMetrics.range_pct === 0 && baseMetrics.atr_ratio === 0) return holdSignal;

    // Phase 3: Volume Dry-Up
    const volumeMetrics = detectVolumeDryUp(
      dataPoints, barIndex,
      { volume_lookback: config.volume_lookback, min_declining_days: config.min_declining_days },
      config.volume_threshold_active
    );

    // Phase 4: State Classification
    const state = classifyState(baseMetrics, volumeMetrics, {
      max_range_pct: config.max_range_pct,
      near_range_pct: config.near_range_pct,
      active_range_pct: config.active_range_pct,
      atr_ratio_threshold: config.atr_ratio_threshold,
      near_atr_ratio: config.near_atr_ratio,
      active_atr_ratio: config.active_atr_ratio,
      proximity_to_highs_pct: config.proximity_to_highs_pct,
      volume_threshold_forming: config.volume_threshold_forming,
      volume_threshold_near: config.volume_threshold_near,
      volume_threshold_active: config.volume_threshold_active,
    });

    if (state !== 'active') return holdSignal;

    // Phase 5: Entry computation
    const entryResult = shouldEnter(dataPoints, barIndex, config);
    if (entryResult === null) return holdSignal;

    // Check if breakout actually happened on this bar (high >= entryPrice)
    if (currentBar.high < entryResult.entryPrice) return holdSignal;

    // Entry triggered — open position
    this.positionOpen = true;
    this.entryPrice = entryResult.entryPrice;
    this.stopLossPrice = entryResult.stopPrice;
    this.profitTargetPrice = entryResult.targetPrice;
    this.rValue = entryResult.entryPrice - entryResult.stopPrice;

    const buySignal: V2Signal = {
      id: `vdu-buy-${barIndex}`,
      ticker,
      direction: 'BUY' as SignalDirection,
      strategyType: this.type,
      price: entryResult.entryPrice,
      timestamp: currentBar.date,
      stopLossPrice: entryResult.stopPrice,
      profitTargetPrice: entryResult.targetPrice,
      rValue: this.rValue,
    };

    return buySignal;
  }
}
