import type { HistoricalDataPoint } from './types.js';
import type { SignalOutput } from './strategy-registry.js';
import type { ConsolidationBreakoutConfiguration } from './strategies/strategy-configs.js';
import { ConsolidationBreakoutEngine } from './strategies/consolidation-breakout-engine.js';
import { buildConsolidationBreakoutConfig } from './parameter-grid.js';
import { BreakoutContextAnalyzer } from './breakout-context.js';

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
