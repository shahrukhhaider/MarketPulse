import { describe, it, expect } from 'vitest';
import { splitData } from '../../src/pipeline/walk-forward-validator.js';
import type { HistoricalDataPoint } from '../../src/types.js';

function makeDataPoints(count: number): HistoricalDataPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2024-01-${String((i % 28) + 1).padStart(2, '0')}`,
    open: 100 + i,
    high: 105 + i,
    low: 95 + i,
    close: 102 + i,
    volume: 1000000 + i * 100,
  }));
}

describe('splitData', () => {
  it('returns error when fewer than 100 data points', () => {
    const result = splitData(makeDataPoints(99));
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('Insufficient data');
    expect((result as { error: string }).error).toContain('99');
  });

  it('returns error for empty array', () => {
    const result = splitData([]);
    expect(result).toHaveProperty('error');
    expect((result as { error: string }).error).toContain('got 0');
  });

  it('splits exactly 100 data points into 70/30', () => {
    const data = makeDataPoints(100);
    const result = splitData(data);
    expect(result).not.toHaveProperty('error');
    const split = result as { inSample: HistoricalDataPoint[]; outOfSample: HistoricalDataPoint[] };
    expect(split.inSample).toHaveLength(70);
    expect(split.outOfSample).toHaveLength(30);
  });

  it('uses floor for non-round split index', () => {
    const data = makeDataPoints(101);
    const result = splitData(data);
    expect(result).not.toHaveProperty('error');
    const split = result as { inSample: HistoricalDataPoint[]; outOfSample: HistoricalDataPoint[] };
    // floor(0.7 * 101) = floor(70.7) = 70
    expect(split.inSample).toHaveLength(70);
    expect(split.outOfSample).toHaveLength(31);
  });

  it('preserves all data points (concatenation equals original)', () => {
    const data = makeDataPoints(200);
    const result = splitData(data);
    expect(result).not.toHaveProperty('error');
    const split = result as { inSample: HistoricalDataPoint[]; outOfSample: HistoricalDataPoint[] };
    const recombined = [...split.inSample, ...split.outOfSample];
    expect(recombined).toEqual(data);
  });

  it('handles large dataset correctly', () => {
    const data = makeDataPoints(1000);
    const result = splitData(data);
    expect(result).not.toHaveProperty('error');
    const split = result as { inSample: HistoricalDataPoint[]; outOfSample: HistoricalDataPoint[] };
    expect(split.inSample).toHaveLength(700);
    expect(split.outOfSample).toHaveLength(300);
  });
});
