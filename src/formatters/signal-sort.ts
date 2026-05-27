// ============================================================
// Signal Sort — Shared sorting logic for active signals
// ============================================================
// Used by terminal formatter, Slack, and Discord to ensure
// consistent signal ordering across all output channels.
// ============================================================

/**
 * Minimal signal interface for sorting. All formatters' signal types
 * satisfy this interface.
 */
export interface SortableSignal {
  strategy: string;
  confidence: number;
  risk_pct: number;
  rvol?: number | null;
  confluence?: number | null;
  regimeState?: { ticker_regime?: string; rs_rating?: number } | null;
}

/**
 * Compute composite score: rvol × confidence.
 * Returns 0 when rvol is null/undefined or confidence is 0.
 */
export function computeCompositeScore(
  rvol: number | null | undefined,
  confidence: number
): number {
  return (rvol ?? 0) * confidence;
}

/**
 * Determine if a signal is regime-aligned.
 * BUY signals are aligned when ticker_regime is 'bullish'.
 * SHORT signals are aligned when ticker_regime is 'bearish'.
 * Returns: 1 = aligned, 0 = neutral/unknown, -1 = misaligned
 */
export function regimeAlignmentScore(signal: SortableSignal): number {
  const regime = signal.regimeState?.ticker_regime;
  if (!regime || regime === 'unknown') return 0;

  const isShort = signal.strategy === 'bear_breakdown';
  if (isShort) {
    return regime === 'bearish' ? 1 : -1;
  }
  // Long strategies
  return regime === 'bullish' ? 1 : -1;
}

/**
 * Compare two signals for sorting.
 * Sort order:
 *   1. Regime alignment (aligned > neutral > misaligned)
 *   2. Composite score (rvol × confidence) descending
 *   3. Confluence descending
 *   4. RS rating descending
 *   5. Risk % ascending (lower risk preferred)
 */
export function compareSignals(a: SortableSignal, b: SortableSignal): number {
  // 1. Regime alignment descending (aligned first)
  const alignA = regimeAlignmentScore(a);
  const alignB = regimeAlignmentScore(b);
  if (alignB !== alignA) return alignB - alignA;

  // 2. Composite score descending
  const scoreA = computeCompositeScore(a.rvol, a.confidence);
  const scoreB = computeCompositeScore(b.rvol, b.confidence);
  if (scoreB !== scoreA) return scoreB - scoreA;

  // 3. Confluence descending
  const confA = a.confluence ?? 0;
  const confB = b.confluence ?? 0;
  if (confB !== confA) return confB - confA;

  // 4. RS rating descending
  const rsA = a.regimeState?.rs_rating ?? 0;
  const rsB = b.regimeState?.rs_rating ?? 0;
  if (rsB !== rsA) return rsB - rsA;

  // 5. Risk % ascending
  return a.risk_pct - b.risk_pct;
}

/**
 * Sort an array of signals using the standard sort order.
 * Returns a new sorted array (does not mutate input).
 */
export function sortSignals<T extends SortableSignal>(signals: T[]): T[] {
  return [...signals].sort(compareSignals);
}
