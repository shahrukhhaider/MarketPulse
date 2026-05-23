import { describe, it, expect } from 'vitest';
import { extractSignalEntry, type ScanOutput } from '../../../src/signal-history/extractor.js';

function makeScanOutput(overrides: Partial<ScanOutput> = {}): ScanOutput {
  return {
    signals: [],
    openPositions: [],
    ...overrides,
  };
}

describe('extractSignalEntry', () => {
  it('returns a SignalEntry with the given date', () => {
    const result = extractSignalEntry(makeScanOutput(), '2025-01-15');
    expect(result.date).toBe('2025-01-15');
  });

  it('sets timestamp to current UTC ISO 8601 format', () => {
    const result = extractSignalEntry(makeScanOutput(), '2025-01-15');
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  it('always includes empty arrays when no matching signals or positions', () => {
    const result = extractSignalEntry(makeScanOutput(), '2025-01-15');
    expect(result.active).toEqual([]);
    expect(result.near).toEqual([]);
    expect(result.open_positions).toEqual([]);
  });

  describe('market_context extraction', () => {
    it('maps regime.market to market_context', () => {
      const scan = makeScanOutput({
        regime: {
          market: {
            spy_trend: 1,
            qqq_trend: 1,
            market_regime: 'bullish',
            vix: 14.2,
            vix_regime: 'low',
            breadth_pct: 68,
            breadth_label: 'broad',
            market_mood: 'bullish',
          },
          tickers: [],
          cachedAt: '2025-01-15',
          warnings: [],
        },
      });

      const result = extractSignalEntry(scan, '2025-01-15');
      expect(result.market_context).toEqual({
        market_mood: 'bullish',
        market_regime: 'bullish',
        vix: 14.2,
        vix_regime: 'low',
        breadth_pct: 68,
        breadth_label: 'broad',
      });
    });

    it('falls back to marketRegime when regime is missing', () => {
      const scan = makeScanOutput({
        marketRegime: {
          spy_trend: -1,
          qqq_trend: -1,
          market_regime: 'bearish',
          vix: 28.5,
          vix_regime: 'elevated',
          breadth_pct: 30,
          breadth_label: 'narrow',
          market_mood: 'bearish',
        },
      });

      const result = extractSignalEntry(scan, '2025-01-15');
      expect(result.market_context.market_mood).toBe('bearish');
      expect(result.market_context.vix).toBe(28.5);
    });

    it('defaults to null/unknown when no regime data exists', () => {
      const result = extractSignalEntry(makeScanOutput(), '2025-01-15');
      expect(result.market_context).toEqual({
        market_mood: 'unknown',
        market_regime: 'unknown',
        vix: null,
        vix_regime: 'unknown',
        breadth_pct: null,
        breadth_label: 'unknown',
      });
    });
  });

  describe('signal filtering', () => {
    const baseSignal = {
      date: '2025-01-15',
      entry: 100,
      stop: 95,
      risk_pct: 5,
      confidence: 0.8,
      reason: ['Test reason'],
    };

    it('maps active signals to the active array', () => {
      const scan = makeScanOutput({
        signals: [
          { ...baseSignal, ticker: 'AAPL', strategy: 'consolidation_breakout', signal: 'active' as const },
        ],
      });

      const result = extractSignalEntry(scan, '2025-01-15');
      expect(result.active).toHaveLength(1);
      expect(result.active[0].ticker).toBe('AAPL');
    });

    it('maps active_late signals to the active array', () => {
      const scan = makeScanOutput({
        signals: [
          { ...baseSignal, ticker: 'MSFT', strategy: 'trend_pullback', signal: 'active_late' as const },
        ],
      });

      const result = extractSignalEntry(scan, '2025-01-15');
      expect(result.active).toHaveLength(1);
      expect(result.active[0].ticker).toBe('MSFT');
    });

    it('maps near signals to the near array', () => {
      const scan = makeScanOutput({
        signals: [
          { ...baseSignal, ticker: 'GOOG', strategy: 'trend_pullback', signal: 'near' as const },
        ],
      });

      const result = extractSignalEntry(scan, '2025-01-15');
      expect(result.near).toHaveLength(1);
      expect(result.near[0].ticker).toBe('GOOG');
      expect(result.near[0].entry_trigger).toBe(100);
    });

    it('excludes forming, none, extended, and pressure signals', () => {
      const scan = makeScanOutput({
        signals: [
          { ...baseSignal, ticker: 'A', strategy: 's', signal: 'forming' as const },
          { ...baseSignal, ticker: 'B', strategy: 's', signal: 'none' as const },
          { ...baseSignal, ticker: 'C', strategy: 's', signal: 'extended' as const },
          { ...baseSignal, ticker: 'D', strategy: 's', signal: 'pressure' as const },
        ],
      });

      const result = extractSignalEntry(scan, '2025-01-15');
      expect(result.active).toHaveLength(0);
      expect(result.near).toHaveLength(0);
    });
  });

  describe('active signal field mapping', () => {
    it('derives target as entry + (entry - stop) * 2', () => {
      const scan = makeScanOutput({
        signals: [
          {
            ticker: 'AAPL',
            strategy: 'consolidation_breakout',
            signal: 'active' as const,
            date: '2025-01-15',
            entry: 185.50,
            stop: 180.00,
            risk_pct: 3,
            confidence: 0.82,
            reason: ['Breakout above range'],
            regimeState: {
              ticker: 'AAPL',
              ticker_regime: 'bullish' as const,
              market_regime: 'bullish' as const,
              volatility_regime: 'normal' as const,
              trend_strength: 'strong' as const,
              regime_score: 80,
              rs_rating: 87,
              warnings: [],
            },
          },
        ],
      });

      const result = extractSignalEntry(scan, '2025-01-15');
      const active = result.active[0];
      expect(active.entry).toBe(185.50);
      expect(active.stop).toBe(180.00);
      expect(active.target).toBe(185.50 + (185.50 - 180.00) * 2); // 196.50
      expect(active.confidence).toBe(0.82);
      expect(active.rs_rating).toBe(87);
      expect(active.rationale).toEqual(['Breakout above range']);
    });

    it('defaults rs_rating to 0 when regimeState is missing', () => {
      const scan = makeScanOutput({
        signals: [
          {
            ticker: 'AAPL',
            strategy: 'consolidation_breakout',
            signal: 'active' as const,
            date: '2025-01-15',
            entry: 100,
            stop: 95,
            risk_pct: 5,
            confidence: 0.7,
            reason: ['Test'],
          },
        ],
      });

      const result = extractSignalEntry(scan, '2025-01-15');
      expect(result.active[0].rs_rating).toBe(0);
    });
  });

  describe('near signal field mapping', () => {
    it('maps entry to entry_trigger and includes rs_rating', () => {
      const scan = makeScanOutput({
        signals: [
          {
            ticker: 'MSFT',
            strategy: 'trend_pullback',
            signal: 'near' as const,
            date: '2025-01-15',
            entry: 420,
            stop: 410,
            risk_pct: 2.4,
            confidence: 0.71,
            reason: ['Approaching 21-EMA support'],
            regimeState: {
              ticker: 'MSFT',
              ticker_regime: 'bullish' as const,
              market_regime: 'bullish' as const,
              volatility_regime: 'normal' as const,
              trend_strength: 'moderate' as const,
              regime_score: 70,
              rs_rating: 75,
              warnings: [],
            },
          },
        ],
      });

      const result = extractSignalEntry(scan, '2025-01-15');
      const near = result.near[0];
      expect(near.entry_trigger).toBe(420);
      expect(near.stop).toBe(410);
      expect(near.confidence).toBe(0.71);
      expect(near.rs_rating).toBe(75);
      expect(near.rationale).toEqual(['Approaching 21-EMA support']);
    });
  });

  describe('open_positions mapping', () => {
    it('maps PositionMetrics fields to OpenPosition', () => {
      const scan = makeScanOutput({
        openPositions: [
          {
            ticker: 'NVDA',
            strategy: 'consolidation_breakout',
            signal_date: '2025-01-10',
            entry_price: 890,
            stop_price: 860,
            target_price: 950,
            current_price: 920,
            pnl_pct: 3.5,
            target_progress: 50,
            stop_distance: 6.5,
            days_held: 5,
          },
        ],
      });

      const result = extractSignalEntry(scan, '2025-01-15');
      expect(result.open_positions).toHaveLength(1);
      const pos = result.open_positions[0];
      expect(pos.ticker).toBe('NVDA');
      expect(pos.strategy).toBe('consolidation_breakout');
      expect(pos.entry_price).toBe(890);
      expect(pos.entry_date).toBe('2025-01-10');
      expect(pos.stop).toBe(860);
      expect(pos.target).toBe(950);
      expect(pos.pnl_pct).toBe(3.5);
    });

    it('defaults pnl_pct to 0 when null', () => {
      const scan = makeScanOutput({
        openPositions: [
          {
            ticker: 'TSLA',
            strategy: 'trend_pullback',
            signal_date: '2025-01-12',
            entry_price: 250,
            stop_price: 240,
            target_price: 270,
            current_price: null,
            pnl_pct: null,
            target_progress: null,
            stop_distance: null,
            days_held: 3,
          },
        ],
      });

      const result = extractSignalEntry(scan, '2025-01-15');
      expect(result.open_positions[0].pnl_pct).toBe(0);
    });
  });
});
