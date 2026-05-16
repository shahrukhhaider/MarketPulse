import type { HistoricalDataPoint } from '../types.js';

/**
 * Simple Moving Average — arithmetic mean of the last `period` closing prices.
 * Requires at least `period` prices.
 */
export function sma(prices: number[], period: number): number | undefined {
  if (prices.length < period) return undefined;
  let sum = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    sum += prices[i];
  }
  return sum / period;
}

/**
 * Relative Strength Index using Wilder's smoothing.
 * Requires at least `period + 1` prices.
 * Returns 100 when average loss is 0 (no losses = maximum strength).
 */
export function rsi(prices: number[], period: number): number | undefined {
  if (prices.length < period + 1) return undefined;

  // Calculate initial average gain and average loss over the first `period` changes
  const start = prices.length - period - 1;
  let gainSum = 0;
  let lossSum = 0;

  for (let i = start + 1; i <= start + period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      gainSum += change;
    } else {
      lossSum += Math.abs(change);
    }
  }

  const avgGain = gainSum / period;
  const avgLoss = lossSum / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Average True Range using Wilder's smoothing.
 * True range = max(high - low, |high - prevClose|, |low - prevClose|).
 * Requires at least `period + 1` data points.
 */
export function atr(dataPoints: HistoricalDataPoint[], period: number): number | undefined {
  if (dataPoints.length < period + 1) return undefined;

  const start = dataPoints.length - period - 1;

  // Compute true ranges for the last `period` bars (each needs a previous bar)
  let trSum = 0;
  for (let i = start + 1; i <= start + period; i++) {
    const high = dataPoints[i].high;
    const low = dataPoints[i].low;
    const prevClose = dataPoints[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trSum += tr;
  }

  return trSum / period;
}

/**
 * N-day return — percentage change over `period` days.
 * Formula: ((prices[last] - prices[last - period]) / prices[last - period]) * 100
 * Requires at least `period + 1` prices.
 * Returns `undefined` if the base price is 0.
 */
export function returnNd(prices: number[], period: number): number | undefined {
  if (prices.length < period + 1) return undefined;

  const base = prices[prices.length - 1 - period];
  if (base === 0) return undefined;

  const current = prices[prices.length - 1];
  return ((current - base) / base) * 100;
}

/**
 * Highest closing price over the last `period` prices.
 * Requires at least `period` prices.
 */
export function highest(prices: number[], period: number): number | undefined {
  if (prices.length < period) return undefined;

  let max = -Infinity;
  for (let i = prices.length - period; i < prices.length; i++) {
    if (prices[i] > max) max = prices[i];
  }
  return max;
}

/**
 * Lowest closing price over the last `period` prices.
 * Requires at least `period` prices.
 */
export function lowest(prices: number[], period: number): number | undefined {
  if (prices.length < period) return undefined;

  let min = Infinity;
  for (let i = prices.length - period; i < prices.length; i++) {
    if (prices[i] < min) min = prices[i];
  }
  return min;
}

/**
 * Average volume over the last `period` data points.
 * Requires at least `period` data points.
 */
export function avgVolume(dataPoints: HistoricalDataPoint[], period: number): number | undefined {
  if (dataPoints.length < period) return undefined;

  let sum = 0;
  for (let i = dataPoints.length - period; i < dataPoints.length; i++) {
    sum += dataPoints[i].volume;
  }
  return sum / period;
}

/**
 * Swing Low — lowest low over the last `lookback` data points.
 * Used for structure stop-loss calculation.
 * Requires at least `lookback` data points.
 */
export function swingLow(dataPoints: HistoricalDataPoint[], lookback: number): number | undefined {
  if (dataPoints.length < lookback) return undefined;

  let min = Infinity;
  for (let i = dataPoints.length - lookback; i < dataPoints.length; i++) {
    if (dataPoints[i].low < min) min = dataPoints[i].low;
  }
  return min;
}

/**
 * Percentage distance from the current price to its SMA.
 * Formula: ((currentPrice - SMA) / SMA) × 100
 * Requires at least `smaPeriod` prices.
 */
export function distanceToSma(prices: number[], smaPeriod: number): number | undefined {
  if (prices.length < smaPeriod) return undefined;

  const smaValue = sma(prices, smaPeriod);
  if (smaValue === undefined || smaValue === 0) return undefined;

  const currentPrice = prices[prices.length - 1];
  return ((currentPrice - smaValue) / smaValue) * 100;
}

/**
 * Highest High — highest high over the last `lookback` data points.
 * Used for trigger phase breakout conditions.
 * Requires at least `lookback` data points.
 */
export function highestHigh(dataPoints: HistoricalDataPoint[], lookback: number): number | undefined {
  if (dataPoints.length < lookback) return undefined;

  let max = -Infinity;
  for (let i = dataPoints.length - lookback; i < dataPoints.length; i++) {
    if (dataPoints[i].high > max) max = dataPoints[i].high;
  }
  return max;
}

/**
 * Percentage range over a window of data points.
 * Formula: (highestHigh - lowestLow) / close
 * Uses the last `window` data points from the array.
 * Requires at least `window` data points.
 */
export function range_pct(dataPoints: HistoricalDataPoint[], window: number): number | undefined {
  if (dataPoints.length < window) return undefined;

  const hh = highestHigh(dataPoints, window);
  const ll = swingLow(dataPoints, window);
  if (hh === undefined || ll === undefined) return undefined;

  const close = dataPoints[dataPoints.length - 1].close;
  if (close === 0) return undefined;

  return (hh - ll) / close;
}

/**
 * Ratio of short-term ATR to long-term ATR.
 * Returns undefined if either ATR is undefined or long-term ATR is 0.
 */
export function atr_ratio(
  dataPoints: HistoricalDataPoint[],
  shortPeriod: number,
  longPeriod: number
): number | undefined {
  const shortAtr = atr(dataPoints, shortPeriod);
  const longAtr = atr(dataPoints, longPeriod);
  if (shortAtr === undefined || longAtr === undefined) return undefined;
  if (longAtr === 0) return undefined;

  return shortAtr / longAtr;
}

/**
 * Whether the current SMA exceeds the previous bar's SMA (positive slope).
 * Computes SMA over the full prices array vs SMA over all-but-last.
 * Returns true if current SMA > previous SMA, false otherwise.
 * Returns undefined if insufficient data.
 */
export function sma_slope(prices: number[], period: number): boolean | undefined {
  if (prices.length < period + 1) return undefined;

  const currentSma = sma(prices, period);
  const previousSma = sma(prices.slice(0, -1), period);
  if (currentSma === undefined || previousSma === undefined) return undefined;

  return currentSma > previousSma;
}

/**
 * Exponential Moving Average — returns the final EMA value.
 * Seed: SMA of first `period` prices.
 * Multiplier: 2 / (period + 1).
 * Returns undefined if prices.length < period or period < 1.
 */
export function ema(prices: number[], period: number): number | undefined {
  if (period < 1 || prices.length < period) return undefined;

  const multiplier = 2 / (period + 1);

  // Seed with SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  let value = sum / period;

  // Iteratively apply EMA formula for remaining values
  for (let i = period; i < prices.length; i++) {
    value = (prices[i] - value) * multiplier + value;
  }

  return value;
}

/**
 * Internal EMA helper — computes the full EMA series.
 * Seeded with SMA of the first `period` values.
 * Returns undefined if prices.length < period.
 */
function emaSeries(prices: number[], period: number): number[] | undefined {
  if (prices.length < period) return undefined;

  const multiplier = 2 / (period + 1);

  // Seed with SMA of first `period` values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  const seed = sum / period;

  const result: number[] = [seed];

  // Compute EMA for remaining values
  for (let i = period; i < prices.length; i++) {
    const prev = result[result.length - 1];
    result.push((prices[i] - prev) * multiplier + prev);
  }

  return result;
}

/**
 * Average Directional Index using Wilder's smoothing.
 * Requires at least 2 * period data points.
 * Returns a value in [0, 100] or undefined.
 */
export function adx(dataPoints: HistoricalDataPoint[], period: number): number | undefined {
  if (dataPoints.length < 2 * period) return undefined;

  // Step 1: Compute +DM, -DM, and TR for each bar (starting from index 1)
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  const trs: number[] = [];

  for (let i = 1; i < dataPoints.length; i++) {
    const highDiff = dataPoints[i].high - dataPoints[i - 1].high;
    const lowDiff = dataPoints[i - 1].low - dataPoints[i].low;

    let plusDM = 0;
    let minusDM = 0;

    if (highDiff > lowDiff && highDiff > 0) {
      plusDM = highDiff;
    } else if (lowDiff > highDiff && lowDiff > 0) {
      minusDM = lowDiff;
    }

    plusDMs.push(plusDM);
    minusDMs.push(minusDM);

    // True Range
    const high = dataPoints[i].high;
    const low = dataPoints[i].low;
    const prevClose = dataPoints[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }

  // Step 2: Initial smoothing — sum of first `period` values
  let smoothedPlusDM = 0;
  let smoothedMinusDM = 0;
  let smoothedTR = 0;

  for (let i = 0; i < period; i++) {
    smoothedPlusDM += plusDMs[i];
    smoothedMinusDM += minusDMs[i];
    smoothedTR += trs[i];
  }

  // Step 3: Apply Wilder's smoothing and compute DX for remaining bars
  const dxValues: number[] = [];

  // First DX from initial smoothed values
  if (smoothedTR === 0) return undefined;
  const plusDI0 = (smoothedPlusDM / smoothedTR) * 100;
  const minusDI0 = (smoothedMinusDM / smoothedTR) * 100;
  const diSum0 = plusDI0 + minusDI0;
  if (diSum0 === 0) {
    dxValues.push(0);
  } else {
    dxValues.push((Math.abs(plusDI0 - minusDI0) / diSum0) * 100);
  }

  // Continue Wilder's smoothing for subsequent bars
  for (let i = period; i < plusDMs.length; i++) {
    smoothedPlusDM = smoothedPlusDM - (smoothedPlusDM / period) + plusDMs[i];
    smoothedMinusDM = smoothedMinusDM - (smoothedMinusDM / period) + minusDMs[i];
    smoothedTR = smoothedTR - (smoothedTR / period) + trs[i];

    if (smoothedTR === 0) {
      dxValues.push(0);
      continue;
    }

    const plusDI = (smoothedPlusDM / smoothedTR) * 100;
    const minusDI = (smoothedMinusDM / smoothedTR) * 100;
    const diSum = plusDI + minusDI;

    if (diSum === 0) {
      dxValues.push(0);
    } else {
      dxValues.push((Math.abs(plusDI - minusDI) / diSum) * 100);
    }
  }

  // Step 4: Compute ADX — Wilder's smoothed average of DX over `period`
  // We need at least `period` DX values for the ADX calculation
  if (dxValues.length < period) return undefined;

  // Initial ADX = average of first `period` DX values
  let adxValue = 0;
  for (let i = 0; i < period; i++) {
    adxValue += dxValues[i];
  }
  adxValue = adxValue / period;

  // Apply Wilder's smoothing for remaining DX values
  for (let i = period; i < dxValues.length; i++) {
    adxValue = (adxValue * (period - 1) + dxValues[i]) / period;
  }

  // Clamp to [0, 100]
  return Math.max(0, Math.min(100, adxValue));
}

/**
 * MACD — Moving Average Convergence Divergence.
 * Returns { macdLine, signalLine, histogram } or undefined.
 * Requires at least 35 prices (26 for slow EMA + 9 for signal EMA).
 */
export function macd(prices: number[]): { macdLine: number; signalLine: number; histogram: number } | undefined {
  if (prices.length < 35) return undefined;

  const fastPeriod = 12;
  const slowPeriod = 26;
  const signalPeriod = 9;

  // Compute fast EMA(12) and slow EMA(26) over all prices
  const fastEma = emaSeries(prices, fastPeriod);
  const slowEma = emaSeries(prices, slowPeriod);

  if (fastEma === undefined || slowEma === undefined) return undefined;

  // MACD line = EMA(12) - EMA(26)
  // Fast EMA starts at index `fastPeriod` (i.e., covers prices[fastPeriod..end])
  // Slow EMA starts at index `slowPeriod` (i.e., covers prices[slowPeriod..end])
  // We need to align them: both series end at the last price.
  // fastEma has length = prices.length - fastPeriod + 1
  // slowEma has length = prices.length - slowPeriod + 1
  // The MACD line series length = slowEma.length (shorter series)
  // Offset into fastEma: fastEma.length - slowEma.length

  const macdLine: number[] = [];
  const fastOffset = fastEma.length - slowEma.length;

  for (let i = 0; i < slowEma.length; i++) {
    macdLine.push(fastEma[i + fastOffset] - slowEma[i]);
  }

  // Signal line = EMA(9) of MACD line values
  const signalEma = emaSeries(macdLine, signalPeriod);
  if (signalEma === undefined) return undefined;

  // Return the latest values
  const lastMacd = macdLine[macdLine.length - 1];
  const lastSignal = signalEma[signalEma.length - 1];
  const histogram = lastMacd - lastSignal;

  return { macdLine: lastMacd, signalLine: lastSignal, histogram };
}

/**
 * On-Balance Volume — cumulative signed volume series.
 * Returns an array of the same length as input.
 * OBV[0] = 0
 * OBV[i] = OBV[i-1] + volume[i]  if close[i] > close[i-1]
 * OBV[i] = OBV[i-1] - volume[i]  if close[i] < close[i-1]
 * OBV[i] = OBV[i-1]              if close[i] == close[i-1]
 */
export function obv(dataPoints: HistoricalDataPoint[]): number[] {
  if (dataPoints.length === 0) return [];

  const result: number[] = [0];

  for (let i = 1; i < dataPoints.length; i++) {
    const prevObv = result[i - 1];
    const close = dataPoints[i].close;
    const prevClose = dataPoints[i - 1].close;

    if (close > prevClose) {
      result.push(prevObv + dataPoints[i].volume);
    } else if (close < prevClose) {
      result.push(prevObv - dataPoints[i].volume);
    } else {
      result.push(prevObv);
    }
  }

  return result;
}

/**
 * OBV Slope — whether OBV is trending upward over a lookback window.
 * Returns true if OBV[current] > OBV[current - lookback], false otherwise.
 * Returns undefined if insufficient data (< lookback + 1 points).
 */
export function obvSlope(dataPoints: HistoricalDataPoint[], lookback: number): boolean | undefined {
  if (dataPoints.length < lookback + 1) return undefined;

  const obvSeries = obv(dataPoints);
  const last = obvSeries.length - 1;

  return obvSeries[last] > obvSeries[last - lookback];
}
