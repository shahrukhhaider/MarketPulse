// ============================================================
// Breakout Context Awareness — Types and Analyzer
// ============================================================
// Provides context-aware signal classification for the
// consolidation breakout strategy. All logic is implemented
// as static pure functions on BreakoutContextAnalyzer.
//
// When context_awareness_enabled is absent or 0 in params,
// the existing four-state classification is used unchanged.
// ============================================================

import type { HistoricalDataPoint } from './types.js';
import type { SignalOutput } from './strategy-registry.js';
import type { ConsolidationBreakoutConfiguration } from './strategies/strategy-configs.js';
import { sma } from './indicators.js';
import { ConsolidationBreakoutEngine } from './strategies/consolidation-breakout-engine.js';

// ============================================================
// Type Definitions
// ============================================================

/** Per-bar NEAR classification result */
export interface BarNearClassification {
  barIndex: number;
  isNear: boolean;
}

/** Rolling window aggregation output */
export interface RollingWindowMetrics {
  near_count_5d: number;
  near_count_10d: number;
  bars_since_last_near: number | null;
}

/** All signal states including new context-aware states */
export type ContextSignalState =
  | 'none'
  | 'forming'
  | 'near'
  | 'active'
  | 'pressure'
  | 'active_late'
  | 'extended';

/** Input to the signal classifier */
export interface ContextClassificationInput {
  /** Whether shouldEnter() produced a valid entry on the current bar */
  hasActiveBreakout: boolean;
  /** Whether the current bar is classified as NEAR */
  isCurrentBarNear: boolean;
  /** Whether consolidation was detected in the staleness window */
  hasConsolidation: boolean;
  /** Rolling window metrics */
  nearCount10d: number;
  nearCount5d: number;
  /** Bars since most recent breakout, null if none */
  barsSinceBreakout: number | null;
  /** Distance from current price to breakout level as percentage */
  distanceToBreakoutPct: number | null;
  /** Whether price structure is valid */
  isStructureValid: boolean;
}

/** Full context analysis result */
export interface ContextAnalysisResult {
  signal: ContextSignalState;
  confidence: number;
  metrics: ContextMetrics;
  reason: string[];
}

/** Context metrics included in scan output */
export interface ContextMetrics {
  near_count_5d: number;
  near_count_10d: number;
  bars_since_breakout: number | null;
  distance_to_breakout_pct: number | null;
  breakout_level: number | null;
  structure_valid: boolean;
}

// ============================================================
// BreakoutContextAnalyzer — Static Pure Functions
// ============================================================

export class BreakoutContextAnalyzer {
  /**
   * Classify a single bar as NEAR or not.
   *
   * NEAR = close is within [breakoutLevel * (1 - nearThresholdPct), breakoutLevel)
   *        AND structure is valid.
   *
   * Default nearThresholdPct = 0.02 (2%).
   * Minimum proximity = 1% below breakout level — bars closer than 1% below
   * are also NEAR (they fall within the range).
   *
   * Returns false when:
   * - structure is invalid (regardless of price proximity)
   * - close is at or above breakoutLevel (that's a breakout, not NEAR)
   * - close is more than nearThresholdPct below breakoutLevel
   * - breakoutLevel is 0 or negative (no valid level)
   */
  static classifyBarNear(
    barClose: number,
    breakoutLevel: number,
    isStructureValid: boolean,
    nearThresholdPct: number = 0.02
  ): boolean {
    // Structure must be valid for any NEAR classification
    if (!isStructureValid) {
      return false;
    }

    // Guard against invalid breakout levels
    if (breakoutLevel <= 0) {
      return false;
    }

    // Close at or above breakout level is a breakout, not NEAR
    if (barClose >= breakoutLevel) {
      return false;
    }

    // Compute the lower bound of the NEAR zone
    const lowerBound = breakoutLevel * (1 - nearThresholdPct);

    // NEAR when close is within [lowerBound, breakoutLevel)
    return barClose >= lowerBound;
  }

  /**
   * Validate price structure.
   *
   * Valid when:
   * 1. Current bar's close > SMA(50)
   * 2. No bar in the rolling window has closed below consolidationLow
   *
   * Uses the `sma` function from `./indicators.js` for SMA(50) computation.
   * Default rollingWindowSize = 10.
   *
   * Returns false when:
   * - close is at or below SMA(50)
   * - any bar in the rolling window closed below consolidationLow
   * - insufficient data for SMA(50) computation
   * - barIndex is out of bounds
   */
  static validateStructure(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    consolidationLow: number,
    rollingWindowSize: number = 10
  ): boolean {
    // Guard: barIndex must be valid
    if (barIndex < 0 || barIndex >= dataPoints.length) {
      return false;
    }

    // Extract closing prices up to and including barIndex
    const closingPrices = dataPoints.slice(0, barIndex + 1).map(dp => dp.close);

    // Compute SMA(50) — requires at least 50 prices
    const sma50 = sma(closingPrices, 50);
    if (sma50 === undefined) {
      return false;
    }

    const currentClose = dataPoints[barIndex].close;

    // Condition 1: current bar's close must be strictly above SMA(50)
    if (currentClose <= sma50) {
      return false;
    }

    // Condition 2: no bar in the rolling window has closed below consolidationLow
    const windowStart = Math.max(0, barIndex - rollingWindowSize + 1);
    for (let i = windowStart; i <= barIndex; i++) {
      if (dataPoints[i].close < consolidationLow) {
        return false;
      }
    }

    return true;
  }

  /**
   * Compute rolling window aggregation metrics from an array of per-bar NEAR flags.
   *
   * nearFlags[i] = true means bar i was classified as NEAR.
   *
   * Returns:
   * - near_count_5d: count of true values in the last 5 entries (or all if fewer than 5)
   * - near_count_10d: count of true values in the last 10 entries (or all if fewer than 10)
   * - bars_since_last_near: distance from end to most recent true, or null if none exist
   */
  static computeRollingMetrics(nearFlags: boolean[]): RollingWindowMetrics {
    const len = nearFlags.length;

    // Count true values in the last N entries (or all available if fewer)
    const countTrueInLastN = (n: number): number => {
      const start = Math.max(0, len - n);
      let count = 0;
      for (let i = start; i < len; i++) {
        if (nearFlags[i]) {
          count++;
        }
      }
      return count;
    };

    const near_count_5d = countTrueInLastN(5);
    const near_count_10d = countTrueInLastN(10);

    // Find bars_since_last_near: scan backward from end
    let bars_since_last_near: number | null = null;
    for (let i = len - 1; i >= 0; i--) {
      if (nearFlags[i]) {
        bars_since_last_near = len - 1 - i;
        break;
      }
    }

    return {
      near_count_5d,
      near_count_10d,
      bars_since_last_near,
    };
  }

  /**
   * Detect a breakout event on the current bar.
   *
   * A breakout occurs when the current bar's close > breakoutLevel
   * AND the previous bar's close was <= breakoutLevel.
   *
   * Returns false when:
   * - barIndex is 0 (no previous bar to compare against)
   * - barIndex is out of bounds
   * - current bar's close is at or below breakoutLevel
   * - previous bar's close was already above breakoutLevel (not a fresh crossover)
   */
  static detectBreakoutEvent(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    breakoutLevel: number
  ): boolean {
    // No previous bar to compare against
    if (barIndex <= 0) {
      return false;
    }

    // Guard: barIndex must be within bounds
    if (barIndex >= dataPoints.length) {
      return false;
    }

    const currentClose = dataPoints[barIndex].close;
    const previousClose = dataPoints[barIndex - 1].close;

    // Breakout = current bar crosses above breakoutLevel
    return currentClose > breakoutLevel && previousClose <= breakoutLevel;
  }

  /**
   * Compute bars_since_breakout by scanning backward from barIndex.
   *
   * Finds the most recent bar where close crossed above breakoutLevel
   * (i.e., bar's close > breakoutLevel AND previous bar's close <= breakoutLevel).
   *
   * Returns the number of bars elapsed since that breakout event,
   * or null if no breakout found within maxLookback bars.
   *
   * Default maxLookback = 20.
   */
  static computeBarsSinceBreakout(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    breakoutLevel: number,
    maxLookback: number = 20
  ): number | null {
    // Guard: barIndex must be within bounds
    if (barIndex < 0 || barIndex >= dataPoints.length) {
      return null;
    }

    // Scan backward from barIndex looking for a breakout event
    const earliestIndex = Math.max(1, barIndex - maxLookback + 1);
    for (let i = barIndex; i >= earliestIndex; i--) {
      if (BreakoutContextAnalyzer.detectBreakoutEvent(dataPoints, i, breakoutLevel)) {
        return barIndex - i;
      }
    }

    return null;
  }

  /**
   * Compute distance_to_breakout_pct.
   *
   * Formula: ((currentPrice - breakoutLevel) / breakoutLevel) * 100
   *
   * Returns null when breakoutLevel is null or 0.
   * Returns negative values when price is below breakout level.
   */
  static computeDistanceToBreakout(
    currentPrice: number,
    breakoutLevel: number | null
  ): number | null {
    // Null or zero breakout level — cannot compute distance
    if (breakoutLevel === null || breakoutLevel === 0) {
      return null;
    }

    return ((currentPrice - breakoutLevel) / breakoutLevel) * 100;
  }

  /**
   * Classify the signal state using strict priority order.
   *
   * Priority: ACTIVE > ACTIVE_LATE > EXTENDED > PRESSURE > NEAR > FORMING > NONE
   *
   * Each condition is evaluated in order; the first match wins.
   *
   * - ACTIVE: hasActiveBreakout is true
   * - ACTIVE_LATE: barsSinceBreakout in [1, 5] AND nearCount10d >= 2 AND distanceToBreakoutPct <= 3
   * - EXTENDED: barsSinceBreakout is not null AND distanceToBreakoutPct > 3
   * - PRESSURE: nearCount10d >= 3 AND isStructureValid is true
   * - NEAR: isCurrentBarNear is true
   * - FORMING: hasConsolidation is true
   * - NONE: default fallback
   */
  static classifySignal(context: ContextClassificationInput): ContextSignalState {
    // Priority 0: ACTIVE — fresh breakout on the current bar
    if (context.hasActiveBreakout) {
      return 'active';
    }

    // Priority 1: ACTIVE_LATE — recent breakout, still actionable
    if (
      context.barsSinceBreakout !== null &&
      context.barsSinceBreakout >= 1 &&
      context.barsSinceBreakout <= 5 &&
      context.nearCount10d >= 2 &&
      context.distanceToBreakoutPct !== null &&
      context.distanceToBreakoutPct <= 3
    ) {
      return 'active_late';
    }

    // Priority 2: EXTENDED — overextended above breakout level
    if (
      context.barsSinceBreakout !== null &&
      context.distanceToBreakoutPct !== null &&
      context.distanceToBreakoutPct > 3
    ) {
      return 'extended';
    }

    // Priority 3: PRESSURE — multi-day buildup with valid structure
    if (context.nearCount10d >= 3 && context.isStructureValid) {
      return 'pressure';
    }

    // Priority 4: NEAR — current bar is near breakout level
    if (context.isCurrentBarNear) {
      return 'near';
    }

    // Priority 5: FORMING — consolidation detected
    if (context.hasConsolidation) {
      return 'forming';
    }

    // Priority 6: NONE — default fallback
    return 'none';
  }

  /**
   * Compute confidence score with pressure bonus and extension penalty.
   *
   * 1. pressure_score = min(1, nearCount10d / 5)
   * 2. confidence = baseConfidence + 0.2 * pressure_score - penalty_if_extended
   * 3. When signal is EXTENDED, penalty = 0.1 * (distanceToBreakoutPct - 3) / 3,
   *    capped at 0.3. The penalty is zero when distance is null or <= 3%.
   * 4. Result is clamped to [0, 1].
   */
  static computeConfidence(
    baseConfidence: number,
    nearCount10d: number,
    signalState: ContextSignalState,
    distanceToBreakoutPct: number | null
  ): number {
    // Step 1: Compute pressure score — how much multi-day buildup exists
    const pressureScore = Math.min(1, nearCount10d / 5);

    // Step 2: Compute extension penalty (only applies to EXTENDED signals)
    let penalty = 0;
    if (signalState === 'extended' && distanceToBreakoutPct !== null && distanceToBreakoutPct > 3) {
      penalty = Math.min(0.3, 0.1 * (distanceToBreakoutPct - 3) / 3);
    }

    // Step 3: Combine base + pressure bonus - penalty
    const raw = baseConfidence + 0.2 * pressureScore - penalty;

    // Step 4: Clamp to [0, 1]
    return Math.max(0, Math.min(1, raw));
  }

  /**
   * Full context analysis pipeline — orchestrates all sub-functions.
   *
   * This is the main entry point called from signal-detector.ts.
   *
   * Pipeline:
   * 1. Detect consolidation within staleness window
   * 2. Get breakout level (consolidation high)
   * 3. Check if shouldEnter() produces a valid active entry
   * 4. Validate structure for each bar in the rolling window
   * 5. Classify per-bar NEAR over the rolling window
   * 6. Handle structure validity reset (when structure transitions to invalid, reset near counts)
   * 7. Compute rolling metrics
   * 8. Compute bars since breakout
   * 9. Compute distance to breakout
   * 10. Classify signal
   * 11. Compute confidence
   * 12. Return ContextAnalysisResult
   */
  static analyze(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    config: ConsolidationBreakoutConfiguration,
    baseSignalOutput: SignalOutput
  ): ContextAnalysisResult {
    const reason: string[] = [];
    const rollingWindowSize = 10;

    // ---- Step 1: Detect consolidation within staleness window ----
    let consolidation: {
      detected: boolean;
      consolidationHigh: number;
      consolidationLow: number;
      consolidationBar: number;
    } | null = null;

    const maxStaleness = config.consolidation.max_staleness;
    for (let i = barIndex; i >= Math.max(barIndex - maxStaleness, 0); i--) {
      const result = ConsolidationBreakoutEngine.detectConsolidation(dataPoints, i, {
        consolidation_window: config.consolidation.consolidation_window,
        max_range_pct: config.consolidation.max_range_pct,
        atr_ratio_threshold: config.consolidation.atr_ratio_threshold,
        sma_proximity_pct: config.consolidation.sma_proximity_pct,
      });
      if (result.detected) {
        consolidation = result;
        break;
      }
    }

    const hasConsolidation = consolidation !== null;
    const breakoutLevel = consolidation ? consolidation.consolidationHigh : null;
    const consolidationLow = consolidation ? consolidation.consolidationLow : 0;

    if (hasConsolidation) {
      reason.push(`Consolidation detected at bar ${consolidation!.consolidationBar}`);
      reason.push(`Breakout level: ${breakoutLevel!.toFixed(2)}`);
    } else {
      reason.push('No consolidation detected in staleness window');
    }

    // ---- Step 2: Check if shouldEnter() produces a valid active entry ----
    const entryResult = ConsolidationBreakoutEngine.shouldEnter(dataPoints, barIndex, config);
    let hasActiveBreakout = false;
    if (entryResult) {
      const riskPct =
        (entryResult.entryPrice - entryResult.stopLossPrice) / entryResult.entryPrice * 100;
      if (riskPct <= config.maxRisk.max_risk_pct) {
        hasActiveBreakout = true;
        reason.push('Full breakout entry confirmed');
      }
    }

    // ---- Step 3: Validate structure for the current bar ----
    const isStructureValid = hasConsolidation
      ? BreakoutContextAnalyzer.validateStructure(
          dataPoints,
          barIndex,
          consolidationLow,
          rollingWindowSize
        )
      : false;

    if (isStructureValid) {
      reason.push('Structure valid: close > SMA(50), no close below consolidation low');
    } else if (hasConsolidation) {
      reason.push('Structure invalid');
    }

    // ---- Step 4: Classify per-bar NEAR over the rolling window ----
    // Build near flags for bars in the rolling window ending at barIndex.
    // For each bar, we validate structure at that bar and classify NEAR.
    const nearFlags: boolean[] = [];
    const windowStart = Math.max(0, barIndex - rollingWindowSize + 1);

    // Track structure validity across the window to detect transitions
    let prevStructureValid = true; // assume valid before window starts
    let structureResetOccurred = false;

    for (let i = windowStart; i <= barIndex; i++) {
      const barStructureValid = hasConsolidation
        ? BreakoutContextAnalyzer.validateStructure(
            dataPoints,
            i,
            consolidationLow,
            rollingWindowSize
          )
        : false;

      // Detect structure validity transition: valid → invalid
      if (prevStructureValid && !barStructureValid) {
        structureResetOccurred = true;
      }
      prevStructureValid = barStructureValid;

      const isNear =
        breakoutLevel !== null
          ? BreakoutContextAnalyzer.classifyBarNear(
              dataPoints[i].close,
              breakoutLevel,
              barStructureValid
            )
          : false;

      nearFlags.push(isNear);
    }

    // ---- Step 5: Handle structure validity reset ----
    // When structure transitions to invalid, reset near counts to zero (Req 5.4)
    let rollingMetrics: RollingWindowMetrics;
    if (structureResetOccurred) {
      // Find the index within nearFlags where the last reset occurred
      // and zero out all flags before and at that point
      let lastResetIdx = -1;
      let prevValid = true;
      for (let i = 0; i < nearFlags.length; i++) {
        const absIdx = windowStart + i;
        const barValid = hasConsolidation
          ? BreakoutContextAnalyzer.validateStructure(
              dataPoints,
              absIdx,
              consolidationLow,
              rollingWindowSize
            )
          : false;
        if (prevValid && !barValid) {
          lastResetIdx = i;
        }
        prevValid = barValid;
      }

      // Zero out all near flags up to and including the reset point
      if (lastResetIdx >= 0) {
        for (let i = 0; i <= lastResetIdx; i++) {
          nearFlags[i] = false;
        }
      }

      rollingMetrics = BreakoutContextAnalyzer.computeRollingMetrics(nearFlags);
      reason.push('Structure validity reset: near counts zeroed');
    } else {
      rollingMetrics = BreakoutContextAnalyzer.computeRollingMetrics(nearFlags);
    }

    // ---- Step 6: Compute bars since breakout ----
    const barsSinceBreakout =
      breakoutLevel !== null
        ? BreakoutContextAnalyzer.computeBarsSinceBreakout(
            dataPoints,
            barIndex,
            breakoutLevel
          )
        : null;

    if (barsSinceBreakout !== null) {
      reason.push(`Bars since breakout: ${barsSinceBreakout}`);
    }

    // ---- Step 7: Compute distance to breakout ----
    const currentPrice = dataPoints[barIndex].close;
    const distanceToBreakoutPct = BreakoutContextAnalyzer.computeDistanceToBreakout(
      currentPrice,
      breakoutLevel
    );

    if (distanceToBreakoutPct !== null) {
      reason.push(`Distance to breakout: ${distanceToBreakoutPct.toFixed(2)}%`);
    }

    // ---- Step 8: Classify the current bar as NEAR ----
    const isCurrentBarNear =
      breakoutLevel !== null
        ? BreakoutContextAnalyzer.classifyBarNear(
            currentPrice,
            breakoutLevel,
            isStructureValid
          )
        : false;

    // ---- Step 9: Classify signal ----
    const classificationInput: ContextClassificationInput = {
      hasActiveBreakout,
      isCurrentBarNear,
      hasConsolidation,
      nearCount10d: rollingMetrics.near_count_10d,
      nearCount5d: rollingMetrics.near_count_5d,
      barsSinceBreakout,
      distanceToBreakoutPct,
      isStructureValid,
    };

    const signal = BreakoutContextAnalyzer.classifySignal(classificationInput);
    reason.push(`Signal classified as: ${signal}`);

    // ---- Step 10: Compute confidence ----
    const confidence = BreakoutContextAnalyzer.computeConfidence(
      baseSignalOutput.confidence,
      rollingMetrics.near_count_10d,
      signal,
      distanceToBreakoutPct
    );

    // ---- Step 11: Build metrics ----
    const metrics: ContextMetrics = {
      near_count_5d: rollingMetrics.near_count_5d,
      near_count_10d: rollingMetrics.near_count_10d,
      bars_since_breakout: barsSinceBreakout,
      distance_to_breakout_pct: distanceToBreakoutPct,
      breakout_level: breakoutLevel,
      structure_valid: isStructureValid,
    };

    return {
      signal,
      confidence,
      metrics,
      reason,
    };
  }
}
