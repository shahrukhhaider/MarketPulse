import type { SentimentBand } from '../data/stocktwits-provider.js';

/**
 * Classification of a strategy's directional bias.
 * - "bullish" for long-biased setups
 * - "bearish" for short-biased setups
 * - null for strategies with no directional classification
 */
export type SignalDirection = 'bullish' | 'bearish' | null;

const BULLISH_STRATEGIES = ['trend_pullback', 'consolidation_breakout', 'post_earnings_drift'];
const BEARISH_STRATEGIES = ['bear_breakdown'];

/**
 * Returns the signal direction classification for a strategy.
 * Returns null for strategies not classified (e.g., keltner_mean_reversion).
 */
export function classifyStrategy(strategy: string): SignalDirection {
  if (BULLISH_STRATEGIES.includes(strategy)) return 'bullish';
  if (BEARISH_STRATEGIES.includes(strategy)) return 'bearish';
  return null;
}

/**
 * Detects divergence between signal direction and sentiment band.
 * Returns a warning string if divergence exists, null otherwise.
 *
 * Rules:
 * - Bullish strategy + bearish band → divergence
 * - Bearish strategy + bullish band → divergence
 * - Unknown/neutral band → never divergence
 * - Unclassified strategy → never divergence
 */
export function detectDivergence(strategy: string, band: SentimentBand): string | null {
  const direction = classifyStrategy(strategy);

  // Unclassified strategy → no divergence
  if (direction === null) return null;

  // Unknown or neutral band → no divergence
  if (band === 'unknown' || band === 'neutral') return null;

  // Bullish strategy + bearish band
  if (direction === 'bullish' && band === 'bearish') {
    return '⚠️ Bearish sentiment on bullish signal';
  }

  // Bearish strategy + bullish band
  if (direction === 'bearish' && band === 'bullish') {
    return '⚠️ Bullish sentiment on bearish signal';
  }

  // Aligned direction (bullish+bullish or bearish+bearish) → no divergence
  return null;
}
