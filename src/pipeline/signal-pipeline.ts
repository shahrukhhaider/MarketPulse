// ============================================================
// Signal Pipeline — Pure-function signal processing pipeline
// ============================================================
// Centralizes conflict resolution, deduplication, grouping,
// sorting, and tier limiting into a single composable pipeline.
// All functions are pure: no I/O, no side effects.
// ============================================================

import { compareSignals } from '../formatters/signal-sort.js';
import { STRATEGY_DIRECTION, SIGNAL_PRIORITY } from './strategy-direction.js';
import type { SignalOutput } from '../strategies/strategy-registry.js';

// ============================================================
// Interfaces
// ============================================================

/**
 * Grouped pipeline output — signals categorized by tier.
 * active: active, active_late, extended, pressure
 * near: near
 * forming: forming
 * none: none (or unrecognized signal states)
 */
export interface ProcessedSignals {
  active: SignalOutput[];
  near: SignalOutput[];
  forming: SignalOutput[];
  none: SignalOutput[];
}

/**
 * Options for the pipeline run.
 * tierLimits: optional max signals per tier (consumers typically slice instead).
 */
export interface PipelineOptions {
  tierLimits?: {
    active?: number;
    near?: number;
    forming?: number;
    none?: number;
  };
}

// ============================================================
// Pipeline Steps
// ============================================================

/**
 * Resolve directional conflicts: when a ticker has both long and short
 * actionable signals, the dominant direction wins (by signal priority,
 * then confidence). Non-conflict signals pass through unchanged.
 * Signals with signal === 'none' are always preserved.
 */
export function resolveConflicts(signals: SignalOutput[]): SignalOutput[] {
  const byTicker = new Map<string, SignalOutput[]>();
  for (const sig of signals) {
    if (!sig.ticker) continue;
    const group = byTicker.get(sig.ticker) ?? [];
    group.push(sig);
    byTicker.set(sig.ticker, group);
  }

  const result: SignalOutput[] = [];

  for (const [, tickerSignals] of byTicker) {
    const longSignals: SignalOutput[] = [];
    const shortSignals: SignalOutput[] = [];

    for (const sig of tickerSignals) {
      if (sig.signal === 'none') {
        result.push(sig);
        continue;
      }
      const dir = STRATEGY_DIRECTION[sig.strategy] ?? 'long';
      if (dir === 'long') longSignals.push(sig);
      else shortSignals.push(sig);
    }

    // No conflict: only one direction has signals
    if (longSignals.length === 0 || shortSignals.length === 0) {
      result.push(...longSignals, ...shortSignals);
      continue;
    }

    // Conflict: pick dominant direction
    const bestLong = getBestSignal(longSignals);
    const bestShort = getBestSignal(shortSignals);
    const longPri = SIGNAL_PRIORITY[bestLong.signal] ?? 6;
    const shortPri = SIGNAL_PRIORITY[bestShort.signal] ?? 6;

    if (longPri < shortPri) {
      result.push(...longSignals);
    } else if (shortPri < longPri) {
      result.push(...shortSignals);
    } else {
      // Same priority — tie-break by confidence
      if (bestLong.confidence >= bestShort.confidence) {
        result.push(...longSignals);
      } else {
        result.push(...shortSignals);
      }
    }
  }

  return result;
}

/**
 * Get the best signal from a group (lowest priority number, then highest confidence).
 */
function getBestSignal(signals: SignalOutput[]): SignalOutput {
  return signals.reduce((best, sig) => {
    const bestPri = SIGNAL_PRIORITY[best.signal] ?? 6;
    const sigPri = SIGNAL_PRIORITY[sig.signal] ?? 6;
    if (sigPri < bestPri) return sig;
    if (sigPri === bestPri && sig.confidence > best.confidence) return sig;
    return best;
  });
}

/**
 * Deduplicate: for each (ticker, strategy) pair, keep only the signal
 * with the highest confidence.
 */
export function deduplicate(signals: SignalOutput[]): SignalOutput[] {
  const seen = new Map<string, SignalOutput>();
  for (const sig of signals) {
    const key = `${sig.ticker}:${sig.strategy}`;
    const existing = seen.get(key);
    if (!existing || sig.confidence > existing.confidence) {
      seen.set(key, sig);
    }
  }
  return [...seen.values()];
}

/**
 * Group signals into tiers based on signal state.
 * active: active, active_late, extended, pressure
 * near: near
 * forming: forming
 * none: none (and any unrecognized signal states)
 */
export function groupByTier(signals: SignalOutput[]): ProcessedSignals {
  const groups: ProcessedSignals = { active: [], near: [], forming: [], none: [] };
  for (const sig of signals) {
    switch (sig.signal) {
      case 'active':
      case 'active_late':
      case 'extended':
      case 'pressure':
        groups.active.push(sig);
        break;
      case 'near':
        groups.near.push(sig);
        break;
      case 'forming':
        groups.forming.push(sig);
        break;
      default:
        groups.none.push(sig);
        break;
    }
  }
  return groups;
}

/**
 * Sort each tier using the shared compareSignals comparator.
 * Returns a new ProcessedSignals object (does not mutate input).
 */
export function sortWithinGroups(groups: ProcessedSignals): ProcessedSignals {
  return {
    active: [...groups.active].sort(compareSignals),
    near: [...groups.near].sort(compareSignals),
    forming: [...groups.forming].sort(compareSignals),
    none: [...groups.none].sort(compareSignals),
  };
}

/**
 * Apply optional tier limits (truncate each group to N items).
 * When no limits are provided, groups pass through unchanged.
 */
export function applyTierLimits(
  groups: ProcessedSignals,
  limits?: PipelineOptions['tierLimits'],
): ProcessedSignals {
  if (!limits) return groups;
  return {
    active: limits.active != null ? groups.active.slice(0, limits.active) : groups.active,
    near: limits.near != null ? groups.near.slice(0, limits.near) : groups.near,
    forming: limits.forming != null ? groups.forming.slice(0, limits.forming) : groups.forming,
    none: limits.none != null ? groups.none.slice(0, limits.none) : groups.none,
  };
}

// ============================================================
// Full Pipeline
// ============================================================

/**
 * Full pipeline: conflict resolution → deduplication → grouping → sorting → tier limiting.
 * Pure function — no I/O, no side effects.
 * Given the same input signals and options, always produces the same output.
 */
export function runPipeline(signals: SignalOutput[], options?: PipelineOptions): ProcessedSignals {
  const resolved = resolveConflicts(signals);
  const deduped = deduplicate(resolved);
  const grouped = groupByTier(deduped);
  const sorted = sortWithinGroups(grouped);
  return applyTierLimits(sorted, options?.tierLimits);
}
