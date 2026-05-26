import { describe, it, expect } from 'vitest';
import { validateUniverseExclusivity } from '../../src/utils/universe.js';

describe('validateUniverseExclusivity', () => {
  it('returns valid: true when no tickers overlap', () => {
    const result = validateUniverseExclusivity([
      { universe: 'large_cap', tickers: ['AAPL', 'MSFT', 'GOOG'] },
      { universe: 'mid_cap', tickers: ['DECK', 'POOL', 'WSM'] },
      { universe: 'small_cap', tickers: ['ACLS', 'CARG', 'DORM'] },
    ]);
    expect(result).toEqual({ valid: true });
  });

  it('returns valid: false when a ticker appears in two universes', () => {
    const result = validateUniverseExclusivity([
      { universe: 'large_cap', tickers: ['AAPL', 'MSFT'] },
      { universe: 'mid_cap', tickers: ['MSFT', 'DECK'] },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('MSFT');
      expect(result.error).toContain('large_cap');
      expect(result.error).toContain('mid_cap');
      expect(result.error).toContain('Cross-universe ticker conflict');
    }
  });

  it('reports multiple conflicting tickers', () => {
    const result = validateUniverseExclusivity([
      { universe: 'large_cap', tickers: ['AAPL', 'MSFT', 'GOOG'] },
      { universe: 'mid_cap', tickers: ['AAPL', 'GOOG', 'DECK'] },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('AAPL');
      expect(result.error).toContain('GOOG');
    }
  });

  it('returns valid: true for empty watchlists', () => {
    const result = validateUniverseExclusivity([]);
    expect(result).toEqual({ valid: true });
  });

  it('returns valid: true when watchlists have empty ticker arrays', () => {
    const result = validateUniverseExclusivity([
      { universe: 'large_cap', tickers: [] },
      { universe: 'mid_cap', tickers: [] },
    ]);
    expect(result).toEqual({ valid: true });
  });

  it('detects conflict across three universes', () => {
    const result = validateUniverseExclusivity([
      { universe: 'large_cap', tickers: ['AAPL'] },
      { universe: 'mid_cap', tickers: ['DECK'] },
      { universe: 'small_cap', tickers: ['AAPL'] },
    ]);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain('AAPL');
      expect(result.error).toContain('large_cap');
      expect(result.error).toContain('small_cap');
    }
  });
});
