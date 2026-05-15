import type { HistoricalDataPoint } from '../types.js';
import type { SignalOutput } from './strategy-registry.js';
import type { ConsolidationBreakoutConfiguration, TrendPullbackConfiguration, BearBreakdownConfiguration } from './strategy-configs.js';
import { ConsolidationBreakoutEngine } from './consolidation-breakout-engine.js';
import { TrendPullbackEngine } from './trend-pullback-engine.js';
import { BearBreakdownEngine } from './bear-breakdown-engine.js';
import { buildConsolidationBreakoutConfig, buildTrendPullbackGridConfig, buildBearBreakdownConfig } from './parameter-grid.js';
import { BreakoutContextAnalyzer } from '../indicators/breakout-context.js';

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
export function detectSignal(
  data: HistoricalDataPoint[],
  params: Record<string, number>,
  strategy: string
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
