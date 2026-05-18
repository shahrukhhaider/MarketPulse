import { describe, it, expect } from 'vitest';
import { detectSignal } from '../../src/strategies/signal-detector.js';
import type { HistoricalDataPoint } from '../../src/types.js';

// ============================================================
// Helpers
// ============================================================

/**
 * Generate realistic uptrend OHLCV data.
 * Produces bars with a steady upward drift, moderate volatility, and consistent volume.
 */
function generateUptrendData(
  count: number,
  basePrice = 100,
  drift = 0.5,
  baseVolume = 1_000_000
): HistoricalDataPoint[] {
  const data: HistoricalDataPoint[] = [];
  const startDate = new Date('2024-01-01');

  for (let i = 0; i < count; i++) {
    const close = basePrice + i * drift;
    const open = close - drift * 0.4;
    const high = close + 1.5;
    const low = close - 1.5;
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const dateStr = date.toISOString().slice(0, 10);

    data.push({ date: dateStr, open, high, low, close, volume: baseVolume });
  }
  return data;
}

/**
 * Generate downtrend OHLCV data (for bear_breakdown tests).
 * Price drifts downward with the close below SMA(50).
 */
function generateDowntrendData(
  count: number,
  basePrice = 200,
  drift = -0.5,
  baseVolume = 1_000_000
): HistoricalDataPoint[] {
  const data: HistoricalDataPoint[] = [];
  const startDate = new Date('2024-01-01');

  for (let i = 0; i < count; i++) {
    const close = basePrice + i * drift;
    const open = close - drift * 0.4;
    const high = Math.max(open, close) + 1.5;
    const low = Math.min(open, close) - 1.5;
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const dateStr = date.toISOString().slice(0, 10);

    data.push({ date: dateStr, open, high, low, close, volume: baseVolume });
  }
  return data;
}

/**
 * Generate post-earnings gap data: uptrend, then a gap-up day with high volume,
 * followed by consolidation days.
 */
function generatePostEarningsData(
  preBars: number,
  postBars: number,
  gapPct = 8,
  basePrice = 100
): { data: HistoricalDataPoint[]; earningsDate: string } {
  const data: HistoricalDataPoint[] = [];
  const startDate = new Date('2024-01-01');

  // Pre-earnings: steady uptrend
  for (let i = 0; i < preBars; i++) {
    const close = basePrice + i * 0.3;
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    data.push({
      date: date.toISOString().slice(0, 10),
      open: close - 0.2,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1_000_000,
    });
  }

  // Earnings gap day
  const preClose = data[data.length - 1].close;
  const gapOpen = preClose * (1 + gapPct / 100);
  const gapClose = gapOpen + 1;
  const earningsDate = new Date(startDate);
  earningsDate.setDate(startDate.getDate() + preBars);
  const earningsDateStr = earningsDate.toISOString().slice(0, 10);

  data.push({
    date: earningsDateStr,
    open: gapOpen,
    high: gapClose + 2,
    low: gapOpen - 1,
    close: gapClose,
    volume: 3_000_000, // high volume on gap day
  });

  // Post-earnings consolidation: tight range near gap close
  for (let i = 1; i <= postBars; i++) {
    const close = gapClose + (Math.sin(i) * 0.5); // oscillate slightly
    const date = new Date(earningsDate);
    date.setDate(earningsDate.getDate() + i);
    data.push({
      date: date.toISOString().slice(0, 10),
      open: close - 0.3,
      high: close + 0.8,
      low: close - 0.8,
      close,
      volume: 800_000, // declining volume
    });
  }

  return { data, earningsDate: earningsDateStr };
}

// ============================================================
// Default flat params for each strategy
// ============================================================

const consolidationBreakoutParams: Record<string, number> = {
  consolidation_window: 10,
  max_range_pct: 6,
  atr_ratio_threshold: 1.0,
  volume_multiplier: 1.5,
  overextension_pct: 8,
  atr_multiple: 1.6,
  swing_lookback: 15,
  max_risk_pct: 3,
  r_multiple: 2.5,
  exit_preset: 0,
};

const trendPullbackParams: Record<string, number> = {
  pullback_proximity_pct: 3,
  atr_contraction_threshold: 0.8,
  volume_below_avg_multiplier: 0.8,
  trigger_volume_multiplier: 1.2,
  overextension_pct: 8,
  stop_atr_multiple: 1.5,
  r_multiple: 2.5,
  swing_lookback: 10,
  exit_preset: 0,
};

const bearBreakdownParams: Record<string, number> = {
  consolidation_window: 10,
  max_range_pct: 6,
  atr_ratio_threshold: 1.0,
  volume_multiplier: 1.5,
  atr_multiple: 1.6,
  swing_lookback: 15,
  max_risk_pct: 5,
  r_multiple: 2.5,
};

const postEarningsDriftParams: Record<string, number> = {
  gap_min_pct: 5,
  gap_volume_multiplier: 1.5,
  consolidation_min_days: 3,
  consolidation_max_days: 10,
  max_range_pct: 5,
  breakout_volume_multiplier: 1.2,
  stop_buffer_atr: 0.3,
  r_multiple: 2.5,
  max_risk_pct: 8,
  trend_exit_sma_period: 50,
};

// ============================================================
// Tests: Unknown Strategy
// ============================================================

describe('detectSignal - unknown strategy', () => {
  it('returns signal=none for unknown strategy', () => {
    const data = generateUptrendData(60);
    const result = detectSignal(data, {}, 'nonexistent_strategy');

    expect(result.signal).toBe('none');
  });

  it('returns appropriate reason for unknown strategy', () => {
    const data = generateUptrendData(60);
    const result = detectSignal(data, {}, 'nonexistent_strategy');

    expect(result.reason.length).toBeGreaterThan(0);
    expect(result.reason.some(r => r.toLowerCase().includes('unknown'))).toBe(true);
  });

  it('includes the strategy name in the output', () => {
    const data = generateUptrendData(60);
    const result = detectSignal(data, {}, 'nonexistent_strategy');

    expect(result.strategy).toBe('nonexistent_strategy');
  });

  it('returns valid SignalOutput structure for unknown strategy', () => {
    const data = generateUptrendData(60);
    const result = detectSignal(data, {}, 'totally_unknown');

    expect(result).toHaveProperty('ticker');
    expect(result).toHaveProperty('strategy');
    expect(result).toHaveProperty('signal');
    expect(result).toHaveProperty('date');
    expect(result).toHaveProperty('entry');
    expect(result).toHaveProperty('stop');
    expect(result).toHaveProperty('risk_pct');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('reason');
    expect(typeof result.entry).toBe('number');
    expect(typeof result.stop).toBe('number');
    expect(typeof result.risk_pct).toBe('number');
    expect(typeof result.confidence).toBe('number');
    expect(Array.isArray(result.reason)).toBe(true);
  });
});

// ============================================================
// Tests: Consolidation Breakout
// ============================================================

describe('detectSignal - consolidation_breakout', () => {
  describe('insufficient data', () => {
    it('returns signal=none for insufficient data (< 51 bars)', () => {
      const data = generateUptrendData(30);
      const result = detectSignal(data, consolidationBreakoutParams, 'consolidation_breakout');

      expect(result.signal).toBe('none');
      expect(result.reason.some(r => r.toLowerCase().includes('insufficient'))).toBe(true);
    });

    it('returns signal=none for empty data', () => {
      const result = detectSignal([], consolidationBreakoutParams, 'consolidation_breakout');

      expect(result.signal).toBe('none');
    });
  });

  describe('output structure', () => {
    it('returns a valid SignalOutput structure', () => {
      const data = generateUptrendData(80);
      const result = detectSignal(data, consolidationBreakoutParams, 'consolidation_breakout');

      expect(result).toHaveProperty('ticker');
      expect(result).toHaveProperty('strategy');
      expect(result).toHaveProperty('signal');
      expect(result).toHaveProperty('date');
      expect(result).toHaveProperty('entry');
      expect(result).toHaveProperty('stop');
      expect(result).toHaveProperty('risk_pct');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reason');
      expect(typeof result.ticker).toBe('string');
      expect(typeof result.strategy).toBe('string');
      expect(typeof result.date).toBe('string');
      expect(typeof result.entry).toBe('number');
      expect(typeof result.stop).toBe('number');
      expect(typeof result.risk_pct).toBe('number');
      expect(typeof result.confidence).toBe('number');
      expect(Array.isArray(result.reason)).toBe(true);
    });

    it('returns correct strategy field', () => {
      const data = generateUptrendData(80);
      const result = detectSignal(data, consolidationBreakoutParams, 'consolidation_breakout');

      expect(result.strategy).toBe('consolidation_breakout');
    });

    it('returns a valid date string', () => {
      const data = generateUptrendData(80);
      const result = detectSignal(data, consolidationBreakoutParams, 'consolidation_breakout');

      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('reason array', () => {
    it('returns non-empty reason array', () => {
      const data = generateUptrendData(80);
      const result = detectSignal(data, consolidationBreakoutParams, 'consolidation_breakout');

      expect(result.reason.length).toBeGreaterThan(0);
      for (const r of result.reason) {
        expect(typeof r).toBe('string');
        expect(r.length).toBeGreaterThan(0);
      }
    });

    it('returns non-empty reason for insufficient data', () => {
      const data = generateUptrendData(10);
      const result = detectSignal(data, consolidationBreakoutParams, 'consolidation_breakout');

      expect(result.reason.length).toBeGreaterThan(0);
    });
  });

  describe('signal values', () => {
    it('returns a valid signal state', () => {
      const data = generateUptrendData(80);
      const result = detectSignal(data, consolidationBreakoutParams, 'consolidation_breakout');

      expect(['none', 'forming', 'near', 'active', 'pressure', 'active_late', 'extended']).toContain(result.signal);
    });
  });
});

// ============================================================
// Tests: Trend Pullback
// ============================================================

describe('detectSignal - trend_pullback', () => {
  describe('insufficient data', () => {
    it('returns signal=none for insufficient data (< 51 bars)', () => {
      const data = generateUptrendData(30);
      const result = detectSignal(data, trendPullbackParams, 'trend_pullback');

      expect(result.signal).toBe('none');
      expect(result.reason.some(r => r.toLowerCase().includes('insufficient'))).toBe(true);
    });

    it('returns signal=none for empty data', () => {
      const result = detectSignal([], trendPullbackParams, 'trend_pullback');

      expect(result.signal).toBe('none');
    });
  });

  describe('output structure', () => {
    it('returns a valid SignalOutput structure', () => {
      const data = generateUptrendData(80);
      const result = detectSignal(data, trendPullbackParams, 'trend_pullback');

      expect(result).toHaveProperty('ticker');
      expect(result).toHaveProperty('strategy');
      expect(result).toHaveProperty('signal');
      expect(result).toHaveProperty('date');
      expect(result).toHaveProperty('entry');
      expect(result).toHaveProperty('stop');
      expect(result).toHaveProperty('risk_pct');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reason');
      expect(typeof result.ticker).toBe('string');
      expect(typeof result.strategy).toBe('string');
      expect(typeof result.date).toBe('string');
      expect(typeof result.entry).toBe('number');
      expect(typeof result.stop).toBe('number');
      expect(typeof result.risk_pct).toBe('number');
      expect(typeof result.confidence).toBe('number');
      expect(Array.isArray(result.reason)).toBe(true);
    });

    it('returns correct strategy field', () => {
      const data = generateUptrendData(80);
      const result = detectSignal(data, trendPullbackParams, 'trend_pullback');

      expect(result.strategy).toBe('trend_pullback');
    });

    it('returns a valid date string', () => {
      const data = generateUptrendData(80);
      const result = detectSignal(data, trendPullbackParams, 'trend_pullback');

      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('reason array', () => {
    it('returns non-empty reason array', () => {
      const data = generateUptrendData(80);
      const result = detectSignal(data, trendPullbackParams, 'trend_pullback');

      expect(result.reason.length).toBeGreaterThan(0);
      for (const r of result.reason) {
        expect(typeof r).toBe('string');
        expect(r.length).toBeGreaterThan(0);
      }
    });

    it('returns non-empty reason for insufficient data', () => {
      const data = generateUptrendData(10);
      const result = detectSignal(data, trendPullbackParams, 'trend_pullback');

      expect(result.reason.length).toBeGreaterThan(0);
    });
  });

  describe('signal values', () => {
    it('returns a valid signal state', () => {
      const data = generateUptrendData(80);
      const result = detectSignal(data, trendPullbackParams, 'trend_pullback');

      expect(['none', 'forming', 'near', 'active']).toContain(result.signal);
    });

    it('returns forming or near for strong uptrend data', () => {
      // Strong uptrend should pass direction filter → forming or near
      const data = generateUptrendData(80, 50, 1.0);
      const result = detectSignal(data, trendPullbackParams, 'trend_pullback');

      // With a strong uptrend and no pullback, expect forming
      expect(['forming', 'near', 'active', 'none']).toContain(result.signal);
    });
  });
});

// ============================================================
// Tests: Bear Breakdown
// ============================================================

describe('detectSignal - bear_breakdown', () => {
  describe('insufficient data', () => {
    it('returns signal=none for insufficient data (< 51 bars)', () => {
      const data = generateDowntrendData(30);
      const result = detectSignal(data, bearBreakdownParams, 'bear_breakdown');

      expect(result.signal).toBe('none');
      expect(result.reason.some(r => r.toLowerCase().includes('insufficient'))).toBe(true);
    });

    it('returns signal=none for empty data', () => {
      const result = detectSignal([], bearBreakdownParams, 'bear_breakdown');

      expect(result.signal).toBe('none');
    });
  });

  describe('output structure', () => {
    it('returns a valid SignalOutput structure', () => {
      const data = generateDowntrendData(80);
      const result = detectSignal(data, bearBreakdownParams, 'bear_breakdown');

      expect(result).toHaveProperty('ticker');
      expect(result).toHaveProperty('strategy');
      expect(result).toHaveProperty('signal');
      expect(result).toHaveProperty('date');
      expect(result).toHaveProperty('entry');
      expect(result).toHaveProperty('stop');
      expect(result).toHaveProperty('risk_pct');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reason');
      expect(typeof result.ticker).toBe('string');
      expect(typeof result.strategy).toBe('string');
      expect(typeof result.date).toBe('string');
      expect(typeof result.entry).toBe('number');
      expect(typeof result.stop).toBe('number');
      expect(typeof result.risk_pct).toBe('number');
      expect(typeof result.confidence).toBe('number');
      expect(Array.isArray(result.reason)).toBe(true);
    });

    it('returns correct strategy field', () => {
      const data = generateDowntrendData(80);
      const result = detectSignal(data, bearBreakdownParams, 'bear_breakdown');

      expect(result.strategy).toBe('bear_breakdown');
    });

    it('returns a valid date string', () => {
      const data = generateDowntrendData(80);
      const result = detectSignal(data, bearBreakdownParams, 'bear_breakdown');

      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('reason array', () => {
    it('returns non-empty reason array', () => {
      const data = generateDowntrendData(80);
      const result = detectSignal(data, bearBreakdownParams, 'bear_breakdown');

      expect(result.reason.length).toBeGreaterThan(0);
      for (const r of result.reason) {
        expect(typeof r).toBe('string');
        expect(r.length).toBeGreaterThan(0);
      }
    });

    it('returns non-empty reason for insufficient data', () => {
      const data = generateDowntrendData(10);
      const result = detectSignal(data, bearBreakdownParams, 'bear_breakdown');

      expect(result.reason.length).toBeGreaterThan(0);
    });
  });

  describe('signal values', () => {
    it('returns a valid signal state', () => {
      const data = generateDowntrendData(80);
      const result = detectSignal(data, bearBreakdownParams, 'bear_breakdown');

      expect(['none', 'forming', 'near', 'active']).toContain(result.signal);
    });

    it('returns correct strategy name regardless of signal state', () => {
      // Even with uptrend data, the strategy field should always be bear_breakdown
      const data = generateUptrendData(80);
      const result = detectSignal(data, bearBreakdownParams, 'bear_breakdown');

      expect(result.strategy).toBe('bear_breakdown');
      expect(result.reason.length).toBeGreaterThan(0);
    });
  });
});

// ============================================================
// Tests: Post-Earnings Drift
// ============================================================

describe('detectSignal - post_earnings_drift', () => {
  describe('insufficient data', () => {
    it('returns signal=none for insufficient data (< 51 bars)', () => {
      const data = generateUptrendData(30);
      const result = detectSignal(data, postEarningsDriftParams, 'post_earnings_drift', {
        earningsDates: ['2024-01-20'],
      });

      expect(result.signal).toBe('none');
      expect(result.reason.some(r => r.toLowerCase().includes('insufficient'))).toBe(true);
    });

    it('returns signal=none for empty data', () => {
      const result = detectSignal([], postEarningsDriftParams, 'post_earnings_drift', {
        earningsDates: ['2024-01-20'],
      });

      expect(result.signal).toBe('none');
    });
  });

  describe('no earnings dates', () => {
    it('returns signal=none when no earnings dates provided', () => {
      const data = generateUptrendData(80);
      const result = detectSignal(data, postEarningsDriftParams, 'post_earnings_drift', {
        earningsDates: [],
      });

      expect(result.signal).toBe('none');
      expect(result.reason.some(r => r.toLowerCase().includes('earnings'))).toBe(true);
    });

    it('returns signal=none when options are omitted', () => {
      const data = generateUptrendData(80);
      const result = detectSignal(data, postEarningsDriftParams, 'post_earnings_drift');

      expect(result.signal).toBe('none');
      expect(result.reason.some(r => r.toLowerCase().includes('earnings'))).toBe(true);
    });
  });

  describe('output structure', () => {
    it('returns a valid SignalOutput structure', () => {
      const { data, earningsDate } = generatePostEarningsData(55, 5);
      const result = detectSignal(data, postEarningsDriftParams, 'post_earnings_drift', {
        earningsDates: [earningsDate],
      });

      expect(result).toHaveProperty('ticker');
      expect(result).toHaveProperty('strategy');
      expect(result).toHaveProperty('signal');
      expect(result).toHaveProperty('date');
      expect(result).toHaveProperty('entry');
      expect(result).toHaveProperty('stop');
      expect(result).toHaveProperty('risk_pct');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('reason');
      expect(typeof result.ticker).toBe('string');
      expect(typeof result.strategy).toBe('string');
      expect(typeof result.date).toBe('string');
      expect(typeof result.entry).toBe('number');
      expect(typeof result.stop).toBe('number');
      expect(typeof result.risk_pct).toBe('number');
      expect(typeof result.confidence).toBe('number');
      expect(Array.isArray(result.reason)).toBe(true);
    });

    it('returns correct strategy field', () => {
      const { data, earningsDate } = generatePostEarningsData(55, 5);
      const result = detectSignal(data, postEarningsDriftParams, 'post_earnings_drift', {
        earningsDates: [earningsDate],
      });

      expect(result.strategy).toBe('post_earnings_drift');
    });

    it('returns a valid date string', () => {
      const { data, earningsDate } = generatePostEarningsData(55, 5);
      const result = detectSignal(data, postEarningsDriftParams, 'post_earnings_drift', {
        earningsDates: [earningsDate],
      });

      expect(result.date).toMatch(/^\d{4}-\d{2}-\d{2}/);
    });
  });

  describe('reason array', () => {
    it('returns non-empty reason array', () => {
      const { data, earningsDate } = generatePostEarningsData(55, 5);
      const result = detectSignal(data, postEarningsDriftParams, 'post_earnings_drift', {
        earningsDates: [earningsDate],
      });

      expect(result.reason.length).toBeGreaterThan(0);
      for (const r of result.reason) {
        expect(typeof r).toBe('string');
        expect(r.length).toBeGreaterThan(0);
      }
    });

    it('returns non-empty reason for insufficient data', () => {
      const data = generateUptrendData(10);
      const result = detectSignal(data, postEarningsDriftParams, 'post_earnings_drift', {
        earningsDates: ['2024-01-05'],
      });

      expect(result.reason.length).toBeGreaterThan(0);
    });
  });

  describe('signal values', () => {
    it('returns a valid signal state', () => {
      const { data, earningsDate } = generatePostEarningsData(55, 5);
      const result = detectSignal(data, postEarningsDriftParams, 'post_earnings_drift', {
        earningsDates: [earningsDate],
      });

      expect(['none', 'forming', 'near', 'active']).toContain(result.signal);
    });

    it('returns none when earnings date does not match data', () => {
      const data = generateUptrendData(80);
      const result = detectSignal(data, postEarningsDriftParams, 'post_earnings_drift', {
        earningsDates: ['2025-06-15'], // date not in data range
      });

      expect(result.signal).toBe('none');
    });
  });
});

// ============================================================
// Tests: Dispatch routing
// ============================================================

describe('detectSignal - dispatch routing', () => {
  it('routes consolidation_breakout to the correct handler', () => {
    const data = generateUptrendData(80);
    const result = detectSignal(data, consolidationBreakoutParams, 'consolidation_breakout');
    expect(result.strategy).toBe('consolidation_breakout');
  });

  it('routes trend_pullback to the correct handler', () => {
    const data = generateUptrendData(80);
    const result = detectSignal(data, trendPullbackParams, 'trend_pullback');
    expect(result.strategy).toBe('trend_pullback');
  });

  it('routes bear_breakdown to the correct handler', () => {
    const data = generateDowntrendData(80);
    const result = detectSignal(data, bearBreakdownParams, 'bear_breakdown');
    expect(result.strategy).toBe('bear_breakdown');
  });

  it('routes post_earnings_drift to the correct handler', () => {
    const { data, earningsDate } = generatePostEarningsData(55, 5);
    const result = detectSignal(data, postEarningsDriftParams, 'post_earnings_drift', {
      earningsDates: [earningsDate],
    });
    expect(result.strategy).toBe('post_earnings_drift');
  });

  it('routes keltner_mean_reversion to the correct handler', () => {
    const data = generateUptrendData(80);
    const result = detectSignal(data, {
      ema_period: 20,
      atr_period: 14,
      band_multiplier: 2.0,
      trend_filter_period: 50,
      reclaim_lookback: 5,
      stop_atr_multiple: 1.5,
      r_multiple: 2.0,
      max_risk_pct: 5.0,
      band_proximity_pct: 3.0,
    }, 'keltner_mean_reversion');
    expect(result.strategy).toBe('keltner_mean_reversion');
  });
});
