import { describe, it, expect } from 'vitest';
import {
  ema,
  atr,
  sma,
  swingLow,
  rsi,
  returnNd,
  highest,
  lowest,
  avgVolume,
  distanceToSma,
  highestHigh,
  range_pct,
  atr_ratio,
  sma_slope,
  macd,
  obv,
  obvSlope,
  adx,
} from '../../src/indicators/indicators.js';
import type { HistoricalDataPoint } from '../../src/types.js';

function makeDataPoint(overrides: Partial<HistoricalDataPoint> = {}): HistoricalDataPoint {
  return {
    date: '2024-01-01',
    open: 10,
    high: 12,
    low: 8,
    close: 10,
    volume: 1000,
    ...overrides,
  };
}

describe('ema', () => {
  it('returns undefined when prices.length < period', () => {
    expect(ema([1, 2], 3)).toBeUndefined();
  });

  it('returns undefined when period < 1', () => {
    expect(ema([1, 2, 3], 0)).toBeUndefined();
    expect(ema([1, 2, 3], -1)).toBeUndefined();
  });

  it('returns SMA when prices.length === period (no smoothing needed)', () => {
    // SMA of [2, 4, 6] = 4
    expect(ema([2, 4, 6], 3)).toBe(4);
  });

  it('correctly computes EMA for known values (period=3, prices=[2,4,6,8,10])', () => {
    // Multiplier = 2/(3+1) = 0.5
    // Seed = SMA(2,4,6) = 4
    // After price 8: (8 - 4) * 0.5 + 4 = 6
    // After price 10: (10 - 6) * 0.5 + 6 = 8
    expect(ema([2, 4, 6, 8, 10], 3)).toBe(8);
  });

  it('handles single-element array with period=1', () => {
    // Seed = SMA of first 1 value = 5, no further iteration
    expect(ema([5], 1)).toBe(5);
  });

  it('handles period=1 with multiple prices', () => {
    // Multiplier = 2/(1+1) = 1.0
    // Seed = prices[0] = 3
    // After price 7: (7 - 3) * 1 + 3 = 7
    // After price 10: (10 - 7) * 1 + 7 = 10
    // With multiplier=1, EMA always equals the latest price
    expect(ema([3, 7, 10], 1)).toBe(10);
  });
});

describe('atr', () => {
  it('returns undefined for insufficient data', () => {
    const points = [
      makeDataPoint({ high: 12, low: 8, close: 10 }),
      makeDataPoint({ high: 14, low: 9, close: 11 }),
      makeDataPoint({ high: 15, low: 10, close: 13 }),
    ];
    // period=3 requires at least 4 data points
    expect(atr(points, 3)).toBeUndefined();
  });

  it('correctly computes ATR for known OHLCV data', () => {
    const points: HistoricalDataPoint[] = [
      makeDataPoint({ high: 12, low: 8, close: 10 }),
      makeDataPoint({ high: 14, low: 9, close: 11 }),
      makeDataPoint({ high: 15, low: 10, close: 13 }),
      makeDataPoint({ high: 16, low: 11, close: 14 }),
    ];
    // period=3, start = 4 - 3 - 1 = 0
    // TR[1]: max(14-9, |14-10|, |9-10|) = max(5, 4, 1) = 5
    // TR[2]: max(15-10, |15-11|, |10-11|) = max(5, 4, 1) = 5
    // TR[3]: max(16-11, |16-13|, |11-13|) = max(5, 3, 2) = 5
    // ATR = (5+5+5)/3 = 5
    expect(atr(points, 3)).toBe(5);
  });

  it('handles gaps where high-prevClose or low-prevClose dominate', () => {
    const points: HistoricalDataPoint[] = [
      makeDataPoint({ high: 50, low: 48, close: 49 }),
      makeDataPoint({ high: 55, low: 53, close: 54 }), // gap up: |55-49|=6 > 55-53=2
      makeDataPoint({ high: 56, low: 54, close: 55 }),
    ];
    // period=2, start = 3 - 2 - 1 = 0
    // TR[1]: max(55-53, |55-49|, |53-49|) = max(2, 6, 4) = 6
    // TR[2]: max(56-54, |56-54|, |54-54|) = max(2, 2, 0) = 2
    // ATR = (6+2)/2 = 4
    expect(atr(points, 2)).toBe(4);
  });
});

describe('sma', () => {
  it('returns undefined for insufficient data', () => {
    expect(sma([10, 20], 3)).toBeUndefined();
  });

  it('returns undefined when prices array is empty', () => {
    expect(sma([], 1)).toBeUndefined();
  });

  it('correctly computes simple average of last N prices', () => {
    // Last 3 of [10, 20, 30, 40, 50] = [30, 40, 50], avg = 40
    expect(sma([10, 20, 30, 40, 50], 3)).toBe(40);
  });

  it('uses only the last period prices, not all prices', () => {
    // Last 2 of [100, 1, 2] = [1, 2], avg = 1.5
    expect(sma([100, 1, 2], 2)).toBe(1.5);
  });

  it('returns the single value when period equals array length of 1', () => {
    expect(sma([42], 1)).toBe(42);
  });
});

describe('swingLow', () => {
  it('returns the lowest low over the lookback window', () => {
    const points: HistoricalDataPoint[] = [
      makeDataPoint({ low: 15 }),
      makeDataPoint({ low: 12 }),
      makeDataPoint({ low: 18 }),
      makeDataPoint({ low: 10 }),
      makeDataPoint({ low: 14 }),
    ];
    // lookback=3: last 3 points have lows [18, 10, 14] → min = 10
    expect(swingLow(points, 3)).toBe(10);
  });

  it('returns undefined for insufficient data', () => {
    const points: HistoricalDataPoint[] = [
      makeDataPoint({ low: 10 }),
      makeDataPoint({ low: 12 }),
    ];
    expect(swingLow(points, 3)).toBeUndefined();
  });

  it('returns the single low when lookback equals array length', () => {
    const points: HistoricalDataPoint[] = [
      makeDataPoint({ low: 5 }),
      makeDataPoint({ low: 3 }),
      makeDataPoint({ low: 7 }),
    ];
    // lookback=3: all points, min low = 3
    expect(swingLow(points, 3)).toBe(3);
  });

  it('handles all equal lows', () => {
    const points: HistoricalDataPoint[] = [
      makeDataPoint({ low: 20 }),
      makeDataPoint({ low: 20 }),
      makeDataPoint({ low: 20 }),
    ];
    expect(swingLow(points, 2)).toBe(20);
  });
});

describe('rsi', () => {
  it('returns undefined when prices.length < period + 1', () => {
    expect(rsi([10, 12, 14], 3)).toBeUndefined();
    expect(rsi([10, 12, 14, 16], 4)).toBeUndefined();
  });

  it('returns 100 when all changes are gains (avgLoss === 0)', () => {
    // prices = [10, 12, 14, 16, 18], period=3
    // start = 5 - 3 - 1 = 1, changes: 14-12=2, 16-14=2, 18-16=2 (all gains)
    expect(rsi([10, 12, 14, 16, 18], 3)).toBe(100);
  });

  it('correctly computes RSI for known values', () => {
    // prices = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84], period=7
    // start = 9 - 7 - 1 = 1
    // Changes from index 2..8:
    //   44.09-44.34=-0.25(loss), 43.61-44.09=-0.48(loss),
    //   44.33-43.61=0.72(gain), 44.83-44.33=0.50(gain),
    //   45.10-44.83=0.27(gain), 45.42-45.10=0.32(gain), 45.84-45.42=0.42(gain)
    // avgGain = (0.72+0.50+0.27+0.32+0.42)/7 = 0.31857...
    // avgLoss = (0.25+0.48)/7 = 0.10428...
    // RS = 3.05479..., RSI = 100 - 100/(1+RS) ≈ 75.3378
    const prices = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84];
    const result = rsi(prices, 7);
    expect(result).toBeCloseTo(75.3378, 2);
  });

  it('handles all losses (RSI near 0)', () => {
    // prices = [50, 48, 46, 44, 42], period=3
    // start = 5 - 3 - 1 = 1, changes: 46-48=-2, 44-46=-2, 42-44=-2 (all losses)
    // avgGain = 0, avgLoss = 2, RS = 0, RSI = 100 - 100/(1+0) = 0
    expect(rsi([50, 48, 46, 44, 42], 3)).toBe(0);
  });
});

describe('returnNd', () => {
  it('returns undefined when prices.length < period + 1', () => {
    expect(returnNd([100, 110], 2)).toBeUndefined();
  });

  it('returns undefined when base price is 0', () => {
    expect(returnNd([0, 50, 100], 2)).toBeUndefined();
  });

  it('correctly computes percentage return', () => {
    // prices = [100, 105, 110], period=2
    // base = prices[3-1-2] = prices[0] = 100, current = 110
    // return = ((110-100)/100)*100 = 10
    expect(returnNd([100, 105, 110], 2)).toBe(10);
  });

  it('handles negative returns', () => {
    // prices = [100, 80, 50], period=2
    // base = prices[0] = 100, current = 50
    // return = ((50-100)/100)*100 = -50
    expect(returnNd([100, 80, 50], 2)).toBe(-50);
  });

  it('uses only the last period+1 prices for calculation', () => {
    // prices = [200, 100, 105, 110], period=2
    // base = prices[4-1-2] = prices[1] = 100, current = 110
    // return = ((110-100)/100)*100 = 10
    expect(returnNd([200, 100, 105, 110], 2)).toBe(10);
  });
});

describe('highest', () => {
  it('returns undefined when prices.length < period', () => {
    expect(highest([10, 20], 3)).toBeUndefined();
  });

  it('returns the highest value in the last N prices', () => {
    // Last 3 of [5, 100, 30, 40, 50] = [30, 40, 50] → max = 50
    expect(highest([5, 100, 30, 40, 50], 3)).toBe(50);
  });

  it('finds max that is not the last element', () => {
    // Last 3 of [1, 2, 99, 10, 20] = [99, 10, 20] → max = 99
    expect(highest([1, 2, 99, 10, 20], 3)).toBe(99);
  });

  it('handles all equal values', () => {
    expect(highest([5, 5, 5, 5], 3)).toBe(5);
  });

  it('handles negative values', () => {
    expect(highest([-10, -5, -20, -3], 3)).toBe(-3);
  });
});

describe('lowest', () => {
  it('returns undefined when prices.length < period', () => {
    expect(lowest([10, 20], 3)).toBeUndefined();
  });

  it('returns the lowest value in the last N prices', () => {
    // Last 3 of [100, 1, 30, 40, 50] = [30, 40, 50] → min = 30
    expect(lowest([100, 1, 30, 40, 50], 3)).toBe(30);
  });

  it('finds min that is not the last element', () => {
    // Last 3 of [50, 60, 2, 70, 80] = [2, 70, 80] → min = 2
    expect(lowest([50, 60, 2, 70, 80], 3)).toBe(2);
  });

  it('handles all equal values', () => {
    expect(lowest([7, 7, 7, 7], 2)).toBe(7);
  });

  it('handles negative values', () => {
    expect(lowest([-1, -5, -3, -2], 3)).toBe(-5);
  });
});

describe('avgVolume', () => {
  it('returns undefined when dataPoints.length < period', () => {
    const points = [makeDataPoint({ volume: 1000 }), makeDataPoint({ volume: 2000 })];
    expect(avgVolume(points, 3)).toBeUndefined();
  });

  it('correctly computes average volume over last N points', () => {
    const points = [
      makeDataPoint({ volume: 100 }),
      makeDataPoint({ volume: 200 }),
      makeDataPoint({ volume: 300 }),
      makeDataPoint({ volume: 400 }),
      makeDataPoint({ volume: 500 }),
    ];
    // Last 3: [300, 400, 500], avg = 400
    expect(avgVolume(points, 3)).toBe(400);
  });

  it('uses all points when period equals array length', () => {
    const points = [
      makeDataPoint({ volume: 1000 }),
      makeDataPoint({ volume: 2000 }),
      makeDataPoint({ volume: 3000 }),
    ];
    // avg = (1000+2000+3000)/3 = 2000
    expect(avgVolume(points, 3)).toBe(2000);
  });
});

describe('distanceToSma', () => {
  it('returns undefined when prices.length < smaPeriod', () => {
    expect(distanceToSma([10, 20], 3)).toBeUndefined();
  });

  it('correctly computes percentage distance from price to SMA', () => {
    // prices = [10, 20, 30], smaPeriod=3
    // sma = (10+20+30)/3 = 20, current = 30
    // distance = ((30-20)/20)*100 = 50
    expect(distanceToSma([10, 20, 30], 3)).toBe(50);
  });

  it('returns negative distance when price is below SMA', () => {
    // prices = [30, 20, 10], smaPeriod=3
    // sma = (30+20+10)/3 = 20, current = 10
    // distance = ((10-20)/20)*100 = -50
    expect(distanceToSma([30, 20, 10], 3)).toBe(-50);
  });

  it('returns 0 when price equals SMA', () => {
    // prices = [10, 20, 15], smaPeriod=3
    // sma = (10+20+15)/3 = 15, current = 15
    // distance = ((15-15)/15)*100 = 0
    expect(distanceToSma([10, 20, 15], 3)).toBe(0);
  });

  it('returns undefined when SMA is 0', () => {
    // prices = [-5, 0, 5], smaPeriod=3
    // sma = (-5+0+5)/3 = 0 → undefined
    expect(distanceToSma([-5, 0, 5], 3)).toBeUndefined();
  });
});

describe('highestHigh', () => {
  it('returns undefined when dataPoints.length < lookback', () => {
    const points = [makeDataPoint({ high: 15 }), makeDataPoint({ high: 20 })];
    expect(highestHigh(points, 3)).toBeUndefined();
  });

  it('returns the highest high over the lookback window', () => {
    const points = [
      makeDataPoint({ high: 50 }),
      makeDataPoint({ high: 30 }),
      makeDataPoint({ high: 45 }),
      makeDataPoint({ high: 35 }),
      makeDataPoint({ high: 40 }),
    ];
    // lookback=3: last 3 highs = [45, 35, 40] → max = 45
    expect(highestHigh(points, 3)).toBe(45);
  });

  it('handles single-element lookback', () => {
    const points = [
      makeDataPoint({ high: 10 }),
      makeDataPoint({ high: 25 }),
      makeDataPoint({ high: 20 }),
    ];
    // lookback=1: last 1 high = [20]
    expect(highestHigh(points, 1)).toBe(20);
  });
});

describe('range_pct', () => {
  it('returns undefined when dataPoints.length < window', () => {
    const points = [makeDataPoint(), makeDataPoint()];
    expect(range_pct(points, 3)).toBeUndefined();
  });

  it('correctly computes (highestHigh - lowestLow) / close', () => {
    const points = [
      makeDataPoint({ high: 12, low: 8, close: 10 }),
      makeDataPoint({ high: 15, low: 9, close: 11 }),
      makeDataPoint({ high: 11, low: 7, close: 10 }),
    ];
    // window=3: highestHigh=15, swingLow(lowestLow)=7, close=10
    // range_pct = (15-7)/10 = 0.8
    expect(range_pct(points, 3)).toBe(0.8);
  });

  it('returns undefined when close is 0', () => {
    const points = [
      makeDataPoint({ high: 5, low: 1, close: 3 }),
      makeDataPoint({ high: 6, low: 2, close: 4 }),
      makeDataPoint({ high: 4, low: 1, close: 0 }),
    ];
    expect(range_pct(points, 3)).toBeUndefined();
  });
});

describe('atr_ratio', () => {
  it('returns undefined when insufficient data for short ATR', () => {
    // Need at least shortPeriod+1 data points for short ATR
    const points = [makeDataPoint(), makeDataPoint()];
    expect(atr_ratio(points, 3, 5)).toBeUndefined();
  });

  it('returns undefined when insufficient data for long ATR', () => {
    // 4 points: enough for shortPeriod=3 (needs 4), not enough for longPeriod=5 (needs 6)
    const points = Array.from({ length: 4 }, () => makeDataPoint());
    expect(atr_ratio(points, 3, 5)).toBeUndefined();
  });

  it('correctly computes ratio of short ATR to long ATR', () => {
    // Create data where we can compute both ATRs
    const points: HistoricalDataPoint[] = [
      makeDataPoint({ high: 12, low: 8, close: 10 }),
      makeDataPoint({ high: 14, low: 9, close: 11 }),
      makeDataPoint({ high: 15, low: 10, close: 13 }),
      makeDataPoint({ high: 16, low: 11, close: 14 }),
      makeDataPoint({ high: 17, low: 12, close: 15 }),
      makeDataPoint({ high: 18, low: 13, close: 16 }),
      makeDataPoint({ high: 19, low: 14, close: 17 }),
    ];
    // shortPeriod=2, longPeriod=3
    // shortATR: start=7-2-1=4, TR[5]=max(18-13,|18-15|,|13-15|)=max(5,3,2)=5, TR[6]=max(19-14,|19-16|,|14-16|)=max(5,3,2)=5, ATR=5
    // longATR: start=7-3-1=3, TR[4]=max(17-12,|17-14|,|12-14|)=max(5,3,2)=5, TR[5]=5, TR[6]=5, ATR=5
    // ratio = 5/5 = 1
    expect(atr_ratio(points, 2, 3)).toBe(1);
  });

  it('returns ratio != 1 when ATRs differ', () => {
    // Create data with varying volatility
    const points: HistoricalDataPoint[] = [
      makeDataPoint({ high: 12, low: 8, close: 10 }),   // TR base
      makeDataPoint({ high: 14, low: 9, close: 11 }),   // TR=max(5,4,1)=5
      makeDataPoint({ high: 15, low: 10, close: 13 }),  // TR=max(5,4,1)=5
      makeDataPoint({ high: 16, low: 11, close: 14 }),  // TR=max(5,3,2)=5
      makeDataPoint({ high: 20, low: 10, close: 18 }),  // TR=max(10,6,4)=10
    ];
    // shortPeriod=1: start=5-1-1=3, TR[4]=max(20-10,|20-14|,|10-14|)=max(10,6,4)=10, ATR=10
    // longPeriod=3: start=5-3-1=1, TR[2]=max(15-10,|15-11|,|10-11|)=max(5,4,1)=5, TR[3]=max(16-11,|16-13|,|11-13|)=max(5,3,2)=5, TR[4]=10, ATR=(5+5+10)/3=6.666...
    // ratio = 10 / 6.666... = 1.5
    expect(atr_ratio(points, 1, 3)).toBeCloseTo(1.5, 4);
  });
});

describe('sma_slope', () => {
  it('returns undefined when prices.length < period + 1', () => {
    expect(sma_slope([10, 20, 30], 3)).toBeUndefined();
  });

  it('returns true when SMA is rising', () => {
    // prices = [10, 20, 30, 40], period=3
    // currentSma = sma([10,20,30,40], 3) = (20+30+40)/3 = 30
    // previousSma = sma([10,20,30], 3) = (10+20+30)/3 = 20
    // 30 > 20 → true
    expect(sma_slope([10, 20, 30, 40], 3)).toBe(true);
  });

  it('returns false when SMA is falling', () => {
    // prices = [40, 30, 20, 10], period=3
    // currentSma = sma([40,30,20,10], 3) = (30+20+10)/3 = 20
    // previousSma = sma([40,30,20], 3) = (40+30+20)/3 = 30
    // 20 > 30 → false
    expect(sma_slope([40, 30, 20, 10], 3)).toBe(false);
  });

  it('returns false when SMA is flat (equal)', () => {
    // prices = [10, 20, 30, 20], period=3
    // currentSma = (20+30+20)/3 = 23.333...
    // previousSma = (10+20+30)/3 = 20
    // 23.33 > 20 → true... let's use [20, 10, 30, 10]
    // currentSma = (10+30+10)/3 = 16.666
    // previousSma = (20+10+30)/3 = 20
    // 16.66 > 20 → false
    // For truly flat: [10, 20, 10, 20], period=3
    // currentSma = (20+10+20)/3 = 16.666
    // previousSma = (10+20+10)/3 = 13.333
    // Still not flat. Use [5, 5, 5, 5]:
    // currentSma = 5, previousSma = 5 → false (not strictly greater)
    expect(sma_slope([5, 5, 5, 5], 3)).toBe(false);
  });
});

describe('macd', () => {
  it('returns undefined when prices.length < 35', () => {
    const prices = Array.from({ length: 34 }, (_, i) => 100 + i);
    expect(macd(prices)).toBeUndefined();
  });

  it('returns an object with macdLine, signalLine, and histogram', () => {
    // Generate 40 prices with an uptrend
    const prices = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);
    const result = macd(prices);
    expect(result).toBeDefined();
    expect(result).toHaveProperty('macdLine');
    expect(result).toHaveProperty('signalLine');
    expect(result).toHaveProperty('histogram');
  });

  it('histogram equals macdLine minus signalLine', () => {
    const prices = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 5) * 10);
    const result = macd(prices);
    expect(result).toBeDefined();
    expect(result!.histogram).toBeCloseTo(result!.macdLine - result!.signalLine, 10);
  });

  it('macdLine is positive in a strong uptrend', () => {
    // Strong uptrend: fast EMA > slow EMA → positive MACD line
    const prices = Array.from({ length: 50 }, (_, i) => 100 + i * 2);
    const result = macd(prices);
    expect(result).toBeDefined();
    expect(result!.macdLine).toBeGreaterThan(0);
  });

  it('macdLine is negative in a strong downtrend', () => {
    // Strong downtrend: fast EMA < slow EMA → negative MACD line
    const prices = Array.from({ length: 50 }, (_, i) => 200 - i * 2);
    const result = macd(prices);
    expect(result).toBeDefined();
    expect(result!.macdLine).toBeLessThan(0);
  });
});

describe('obv', () => {
  it('returns empty array for empty input', () => {
    expect(obv([])).toEqual([]);
  });

  it('returns [0] for single data point', () => {
    expect(obv([makeDataPoint()])).toEqual([0]);
  });

  it('correctly computes OBV series', () => {
    const points: HistoricalDataPoint[] = [
      makeDataPoint({ close: 10, volume: 100 }),
      makeDataPoint({ close: 12, volume: 200 }),  // up → +200
      makeDataPoint({ close: 11, volume: 150 }),  // down → -150
      makeDataPoint({ close: 11, volume: 300 }),  // flat → +0
      makeDataPoint({ close: 13, volume: 250 }),  // up → +250
    ];
    // OBV: [0, 200, 50, 50, 300]
    expect(obv(points)).toEqual([0, 200, 50, 50, 300]);
  });

  it('handles all prices going up', () => {
    const points: HistoricalDataPoint[] = [
      makeDataPoint({ close: 10, volume: 100 }),
      makeDataPoint({ close: 11, volume: 200 }),
      makeDataPoint({ close: 12, volume: 300 }),
    ];
    // OBV: [0, 200, 500]
    expect(obv(points)).toEqual([0, 200, 500]);
  });

  it('handles all prices going down', () => {
    const points: HistoricalDataPoint[] = [
      makeDataPoint({ close: 12, volume: 100 }),
      makeDataPoint({ close: 11, volume: 200 }),
      makeDataPoint({ close: 10, volume: 300 }),
    ];
    // OBV: [0, -200, -500]
    expect(obv(points)).toEqual([0, -200, -500]);
  });
});

describe('obvSlope', () => {
  it('returns undefined when dataPoints.length < lookback + 1', () => {
    const points = [makeDataPoint(), makeDataPoint()];
    expect(obvSlope(points, 2)).toBeUndefined();
  });

  it('returns true when OBV is rising over lookback', () => {
    const points: HistoricalDataPoint[] = [
      makeDataPoint({ close: 10, volume: 100 }),
      makeDataPoint({ close: 11, volume: 200 }),  // OBV: 200
      makeDataPoint({ close: 12, volume: 300 }),  // OBV: 500
      makeDataPoint({ close: 13, volume: 400 }),  // OBV: 900
    ];
    // OBV series: [0, 200, 500, 900]
    // lookback=2: OBV[3]=900 > OBV[1]=200 → true
    expect(obvSlope(points, 2)).toBe(true);
  });

  it('returns false when OBV is falling over lookback', () => {
    const points: HistoricalDataPoint[] = [
      makeDataPoint({ close: 13, volume: 100 }),
      makeDataPoint({ close: 12, volume: 200 }),  // OBV: -200
      makeDataPoint({ close: 11, volume: 300 }),  // OBV: -500
      makeDataPoint({ close: 10, volume: 400 }),  // OBV: -900
    ];
    // OBV series: [0, -200, -500, -900]
    // lookback=2: OBV[3]=-900 > OBV[1]=-200 → false
    expect(obvSlope(points, 2)).toBe(false);
  });

  it('returns false when OBV is flat', () => {
    const points: HistoricalDataPoint[] = [
      makeDataPoint({ close: 10, volume: 100 }),
      makeDataPoint({ close: 10, volume: 200 }),  // flat → OBV: 0
      makeDataPoint({ close: 10, volume: 300 }),  // flat → OBV: 0
    ];
    // OBV series: [0, 0, 0]
    // lookback=1: OBV[2]=0 > OBV[1]=0 → false
    expect(obvSlope(points, 1)).toBe(false);
  });
});

describe('adx', () => {
  it('returns undefined when dataPoints.length < 2 * period', () => {
    const points = Array.from({ length: 9 }, () => makeDataPoint());
    expect(adx(points, 5)).toBeUndefined();
  });

  it('returns a value between 0 and 100', () => {
    // Create trending data with enough points
    const points: HistoricalDataPoint[] = Array.from({ length: 30 }, (_, i) =>
      makeDataPoint({
        high: 100 + i * 2 + 5,
        low: 100 + i * 2 - 5,
        close: 100 + i * 2,
      })
    );
    const result = adx(points, 14);
    expect(result).toBeDefined();
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  it('returns high ADX for strong trending data', () => {
    // Strong uptrend: each bar's high exceeds previous high significantly
    const points: HistoricalDataPoint[] = Array.from({ length: 30 }, (_, i) =>
      makeDataPoint({
        high: 100 + i * 3,
        low: 95 + i * 3,
        close: 98 + i * 3,
      })
    );
    const result = adx(points, 7);
    expect(result).toBeDefined();
    // Strong trend should produce ADX > 25
    expect(result!).toBeGreaterThan(25);
  });

  it('returns lower ADX for choppy/sideways data', () => {
    // Alternating up/down bars (no clear trend)
    const points: HistoricalDataPoint[] = Array.from({ length: 30 }, (_, i) =>
      makeDataPoint({
        high: 105 + (i % 2 === 0 ? 3 : -3),
        low: 95 + (i % 2 === 0 ? 3 : -3),
        close: 100 + (i % 2 === 0 ? 3 : -3),
      })
    );
    const result = adx(points, 7);
    expect(result).toBeDefined();
    // Choppy market should produce lower ADX than strong trend
    expect(result!).toBeLessThan(50);
  });

  it('handles data where smoothedTR could be 0 (flat bars)', () => {
    // All bars identical → TR = 0 for all
    const points: HistoricalDataPoint[] = Array.from({ length: 30 }, () =>
      makeDataPoint({ high: 100, low: 100, close: 100 })
    );
    const result = adx(points, 7);
    // When smoothedTR is 0 from the start, function returns undefined
    expect(result).toBeUndefined();
  });
});
