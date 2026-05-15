import { describe, it, expect } from 'vitest';
import {
  computePnlPct,
  computeTargetProgress,
  computeStopDistance,
  computeDaysHeld,
  computePositionMetrics,
} from '../../src/utils/position-metrics.js';
import { JournalEntry } from '../../src/journal/journal-types.js';

describe('computePnlPct', () => {
  it('returns positive percentage when current > entry', () => {
    expect(computePnlPct(110, 100)).toBeCloseTo(10);
  });

  it('returns negative percentage when current < entry', () => {
    expect(computePnlPct(90, 100)).toBeCloseTo(-10);
  });

  it('returns 0 when current === entry', () => {
    expect(computePnlPct(100, 100)).toBe(0);
  });

  it('returns null when entryPrice is 0', () => {
    expect(computePnlPct(50, 0)).toBeNull();
  });
});

describe('computeTargetProgress', () => {
  it('returns 50 when halfway to target', () => {
    expect(computeTargetProgress(150, 100, 200)).toBeCloseTo(50);
  });

  it('returns 100 when at target', () => {
    expect(computeTargetProgress(200, 100, 200)).toBe(100);
  });

  it('clamps to 100 when above target', () => {
    expect(computeTargetProgress(250, 100, 200)).toBe(100);
  });

  it('clamps to 0 when below entry', () => {
    expect(computeTargetProgress(80, 100, 200)).toBe(0);
  });

  it('returns null when targetPrice === entryPrice', () => {
    expect(computeTargetProgress(100, 100, 100)).toBeNull();
  });
});

describe('computeStopDistance', () => {
  it('returns positive distance when current > stop', () => {
    // ((100 - 90) / 100) * 100 = 10
    expect(computeStopDistance(100, 90)).toBeCloseTo(10);
  });

  it('returns 0 when current === stop', () => {
    expect(computeStopDistance(100, 100)).toBe(0);
  });

  it('returns negative distance when current < stop', () => {
    // ((90 - 100) / 90) * 100 ≈ -11.11
    expect(computeStopDistance(90, 100)).toBeCloseTo(-11.111, 2);
  });

  it('returns null when currentPrice is 0', () => {
    expect(computeStopDistance(0, 90)).toBeNull();
  });
});

describe('computeDaysHeld', () => {
  it('returns correct calendar day difference', () => {
    const today = new Date('2025-06-15');
    expect(computeDaysHeld('2025-06-10', today)).toBe(5);
  });

  it('returns 0 for same day', () => {
    const today = new Date('2025-06-10');
    expect(computeDaysHeld('2025-06-10', today)).toBe(0);
  });

  it('returns 0 when signal date is in the future (clamped)', () => {
    const today = new Date('2025-06-01');
    expect(computeDaysHeld('2025-06-10', today)).toBe(0);
  });
});

describe('computePositionMetrics', () => {
  const baseEntry: JournalEntry = {
    id: 'j_123',
    ticker: 'AAPL',
    strategy: 'consolidation_breakout',
    signal_date: '2025-06-01',
    entry_price: 195.5,
    stop_price: 187.0,
    target_price: 205.5,
    risk_pct: 4.35,
    rr_ratio: 2.0,
    confidence: 0.8,
    status: 'open',
    outcome_date: null,
    outcome_price: null,
  };

  it('computes all metrics when currentPrice is provided', () => {
    const result = computePositionMetrics({
      entry: baseEntry,
      currentPrice: 201.3,
      today: new Date('2025-06-13'),
    });

    expect(result.ticker).toBe('AAPL');
    expect(result.strategy).toBe('consolidation_breakout');
    expect(result.signal_date).toBe('2025-06-01');
    expect(result.entry_price).toBe(195.5);
    expect(result.stop_price).toBe(187.0);
    expect(result.target_price).toBe(205.5);
    expect(result.current_price).toBe(201.3);
    expect(result.pnl_pct).toBeCloseTo(2.967, 2);
    expect(result.target_progress).toBeCloseTo(58.0, 0);
    expect(result.stop_distance).toBeCloseTo(7.1, 0);
    expect(result.days_held).toBe(12);
  });

  it('returns null for price-dependent fields when currentPrice is null', () => {
    const result = computePositionMetrics({
      entry: baseEntry,
      currentPrice: null,
      today: new Date('2025-06-13'),
    });

    expect(result.current_price).toBeNull();
    expect(result.pnl_pct).toBeNull();
    expect(result.target_progress).toBeNull();
    expect(result.stop_distance).toBeNull();
    expect(result.days_held).toBe(12);
  });

  it('returns pnl_pct null when entry_price is 0', () => {
    const entry = { ...baseEntry, entry_price: 0 };
    const result = computePositionMetrics({
      entry,
      currentPrice: 100,
      today: new Date('2025-06-13'),
    });

    expect(result.pnl_pct).toBeNull();
  });

  it('returns target_progress null when target_price === entry_price', () => {
    const entry = { ...baseEntry, target_price: 195.5 };
    const result = computePositionMetrics({
      entry,
      currentPrice: 200,
      today: new Date('2025-06-13'),
    });

    expect(result.target_progress).toBeNull();
  });

  it('returns stop_distance null when currentPrice is 0', () => {
    const result = computePositionMetrics({
      entry: baseEntry,
      currentPrice: 0,
      today: new Date('2025-06-13'),
    });

    expect(result.stop_distance).toBeNull();
  });
});
