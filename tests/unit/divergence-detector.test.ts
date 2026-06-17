import { describe, it, expect } from 'vitest';
import { classifyStrategy, detectDivergence } from '../../src/sentiment/divergence-detector.js';
import type { SignalDirection } from '../../src/sentiment/divergence-detector.js';

describe('classifyStrategy', () => {
  it('classifies trend_pullback as bullish', () => {
    expect(classifyStrategy('trend_pullback')).toBe('bullish');
  });

  it('classifies consolidation_breakout as bullish', () => {
    expect(classifyStrategy('consolidation_breakout')).toBe('bullish');
  });

  it('classifies post_earnings_drift as bullish', () => {
    expect(classifyStrategy('post_earnings_drift')).toBe('bullish');
  });

  it('classifies bear_breakdown as bearish', () => {
    expect(classifyStrategy('bear_breakdown')).toBe('bearish');
  });

  it('returns null for keltner_mean_reversion (unclassified)', () => {
    expect(classifyStrategy('keltner_mean_reversion')).toBeNull();
  });

  it('returns null for unknown strategies', () => {
    expect(classifyStrategy('some_random_strategy')).toBeNull();
  });
});

describe('detectDivergence', () => {
  // ── Divergence cases ─────────────────────────────────────────────

  it('returns warning for trend_pullback + bearish band', () => {
    expect(detectDivergence('trend_pullback', 'bearish'))
      .toBe('⚠️ Bearish sentiment on bullish signal');
  });

  it('returns warning for consolidation_breakout + bearish band', () => {
    expect(detectDivergence('consolidation_breakout', 'bearish'))
      .toBe('⚠️ Bearish sentiment on bullish signal');
  });

  it('returns warning for post_earnings_drift + bearish band', () => {
    expect(detectDivergence('post_earnings_drift', 'bearish'))
      .toBe('⚠️ Bearish sentiment on bullish signal');
  });

  it('returns warning for bear_breakdown + bullish band', () => {
    expect(detectDivergence('bear_breakdown', 'bullish'))
      .toBe('⚠️ Bullish sentiment on bearish signal');
  });

  // ── No divergence cases ──────────────────────────────────────────

  it('returns null for bullish strategy + bullish band (aligned)', () => {
    expect(detectDivergence('trend_pullback', 'bullish')).toBeNull();
  });

  it('returns null for bearish strategy + bearish band (aligned)', () => {
    expect(detectDivergence('bear_breakdown', 'bearish')).toBeNull();
  });

  it('returns null for any strategy + neutral band', () => {
    expect(detectDivergence('trend_pullback', 'neutral')).toBeNull();
    expect(detectDivergence('bear_breakdown', 'neutral')).toBeNull();
  });

  it('returns null for any strategy + unknown band', () => {
    expect(detectDivergence('trend_pullback', 'unknown')).toBeNull();
    expect(detectDivergence('bear_breakdown', 'unknown')).toBeNull();
  });

  it('returns null for unclassified strategy + bearish band', () => {
    expect(detectDivergence('keltner_mean_reversion', 'bearish')).toBeNull();
  });

  it('returns null for unclassified strategy + bullish band', () => {
    expect(detectDivergence('keltner_mean_reversion', 'bullish')).toBeNull();
  });
});
