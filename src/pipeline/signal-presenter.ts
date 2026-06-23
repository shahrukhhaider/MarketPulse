// ============================================================
// Signal Presenter — Single source of truth for displayed signals
// ============================================================
// Groups signals by ticker, merges multi-strategy hits, sorts by
// composite score, and produces PresentedSignal[] for consumption
// by both CLI and Discord formatters.
// ============================================================

import type { SignalOutput } from '../strategies/strategy-registry.js';
import type { ProcessedSignals } from './signal-pipeline.js';
import { flattenProcessedSignals } from './read-processed-signals.js';
import { computeCompositeScore, compareSignals } from '../formatters/signal-sort.js';
import { narrateSignal } from '../formatters/signal-narrator.js';
import type { SignalLineage } from '../indicators/signal-lineage.js';
import type { FundamentalData } from '../types.js';

// ============================================================
// Types
// ============================================================

export interface StrategyDetail {
  strategy: string;
  entry: number;
  stop: number;
  target: number | null;
  confidence: number;
  riskPct: number;
  rrRatio: string;
  narrative: string;
}

export interface PresentedSignal {
  ticker: string;
  /** Primary strategy (highest confidence) */
  primaryStrategy: string;
  /** All strategies that fired for this ticker */
  strategies: string[];
  /** Whether this is a merged multi-strategy signal */
  merged: boolean;

  // Entry/stop/target — from primary strategy
  entry: number;
  stop: number;
  target: number | null;

  // Best metrics (from primary strategy)
  confidence: number;
  riskPct: number;
  rrRatio: string;

  // Side
  side: 'BUY' | 'SHORT';

  // Metadata from primary signal
  lineage: SignalLineage | null;
  regimeState: { ticker_regime?: string; rs_rating?: number } | null;
  rsRating: number | null;
  fundamentalData: FundamentalData | null;
  rvol: number | null;
  candlestickPatterns: string[] | null;
  confluence: number | undefined;

  // Narrative
  narrative: string;

  // Per-strategy detail (for merged signals — all strategies; for solo — single entry)
  strategyDetails: StrategyDetail[];

  // Raw signal reference (for chart matching and downstream use)
  primarySignal: SignalOutput;
}

export interface PresentOptions {
  /** Max signals to return (default: 5) */
  limit?: number;
  /** Signal types to include (default: ['active', 'active_late']) */
  signalTypes?: string[];
}

// ============================================================
// Helpers
// ============================================================

function determineSide(strategy: string): 'BUY' | 'SHORT' {
  const lower = strategy.toLowerCase();
  if (lower.includes('bear') || lower.includes('short')) {
    return 'SHORT';
  }
  return 'BUY';
}

function extractTarget(signal: SignalOutput): number | null {
  // Check direct .target property (added by some pipeline paths)
  const directTarget = (signal as any).target as number | undefined;
  if (directTarget != null) return directTarget;

  // Extract from reason array
  const line = (signal.reason ?? []).find(r => r.includes('Target:'));
  const match = line?.match(/Target:\s*([\d.]+)/);
  return match ? parseFloat(match[1]) : null;
}

function extractRR(reason: string[]): string {
  const line = reason.find(r => r.includes('R:R'));
  return line?.match(/R:R\s*=\s*([\d:.]+)/)?.[1] ?? '—';
}

function buildStrategyDetail(signal: SignalOutput): StrategyDetail {
  const target = extractTarget(signal);
  const narrative = narrateSignal({
    ticker: signal.ticker,
    strategy: signal.strategy,
    signal: signal.signal,
    entry: signal.entry,
    stop: signal.stop,
    target,
    reason: signal.reason,
  });

  return {
    strategy: signal.strategy,
    entry: signal.entry,
    stop: signal.stop,
    target,
    confidence: signal.confidence,
    riskPct: signal.risk_pct,
    rrRatio: extractRR(signal.reason ?? []),
    narrative,
  };
}

// ============================================================
// Main Entry Point
// ============================================================

/**
 * The single interface for determining which signals to display and how.
 * Groups by ticker, merges multi-strategy, sorts by composite score.
 *
 * Both CLI and Discord formatters consume this output.
 */
export function presentSignals(
  processedSignals: ProcessedSignals,
  options?: PresentOptions,
): PresentedSignal[] {
  const limit = options?.limit ?? 5;
  const signalTypes = options?.signalTypes ?? ['active', 'active_late'];

  // 1. Flatten and filter to requested signal types
  const all = flattenProcessedSignals(processedSignals);
  const filtered = all.filter(s => signalTypes.includes(s.signal));

  if (filtered.length === 0) return [];

  // 2. Group by ticker
  const byTicker = new Map<string, SignalOutput[]>();
  for (const sig of filtered) {
    const group = byTicker.get(sig.ticker) ?? [];
    group.push(sig);
    byTicker.set(sig.ticker, group);
  }

  // 3. Build PresentedSignal for each ticker group
  const presented: PresentedSignal[] = [];

  for (const [ticker, signals] of byTicker) {
    // Find the primary signal (highest composite score)
    const primary = signals.reduce((best, s) => {
      const scoreS = computeCompositeScore(s.rvol, s.confidence);
      const scoreBest = computeCompositeScore(best.rvol, best.confidence);
      return scoreS > scoreBest ? s : best;
    }, signals[0]);

    const strategyDetails = signals.map(buildStrategyDetail);
    const target = extractTarget(primary);
    const lineage = (primary as any).lineage as SignalLineage | undefined;
    const regimeState = (primary as any).regimeState as { ticker_regime?: string; rs_rating?: number } | undefined;
    const fundData = (primary as any).fundamentalData as FundamentalData | undefined;

    const narrative = narrateSignal({
      ticker: primary.ticker,
      strategy: primary.strategy,
      signal: primary.signal,
      entry: primary.entry,
      stop: primary.stop,
      target,
      reason: primary.reason,
    });

    presented.push({
      ticker,
      primaryStrategy: primary.strategy,
      strategies: signals.map(s => s.strategy),
      merged: signals.length > 1,

      entry: primary.entry,
      stop: primary.stop,
      target,

      confidence: primary.confidence,
      riskPct: primary.risk_pct,
      rrRatio: extractRR(primary.reason ?? []),

      side: determineSide(primary.strategy),

      lineage: lineage ?? null,
      regimeState: regimeState ?? null,
      rsRating: regimeState?.rs_rating ?? null,
      fundamentalData: fundData ?? null,
      rvol: primary.rvol ?? null,
      candlestickPatterns: (primary as any).candlestickPatterns ?? null,
      confluence: primary.confluence,

      narrative,
      strategyDetails,

      primarySignal: primary,
    });
  }

  // 4. Sort by composite score (same comparator as pipeline)
  presented.sort((a, b) => compareSignals(a.primarySignal, b.primarySignal));

  // 5. Slice to limit
  return presented.slice(0, limit);
}
