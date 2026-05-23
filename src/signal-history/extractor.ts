// ============================================================
// Signal History Extractor — Maps raw scan output to SignalEntry
// ============================================================

import type { SignalOutput } from '../strategies/strategy-registry.js';
import type { RegimeResult, RegimeState } from '../indicators/regime-detector.js';
import type { PositionMetrics } from '../utils/position-metrics.js';
import type {
  SignalEntry,
  MarketContext,
  ActiveSignal,
  NearSignal,
  OpenPosition,
} from './signal-entry.js';

// ============================================================
// ScanOutput — shape of the JSON produced by `cli.js scan --log`
// ============================================================

/** A signal annotated with regime state (as produced by the scan command). */
export interface AnnotatedSignal extends SignalOutput {
  regimeState?: RegimeState;
}

/**
 * Raw scan output structure as saved by `--log`.
 * Uses existing project types where possible.
 */
export interface ScanOutput {
  signals: AnnotatedSignal[];
  regime?: RegimeResult;
  marketRegime?: RegimeResult['market'];
  openPositions: PositionMetrics[];
}

// ============================================================
// Extraction Logic
// ============================================================

const ACTIVE_CLASSIFICATIONS = new Set(['active', 'active_late']);
const NEAR_CLASSIFICATIONS = new Set(['near']);

/**
 * Extract a SignalEntry from raw scan output for a given date.
 *
 * - Filters signals: "active"/"active_late" → active array, "near" → near array.
 *   Excludes "forming", "none", "extended", "pressure".
 * - Maps regime.market to market_context (defaults if missing).
 * - Maps openPositions to open_positions.
 * - Always includes empty arrays for active, near, open_positions.
 */
export function extractSignalEntry(scanOutput: ScanOutput, date: string): SignalEntry {
  const marketContext = extractMarketContext(scanOutput);
  const active = extractActiveSignals(scanOutput.signals);
  const near = extractNearSignals(scanOutput.signals);
  const openPositions = extractOpenPositions(scanOutput.openPositions);

  return {
    date,
    timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    market_context: marketContext,
    active,
    near,
    open_positions: openPositions,
  };
}

/**
 * Extract market context from regime data.
 * Falls back to defaults if regime data is missing.
 */
function extractMarketContext(scanOutput: ScanOutput): MarketContext {
  const market = scanOutput.regime?.market ?? scanOutput.marketRegime;

  if (!market) {
    return {
      market_mood: 'unknown',
      market_regime: 'unknown',
      vix: null,
      vix_regime: 'unknown',
      breadth_pct: null,
      breadth_label: 'unknown',
    };
  }

  return {
    market_mood: market.market_mood ?? 'unknown',
    market_regime: market.market_regime ?? 'unknown',
    vix: market.vix ?? null,
    vix_regime: market.vix_regime ?? 'unknown',
    breadth_pct: market.breadth_pct ?? null,
    breadth_label: market.breadth_label ?? 'unknown',
  };
}

/**
 * Filter and map signals classified as "active" or "active_late".
 */
function extractActiveSignals(signals: AnnotatedSignal[]): ActiveSignal[] {
  return signals
    .filter((s) => ACTIVE_CLASSIFICATIONS.has(s.signal))
    .map((s) => {
      const target = s.entry + (s.entry - s.stop) * 2;
      return {
        ticker: s.ticker,
        strategy: s.strategy,
        entry: s.entry,
        stop: s.stop,
        target,
        confidence: s.confidence,
        rs_rating: s.regimeState?.rs_rating ?? 0,
        rationale: s.reason,
        rvol: s.rvol ?? null,
      };
    });
}

/**
 * Filter and map signals classified as "near".
 */
function extractNearSignals(signals: AnnotatedSignal[]): NearSignal[] {
  return signals
    .filter((s) => NEAR_CLASSIFICATIONS.has(s.signal))
    .map((s) => ({
      ticker: s.ticker,
      strategy: s.strategy,
      entry_trigger: s.entry,
      stop: s.stop,
      confidence: s.confidence,
      rs_rating: s.regimeState?.rs_rating ?? 0,
      rationale: s.reason,
      rvol: s.rvol ?? null,
    }));
}

/**
 * Map PositionMetrics to OpenPosition entries.
 */
function extractOpenPositions(positions: PositionMetrics[] | undefined): OpenPosition[] {
  if (!positions || positions.length === 0) return [];

  return positions.map((p) => ({
    ticker: p.ticker,
    strategy: p.strategy,
    entry_price: p.entry_price,
    entry_date: p.signal_date,
    stop: p.stop_price,
    target: p.target_price,
    pnl_pct: p.pnl_pct ?? 0,
  }));
}
