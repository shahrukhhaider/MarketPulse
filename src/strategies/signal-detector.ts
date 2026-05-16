import type { HistoricalDataPoint } from '../types.js';
import type { SignalOutput } from './strategy-registry.js';
import type { ConsolidationBreakoutConfiguration, TrendPullbackConfiguration, BearBreakdownConfiguration, PostEarningsDriftConfiguration } from './strategy-configs.js';
import { DEFAULT_PEAD_CONFIG, mergePeadConfig } from './strategy-configs.js';
import { ConsolidationBreakoutEngine } from './consolidation-breakout-engine.js';
import { TrendPullbackEngine } from './trend-pullback-engine.js';
import { BearBreakdownEngine } from './bear-breakdown-engine.js';
import { PostEarningsDriftEngine } from './post-earnings-drift-engine.js';
import type { ConsolidationResult } from './post-earnings-drift-engine.js';
import { buildConsolidationBreakoutConfig, buildTrendPullbackGridConfig, buildBearBreakdownConfig } from './parameter-grid.js';
import { BreakoutContextAnalyzer } from '../indicators/breakout-context.js';
import type { MarketRegime } from '../indicators/regime-detector.js';
import { atr as computeAtr } from '../indicators/indicators.js';
import { computePeadConfidenceScore } from '../indicators/confidence-score.js';

// ============================================================
// Signal State Type
// ============================================================

export type SignalState = 'none' | 'forming' | 'near' | 'active';

// ============================================================
// Public API
// ============================================================

/**
 * Classify the current market state for a ticker using pre-tuned parameters.
 *
 * Classification logic (consolidation_breakout):
 *   active  — shouldEnter() returns a valid entry AND risk <= max_risk_pct
 *   near    — consolidation detected AND price within 1% of consolidation high
 *   forming — consolidation detected AND price NOT near breakout level
 *   none    — no consolidation detected in staleness window
 *
 * This function NEVER calls tuning, grid search, or parameter optimization.
 */
/**
 * Additional options for strategies that require auxiliary data beyond flat params.
 */
export interface DetectSignalOptions {
  earningsDates?: string[];
  marketRegime?: MarketRegime;
}

export function detectSignal(
  data: HistoricalDataPoint[],
  params: Record<string, number>,
  strategy: string,
  options?: DetectSignalOptions
): SignalOutput {
  if (strategy === 'consolidation_breakout') {
    return detectConsolidationBreakoutSignal(data, params);
  }

  if (strategy === 'trend_pullback') {
    return detectTrendPullbackSignal(data, params);
  }

  if (strategy === 'bear_breakdown') {
    return detectBearBreakdownSignal(data, params);
  }

  if (strategy === 'post_earnings_drift') {
    return detectPostEarningsDriftSignal(data, params, options);
  }

  // Unknown strategy — return none
  const date = data.length > 0 ? data[data.length - 1].date : new Date().toISOString().slice(0, 10);
  return {
    ticker: '',
    strategy,
    signal: 'none',
    date,
    entry: 0,
    stop: 0,
    risk_pct: 0,
    confidence: 0,
    reason: [`Unknown strategy: ${strategy}`],
  };
}

// ============================================================
// Consolidation Breakout Signal Detection
// ============================================================

/**
 * Internal: detect signal for consolidation_breakout strategy.
 *
 * When `context_awareness_enabled === 1` in params, the context-aware
 * classification pipeline is used (seven-state: none, forming, near,
 * active, pressure, active_late, extended).
 *
 * When `context_awareness_enabled` is absent or 0, the existing
 * four-state classification (none, forming, near, active) is used
 * unchanged for backward compatibility.
 */
function detectConsolidationBreakoutSignal(
  data: HistoricalDataPoint[],
  params: Record<string, number>
): SignalOutput {
  const config: ConsolidationBreakoutConfiguration = buildConsolidationBreakoutConfig(params);
  const barIndex = data.length - 1;
  const date = data.length > 0 ? data[barIndex].date : new Date().toISOString().slice(0, 10);

  const noneOutput: SignalOutput = {
    ticker: '',
    strategy: 'consolidation_breakout',
    signal: 'none',
    date,
    entry: 0,
    stop: 0,
    risk_pct: 0,
    confidence: 0,
    reason: [],
  };

  // Need minimum data for the engine
  if (data.length < 51) {
    noneOutput.reason = ['Insufficient data for signal detection'];
    return noneOutput;
  }

  // Run the existing four-state classification to get the base signal output
  const baseSignalOutput = detectBaseSignal(data, barIndex, date, config, noneOutput);

  // When context awareness is enabled, enhance with context-aware classification
  if (params['context_awareness_enabled'] === 1) {
    const contextResult = BreakoutContextAnalyzer.analyze(data, barIndex, config, baseSignalOutput);

    return {
      ticker: '',
      strategy: 'consolidation_breakout',
      signal: contextResult.signal,
      date,
      entry: baseSignalOutput.entry,
      stop: baseSignalOutput.stop,
      risk_pct: baseSignalOutput.risk_pct,
      confidence: contextResult.confidence,
      reason: contextResult.reason,
      contextMetrics: contextResult.metrics,
    };
  }

  // When disabled or absent: use existing four-state logic unchanged
  return baseSignalOutput;
}

/**
 * Internal: existing four-state classification logic (none, forming, near, active).
 * Extracted to allow the context-aware path to reuse the base signal output.
 */
function detectBaseSignal(
  data: HistoricalDataPoint[],
  barIndex: number,
  date: string,
  config: ConsolidationBreakoutConfiguration,
  noneOutput: SignalOutput
): SignalOutput {
  // ---- Step 1: Check if shouldEnter() produces a full entry ----
  const entryResult = ConsolidationBreakoutEngine.shouldEnter(data, barIndex, config);

  if (entryResult) {
    const riskPct = (entryResult.entryPrice - entryResult.stopLossPrice) / entryResult.entryPrice * 100;

    if (riskPct <= config.maxRisk.max_risk_pct) {
      return {
        ticker: '',
        strategy: 'consolidation_breakout',
        signal: 'active',
        date,
        entry: entryResult.entryPrice,
        stop: entryResult.stopLossPrice,
        risk_pct: riskPct,
        confidence: computeActiveConfidence(riskPct, config.maxRisk.max_risk_pct),
        reason: [
          'Full breakout entry confirmed',
          `Entry: ${entryResult.entryPrice.toFixed(2)}`,
          `Stop: ${entryResult.stopLossPrice.toFixed(2)}`,
          `Risk: ${riskPct.toFixed(2)}%`,
        ],
      };
    }
    // shouldEnter passed but risk too high — fall through to check near/forming
  }

  // ---- Step 2: Scan for consolidation within staleness window ----
  const maxStaleness = config.consolidation.max_staleness;
  let consolidation: { detected: boolean; consolidationHigh: number; consolidationLow: number; consolidationBar: number } | null = null;

  for (let i = barIndex; i >= Math.max(barIndex - maxStaleness, 0); i--) {
    const result = ConsolidationBreakoutEngine.detectConsolidation(data, i, {
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

  if (!consolidation) {
    noneOutput.reason = ['No consolidation detected in staleness window'];
    return noneOutput;
  }

  // ---- Step 3: Classify as near or forming ----
  const currentClose = data[barIndex].close;
  const consolidationHigh = consolidation.consolidationHigh;
  const proximityPct = consolidationHigh > 0
    ? Math.abs(currentClose - consolidationHigh) / consolidationHigh
    : Infinity;

  if (proximityPct <= 0.01) {
    // Near: price within 1% of consolidation high
    return {
      ticker: '',
      strategy: 'consolidation_breakout',
      signal: 'near',
      date,
      entry: consolidationHigh,
      stop: 0,
      risk_pct: 0,
      confidence: 0.5 + (1 - proximityPct / 0.01) * 0.3,
      reason: [
        'Consolidation detected, price near breakout level',
        `Consolidation high: ${consolidationHigh.toFixed(2)}`,
        `Current price: ${currentClose.toFixed(2)}`,
        `Proximity: ${(proximityPct * 100).toFixed(2)}%`,
      ],
    };
  }

  // Forming: consolidation detected but price not near breakout
  return {
    ticker: '',
    strategy: 'consolidation_breakout',
    signal: 'forming',
    date,
    entry: consolidationHigh,
    stop: 0,
    risk_pct: 0,
    confidence: 0.2 + Math.max(0, 0.3 - proximityPct) * 0.5,
    reason: [
      'Consolidation detected, price not yet near breakout',
      `Consolidation high: ${consolidationHigh.toFixed(2)}`,
      `Current price: ${currentClose.toFixed(2)}`,
      `Distance from breakout: ${(proximityPct * 100).toFixed(2)}%`,
    ],
  };
}

// ============================================================
// Helpers
// ============================================================

/**
 * Compute confidence for an active signal based on risk relative to max allowed.
 * Lower risk = higher confidence.
 */
function computeActiveConfidence(riskPct: number, maxRiskPct: number): number {
  if (maxRiskPct <= 0) return 0.5;
  // Scale from 0.6 (at max risk) to 1.0 (at zero risk)
  const ratio = Math.min(riskPct / maxRiskPct, 1);
  return 0.6 + (1 - ratio) * 0.4;
}

// ============================================================
// Trend Pullback Signal Detection
// ============================================================

/**
 * Classify the current market state for trend pullback strategy.
 *
 * Classification logic:
 *   active  — shouldEnter() returns a valid entry on the current bar
 *   near    — direction confirmed AND pullback detected (waiting for trigger)
 *   forming — direction confirmed but no pullback yet (uptrend, watching for dip)
 *   none    — direction phase fails (no uptrend)
 */
function detectTrendPullbackSignal(
  data: HistoricalDataPoint[],
  params: Record<string, number>
): SignalOutput {
  const config: TrendPullbackConfiguration = buildTrendPullbackGridConfig(params);
  const barIndex = data.length - 1;
  const date = data.length > 0 ? data[barIndex].date : new Date().toISOString().slice(0, 10);

  const noneOutput: SignalOutput = {
    ticker: '',
    strategy: 'trend_pullback',
    signal: 'none',
    date,
    entry: 0,
    stop: 0,
    risk_pct: 0,
    confidence: 0,
    reason: [],
  };

  if (data.length < 51) {
    noneOutput.reason = ['Insufficient data for signal detection'];
    return noneOutput;
  }

  // Step 1: Check full entry (active signal)
  const entryResult = TrendPullbackEngine.shouldEnter(data, barIndex, config);

  if (entryResult) {
    const riskPct = (entryResult.entryPrice - entryResult.stopLossPrice) / entryResult.entryPrice * 100;
    return {
      ticker: '',
      strategy: 'trend_pullback',
      signal: 'active',
      date,
      entry: entryResult.entryPrice,
      stop: entryResult.stopLossPrice,
      risk_pct: riskPct,
      confidence: computeActiveConfidence(riskPct, 8), // 8% max risk threshold
      reason: [
        'Trend pullback entry confirmed',
        `Entry: ${entryResult.entryPrice.toFixed(2)}`,
        `Stop: ${entryResult.stopLossPrice.toFixed(2)}`,
        `Target: ${entryResult.profitTargetPrice.toFixed(2)}`,
        `Risk: ${riskPct.toFixed(2)}%`,
        `R:R = 1:${config.profitTarget.r_multiple}`,
      ],
    };
  }

  // Step 2: Check direction phase
  const directionOk = TrendPullbackEngine.detectDirection(data, barIndex, config.direction);

  if (!directionOk) {
    // Check if price is close to SMA(50) — could be forming soon
    const closes = data.slice(0, barIndex + 1).map(d => d.close);
    const sma50 = closes.length >= 50 ? closes.slice(-50).reduce((a, b) => a + b, 0) / 50 : undefined;
    if (sma50 !== undefined) {
      const currentClose = data[barIndex].close;
      const distPct = ((currentClose - sma50) / sma50) * 100;
      if (distPct > -3 && distPct < 0) {
        noneOutput.reason = [
          'No uptrend — price below SMA(50)',
          `Price: ${currentClose.toFixed(2)}, SMA(50): ${sma50.toFixed(2)}`,
          `Distance: ${distPct.toFixed(1)}% (approaching from below)`,
        ];
      } else {
        noneOutput.reason = [
          'No uptrend — price below SMA(50)',
          `Price: ${currentClose.toFixed(2)}, SMA(50): ${sma50.toFixed(2)}`,
          `Distance: ${distPct.toFixed(1)}%`,
        ];
      }
    } else {
      noneOutput.reason = ['No uptrend — insufficient data for SMA(50)'];
    }
    return noneOutput;
  }

  // Step 3: Direction confirmed — check for pullback
  const pullbackResult = TrendPullbackEngine.detectPullback(data, barIndex, config.pullback);

  if (pullbackResult.detected) {
    // Pullback detected — near signal (waiting for trigger/volume expansion)
    const currentClose = data[barIndex].close;
    const closes20 = data.slice(0, barIndex + 1).map(d => d.close);
    const sma20Val = closes20.length >= 20 ? closes20.slice(-20).reduce((a, b) => a + b, 0) / 20 : undefined;
    return {
      ticker: '',
      strategy: 'trend_pullback',
      signal: 'near',
      date,
      entry: currentClose,
      stop: pullbackResult.swingLow,
      risk_pct: pullbackResult.swingLow > 0 ? (currentClose - pullbackResult.swingLow) / currentClose * 100 : 0,
      confidence: 0.6,
      reason: [
        'Uptrend confirmed, pullback detected — waiting for trigger',
        `Price near SMA(20): ${sma20Val?.toFixed(2) ?? 'N/A'}`,
        `Swing low: ${pullbackResult.swingLow.toFixed(2)}`,
        'Need: close > SMA(10) with volume expansion',
      ],
    };
  }

  // Step 4: Direction confirmed, no pullback — forming (watching for dip to SMA20)
  const currentClose = data[barIndex].close;
  const allCloses = data.slice(0, barIndex + 1).map(d => d.close);
  const sma20 = allCloses.length >= 20 ? allCloses.slice(-20).reduce((a, b) => a + b, 0) / 20 : undefined;
  const sma50 = allCloses.length >= 50 ? allCloses.slice(-50).reduce((a, b) => a + b, 0) / 50 : undefined;
  return {
    ticker: '',
    strategy: 'trend_pullback',
    signal: 'forming',
    date,
    entry: 0,
    stop: 0,
    risk_pct: 0,
    confidence: 0.3,
    reason: [
      'Uptrend confirmed — watching for pullback to SMA(20)',
      `Price: ${currentClose.toFixed(2)}`,
      `SMA(20): ${sma20?.toFixed(2) ?? 'N/A'}`,
      `SMA(50): ${sma50?.toFixed(2) ?? 'N/A'}`,
      `Distance to SMA(20): ${sma20 ? ((currentClose - sma20) / sma20 * 100).toFixed(1) : 'N/A'}%`,
    ],
  };
}

// ============================================================
// Bear Breakdown Signal Detection
// ============================================================

/**
 * Bear breakdown signal classification (four-state):
 *
 *   active  — shouldEnter() returns valid entry AND risk <= max_risk_pct
 *   near    — consolidation detected below SMA(50) AND price within 1% of consolidation low
 *   forming — consolidation detected below SMA(50) AND price > 1% above consolidation low
 *   none    — no consolidation detected below SMA(50) in staleness window
 *
 * Note: "within 1% of consolidation low" means price is at most 1% ABOVE the low
 * (approaching breakdown from above).
 */
function detectBearBreakdownSignal(
  data: HistoricalDataPoint[],
  params: Record<string, number>
): SignalOutput {
  const config: BearBreakdownConfiguration = buildBearBreakdownConfig(params);
  const barIndex = data.length - 1;
  const date = data.length > 0 ? data[barIndex].date : new Date().toISOString().slice(0, 10);

  const noneOutput: SignalOutput = {
    ticker: '',
    strategy: 'bear_breakdown',
    signal: 'none',
    date,
    entry: 0,
    stop: 0,
    risk_pct: 0,
    confidence: 0,
    reason: [],
  };

  // Need minimum data for the engine (SMA(50) requires 50 bars + current = 51)
  if (data.length < 51) {
    noneOutput.reason = ['Insufficient data for signal detection'];
    return noneOutput;
  }

  // ---- Step 1: Check if shouldEnter() produces a full entry (active signal) ----
  const entryResult = BearBreakdownEngine.shouldEnter(data, barIndex, config);

  if (entryResult) {
    const riskPct = (entryResult.stopLossPrice - entryResult.entryPrice) / entryResult.entryPrice * 100;

    if (riskPct <= config.maxRisk.max_risk_pct) {
      return {
        ticker: '',
        strategy: 'bear_breakdown',
        signal: 'active',
        date,
        entry: entryResult.entryPrice,
        stop: entryResult.stopLossPrice,
        risk_pct: riskPct,
        confidence: computeActiveConfidence(riskPct, config.maxRisk.max_risk_pct),
        reason: [
          'Bear breakdown entry confirmed',
          `Entry: ${entryResult.entryPrice.toFixed(2)}`,
          `Stop: ${entryResult.stopLossPrice.toFixed(2)}`,
          `Target: ${entryResult.profitTargetPrice.toFixed(2)}`,
          `Risk: ${riskPct.toFixed(2)}%`,
          `R:R = 1:${config.profitTarget.r_multiple}`,
        ],
      };
    }
    // shouldEnter passed but risk too high — fall through to check near/forming
  }

  // ---- Step 2: Scan for consolidation within staleness window ----
  const maxStaleness = config.consolidation.max_staleness;
  let consolidation: { detected: boolean; consolidationHigh: number; consolidationLow: number; consolidationBar: number } | null = null;

  for (let i = barIndex; i >= Math.max(barIndex - maxStaleness, 0); i--) {
    const result = BearBreakdownEngine.detectConsolidation(data, i, {
      consolidation_window: config.consolidation.consolidation_window,
      max_range_pct: config.consolidation.max_range_pct,
      atr_ratio_threshold: config.consolidation.atr_ratio_threshold,
    });

    if (result.detected) {
      consolidation = result;
      break;
    }
  }

  if (!consolidation) {
    noneOutput.reason = ['No consolidation detected below SMA(50) in staleness window'];
    return noneOutput;
  }

  // ---- Step 3: Classify as near or forming ----
  const currentClose = data[barIndex].close;
  const consolidationLow = consolidation.consolidationLow;

  // "within 1% of consolidation low" means price is at most 1% ABOVE the low
  // price <= consolidationLow * 1.01 → near
  // price > consolidationLow * 1.01 → forming
  if (currentClose <= consolidationLow * 1.01) {
    // Near: price within 1% of consolidation low (approaching breakdown from above)
    const distancePct = consolidationLow > 0
      ? ((currentClose - consolidationLow) / consolidationLow) * 100
      : 0;
    return {
      ticker: '',
      strategy: 'bear_breakdown',
      signal: 'near',
      date,
      entry: consolidationLow,
      stop: 0,
      risk_pct: 0,
      confidence: 0.5 + Math.max(0, (1 - distancePct / 1) * 0.3),
      reason: [
        'Consolidation below SMA(50), price near breakdown level',
        `Consolidation low: ${consolidationLow.toFixed(2)}`,
        `Current price: ${currentClose.toFixed(2)}`,
        `Distance: ${distancePct.toFixed(2)}%`,
      ],
    };
  }

  // Forming: consolidation detected but price > 1% above consolidation low
  const distancePct = consolidationLow > 0
    ? ((currentClose - consolidationLow) / consolidationLow) * 100
    : 0;
  return {
    ticker: '',
    strategy: 'bear_breakdown',
    signal: 'forming',
    date,
    entry: consolidationLow,
    stop: 0,
    risk_pct: 0,
    confidence: 0.2 + Math.max(0, 0.3 - distancePct / 100) * 0.5,
    reason: [
      'Consolidation below SMA(50), price not yet near breakdown',
      `Consolidation low: ${consolidationLow.toFixed(2)}`,
      `Current price: ${currentClose.toFixed(2)}`,
      `Distance from breakdown: ${distancePct.toFixed(2)}%`,
    ],
  };
}

// ============================================================
// Post-Earnings Drift Signal Detection
// ============================================================

/**
 * Post-earnings drift signal classification (four-state):
 *
 *   active  — shouldEnter() confirms valid entry AND risk ≤ max_risk_pct
 *   near    — consolidation detected AND current close within 1% of consolidation high
 *   forming — consolidation detected AND price > 1% from consolidation high, ATR ratio ≤ threshold
 *   none    — no consolidation detected, insufficient data, or pattern failed
 *
 * Regime filter integration:
 *   bearish (SPY and QQQ both trend = -1): suppress active/near → max "forming"
 *   neutral/unknown: suppress active → max "near"
 *   bullish: no suppression
 */
export function detectPostEarningsDriftSignal(
  data: HistoricalDataPoint[],
  params: Record<string, number>,
  options?: DetectSignalOptions
): SignalOutput {
  const config = buildPeadConfigFromParams(params);
  const barIndex = data.length - 1;
  const date = data.length > 0 ? data[barIndex].date : new Date().toISOString().slice(0, 10);
  const earningsDates = options?.earningsDates ?? [];
  const marketRegime: MarketRegime = options?.marketRegime ?? 'unknown';

  const noneOutput: SignalOutput = {
    ticker: '',
    strategy: 'post_earnings_drift',
    signal: 'none',
    date,
    entry: 0,
    stop: 0,
    risk_pct: 0,
    confidence: 0,
    reason: [],
  };

  // Need minimum 51 bars for signal detection
  if (data.length < 51) {
    noneOutput.reason = ['Insufficient data for signal detection (need at least 51 bars)'];
    return noneOutput;
  }

  // If no earnings dates provided, cannot detect PEAD pattern
  if (earningsDates.length === 0) {
    noneOutput.reason = ['No earnings dates available'];
    return noneOutput;
  }

  // ---- Step 1: Find the most recent valid earnings gap scanning backward ----
  const gapInfo = findMostRecentEarningsGap(data, barIndex, earningsDates, config);

  if (!gapInfo) {
    noneOutput.reason = ['No valid earnings gap detected in available data'];
    return noneOutput;
  }

  // ---- Step 2: Evaluate consolidation from the gap day to current bar ----
  const daysAfterGap = barIndex - gapInfo.gapDayIndex;

  // If we're still on the gap day or before consolidation can start, no signal
  if (daysAfterGap < 1) {
    noneOutput.reason = ['Earnings gap detected but consolidation not yet started'];
    return noneOutput;
  }

  // Check for gap-and-run: first bar after gap closes above gap day high
  // AND all bars within consolidation_min_days close above gap day high
  if (daysAfterGap >= config.consolidation_min_days) {
    const firstBarAfterGap = data[gapInfo.gapDayIndex + 1];
    if (firstBarAfterGap && firstBarAfterGap.close > gapInfo.gapDayHigh) {
      let allAboveGapHigh = true;
      const checkEnd = Math.min(gapInfo.gapDayIndex + config.consolidation_min_days, barIndex);
      for (let i = gapInfo.gapDayIndex + 1; i <= checkEnd; i++) {
        if (i < data.length && data[i].close <= gapInfo.gapDayHigh) {
          allAboveGapHigh = false;
          break;
        }
      }
      if (allAboveGapHigh) {
        noneOutput.reason = ['Gap-and-run detected — no consolidation setup'];
        return noneOutput;
      }
    }
  }

  // Evaluate consolidation
  const consolidation = PostEarningsDriftEngine.evaluateConsolidation(
    data,
    gapInfo.gapDayIndex,
    barIndex,
    gapInfo.gapDayHigh,
    gapInfo.gapDayLow,
    gapInfo.gapDayVolume,
    config,
    gapInfo.previousDayClose
  );

  // If consolidation failed or expired, no signal
  if (consolidation.status === 'failed') {
    noneOutput.reason = ['Consolidation failed — close dropped below gap day low or pre-gap close'];
    return noneOutput;
  }

  if (consolidation.status === 'expired') {
    noneOutput.reason = ['Consolidation expired — exceeded max days without breakout'];
    return noneOutput;
  }

  if (consolidation.status === 'idle') {
    noneOutput.reason = ['No active consolidation'];
    return noneOutput;
  }

  // ---- Step 3: Classify signal state (priority: active > near > forming > none) ----

  // Check for active: shouldEnter() confirms valid entry
  let rawSignal: SignalOutput;

  if (consolidation.status === 'valid') {
    const entryResult = PostEarningsDriftEngine.shouldEnter(
      data,
      barIndex,
      consolidation.consolidationHigh,
      consolidation.consolidationLow,
      config
    );

    if (entryResult) {
      const riskPct = ((entryResult.entryPrice - entryResult.stopLossPrice) / entryResult.entryPrice) * 100;

      if (riskPct <= config.max_risk_pct) {
        // Active signal — use PEAD-specific confidence score
        const confidence = computePeadConfidenceScore(
          data,
          barIndex,
          consolidation,
          config,
          undefined, // spyData not available in signal detector context
          params.weight_preset
        );
        rawSignal = {
          ticker: '',
          strategy: 'post_earnings_drift',
          signal: 'active',
          date,
          entry: entryResult.entryPrice,
          stop: entryResult.stopLossPrice,
          risk_pct: riskPct,
          confidence,
          reason: [
            'PEAD breakout entry confirmed',
            `Entry: ${entryResult.entryPrice.toFixed(2)}`,
            `Stop: ${entryResult.stopLossPrice.toFixed(2)}`,
            `Target: ${entryResult.profitTargetPrice.toFixed(2)}`,
            `Risk: ${riskPct.toFixed(2)}%`,
            `R:R = 1:${config.r_multiple}`,
          ],
        };
      } else {
        // Risk exceeds max — downgrade to near or forming based on proximity
        rawSignal = classifyByProximity(data, barIndex, date, consolidation, config);
        rawSignal.reason.push(`Risk ${riskPct.toFixed(2)}% exceeds max ${config.max_risk_pct}% — downgraded from active`);
      }
    } else {
      // shouldEnter() didn't confirm — classify by proximity
      rawSignal = classifyByProximity(data, barIndex, date, consolidation, config);
    }
  } else {
    // Consolidation in_progress — classify by proximity
    rawSignal = classifyByProximity(data, barIndex, date, consolidation, config);
  }

  // ---- Step 4: Apply regime filter suppression ----
  return applyRegimeFilter(rawSignal, marketRegime);
}

// ============================================================
// PEAD Signal Detection Helpers
// ============================================================

/**
 * Build a PostEarningsDriftConfiguration from flat params.
 * Falls back to defaults for any missing parameter.
 */
function buildPeadConfigFromParams(params: Record<string, number>): PostEarningsDriftConfiguration {
  return mergePeadConfig({
    gap_min_pct: params.gap_min_pct,
    gap_volume_multiplier: params.gap_volume_multiplier,
    consolidation_min_days: params.consolidation_min_days,
    consolidation_max_days: params.consolidation_max_days,
    max_range_pct: params.max_range_pct,
    breakout_volume_multiplier: params.breakout_volume_multiplier,
    stop_buffer_atr: params.stop_buffer_atr,
    r_multiple: params.r_multiple,
    max_risk_pct: params.max_risk_pct,
    trend_exit_sma_period: params.trend_exit_sma_period,
  });
}

/**
 * Find the most recent valid earnings gap by scanning backward through earnings dates.
 * Returns gap info or null if no valid gap found within the data window.
 */
function findMostRecentEarningsGap(
  data: HistoricalDataPoint[],
  barIndex: number,
  earningsDates: string[],
  config: PostEarningsDriftConfiguration
): {
  gapDayIndex: number;
  gapDayHigh: number;
  gapDayLow: number;
  gapDayVolume: number;
  previousDayClose: number;
} | null {
  // Build a date-to-index map for quick lookup
  const dateToIndex = new Map<string, number>();
  for (let i = 0; i <= barIndex; i++) {
    dateToIndex.set(data[i].date.slice(0, 10), i);
  }

  // Scan earnings dates in reverse (most recent first) to find the latest valid gap
  // Only consider gaps that are within the consolidation window from the current bar
  const maxLookback = config.consolidation_max_days + 5; // some buffer for gap day + consolidation

  for (let ei = earningsDates.length - 1; ei >= 0; ei--) {
    const earningsDate = earningsDates[ei].slice(0, 10);
    const earningsBarIndex = dateToIndex.get(earningsDate);

    if (earningsBarIndex === undefined) continue;

    // Skip if too far back from current bar
    if (barIndex - earningsBarIndex > maxLookback) continue;

    // Skip if in the future relative to current bar
    if (earningsBarIndex > barIndex) continue;

    // Check for nearby earnings (another earnings within 14 calendar days)
    if (hasNearbyEarningsDate(earningsDates, ei)) continue;

    // Detect the gap
    const gapResult = PostEarningsDriftEngine.detectEarningsGap(data, earningsBarIndex, config);

    if (gapResult.detected) {
      return {
        gapDayIndex: gapResult.gapDayIndex,
        gapDayHigh: gapResult.gapDayHigh,
        gapDayLow: gapResult.gapDayLow,
        gapDayVolume: gapResult.gapDayVolume,
        previousDayClose: gapResult.previousDayClose,
      };
    }
  }

  return null;
}

/**
 * Check if there's another earnings date within 14 calendar days of the given index.
 */
function hasNearbyEarningsDate(earningsDates: string[], currentIndex: number): boolean {
  const currentDate = new Date(earningsDates[currentIndex]);
  const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

  if (currentIndex + 1 < earningsDates.length) {
    const nextDate = new Date(earningsDates[currentIndex + 1]);
    const diffMs = nextDate.getTime() - currentDate.getTime();
    if (diffMs > 0 && diffMs <= fourteenDaysMs) {
      return true;
    }
  }

  return false;
}

/**
 * Classify signal as "near" or "forming" based on price proximity to consolidation high.
 *
 * near: current close within 1% of consolidation high
 * forming: consolidation detected but price > 1% from consolidation high AND ATR ratio ≤ threshold
 */
function classifyByProximity(
  data: HistoricalDataPoint[],
  barIndex: number,
  date: string,
  consolidation: ConsolidationResult,
  config: PostEarningsDriftConfiguration
): SignalOutput {
  const currentClose = data[barIndex].close;
  const consolidationHigh = consolidation.consolidationHigh;

  // Compute proximity: how far is current close from consolidation high (as fraction)
  const proximityPct = consolidationHigh > 0
    ? (consolidationHigh - currentClose) / consolidationHigh
    : Infinity;

  // Near: price within 1% of consolidation high (below or at the high)
  if (proximityPct >= 0 && proximityPct <= 0.01) {
    // Confidence scaled inversely by proximity distance: closer = higher confidence
    const confidence = 0.5 + (1 - proximityPct / 0.01) * 0.3;
    return {
      ticker: '',
      strategy: 'post_earnings_drift',
      signal: 'near',
      date,
      entry: consolidationHigh,
      stop: 0,
      risk_pct: 0,
      confidence,
      reason: [
        'PEAD consolidation detected, price near breakout level',
        `Consolidation high: ${consolidationHigh.toFixed(2)}`,
        `Current price: ${currentClose.toFixed(2)}`,
        `Proximity: ${(proximityPct * 100).toFixed(2)}%`,
        `Days in consolidation: ${consolidation.daysInConsolidation}`,
      ],
    };
  }

  // Also classify as "near" if price is above consolidation high but within 1%
  // (price has slightly exceeded but not with volume confirmation)
  if (proximityPct < 0 && Math.abs(proximityPct) <= 0.01) {
    const confidence = 0.5 + (1 - Math.abs(proximityPct) / 0.01) * 0.3;
    return {
      ticker: '',
      strategy: 'post_earnings_drift',
      signal: 'near',
      date,
      entry: consolidationHigh,
      stop: 0,
      risk_pct: 0,
      confidence,
      reason: [
        'PEAD consolidation detected, price at breakout level',
        `Consolidation high: ${consolidationHigh.toFixed(2)}`,
        `Current price: ${currentClose.toFixed(2)}`,
        `Proximity: ${(Math.abs(proximityPct) * 100).toFixed(2)}% above`,
        `Days in consolidation: ${consolidation.daysInConsolidation}`,
      ],
    };
  }

  // Forming: consolidation detected, price > 1% from consolidation high
  // Check ATR ratio condition for forming quality
  const atrRatioOk = checkAtrRatio(data, barIndex);

  const confidence = atrRatioOk
    ? 0.2 + Math.max(0, 0.3 - Math.abs(proximityPct)) * 0.5
    : 0.1;

  return {
    ticker: '',
    strategy: 'post_earnings_drift',
    signal: 'forming',
    date,
    entry: consolidationHigh,
    stop: 0,
    risk_pct: 0,
    confidence,
    reason: [
      'PEAD consolidation detected, price not yet near breakout',
      `Consolidation high: ${consolidationHigh.toFixed(2)}`,
      `Current price: ${currentClose.toFixed(2)}`,
      `Distance from breakout: ${(Math.abs(proximityPct) * 100).toFixed(2)}%`,
      `Days in consolidation: ${consolidation.daysInConsolidation}`,
      consolidation.decliningVolumeFlag ? 'Declining volume ✓' : 'Volume not declining',
    ],
  };
}

/**
 * Check if ATR ratio (short/long) is at or below threshold (1.0).
 * Used to confirm forming signal quality — low volatility during consolidation.
 */
function checkAtrRatio(data: HistoricalDataPoint[], barIndex: number): boolean {
  const barsUpTo = data.slice(0, barIndex + 1);

  if (barsUpTo.length < 15) return true; // Not enough data, assume OK

  const atr14 = computeAtr(barsUpTo, 14);
  if (atr14 === undefined) return true;

  // Use a longer ATR for comparison if we have enough data
  if (barsUpTo.length >= 51) {
    const atr50 = computeAtr(barsUpTo, 50);
    if (atr50 !== undefined && atr50 > 0) {
      return (atr14 / atr50) <= 1.0;
    }
  }

  return true; // Default to OK if we can't compute ratio
}

/**
 * Apply regime filter suppression to a PEAD signal.
 *
 * Bearish (SPY and QQQ both trend = -1): max "forming"
 * Neutral/unknown: max "near"
 * Bullish: no suppression
 */
function applyRegimeFilter(signal: SignalOutput, marketRegime: MarketRegime): SignalOutput {
  if (marketRegime === 'bullish') {
    // No suppression
    return signal;
  }

  if (marketRegime === 'bearish') {
    // Suppress active and near → downgrade to forming max
    if (signal.signal === 'active' || signal.signal === 'near') {
      return {
        ...signal,
        signal: 'forming',
        entry: signal.signal === 'active' ? signal.entry : signal.entry,
        stop: 0,
        risk_pct: 0,
        confidence: Math.min(signal.confidence, 0.4),
        reason: [
          ...signal.reason,
          'Regime suppression: bearish market — downgraded to forming',
        ],
      };
    }
    return signal;
  }

  // Neutral or unknown: suppress active → max "near"
  if (signal.signal === 'active') {
    return {
      ...signal,
      signal: 'near',
      confidence: Math.min(signal.confidence, 0.7),
      reason: [
        ...signal.reason,
        'Regime suppression: neutral/unknown market — downgraded to near',
      ],
    };
  }

  return signal;
}
