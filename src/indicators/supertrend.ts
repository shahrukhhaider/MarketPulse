// ============================================================
// SuperTrend Indicator — Pure computation
// Ported from PineScript reference in scripts/super-trend.txt
// ============================================================

import type { HistoricalDataPoint } from '../types.js';

// ============================================================
// Types
// ============================================================

export interface SuperTrendParams {
  period: number;       // ATR period (default: 26)
  multiplier: number;   // Band multiplier (default: 3.7)
  source: 'low' | 'close' | 'hl2' | 'hlc3';  // Price source (default: 'low')
}

export interface SuperTrendBar {
  trend: 1 | -1;       // 1 = bullish, -1 = bearish
  upperBand: number;    // Resistance band (active when bearish)
  lowerBand: number;    // Support band (active when bullish)
}

export const DEFAULT_SUPERTREND_PARAMS: SuperTrendParams = {
  period: 26,
  multiplier: 3.7,
  source: 'low',
};

// ============================================================
// Helpers
// ============================================================

/**
 * Extract the source price from a data point based on the configured source field.
 */
function getSource(dp: HistoricalDataPoint, source: SuperTrendParams['source']): number {
  switch (source) {
    case 'low':
      return dp.low;
    case 'close':
      return dp.close;
    case 'hl2':
      return (dp.high + dp.low) / 2;
    case 'hlc3':
      return (dp.high + dp.low + dp.close) / 3;
  }
}

/**
 * Compute True Range for a bar given the current bar and previous close.
 * TR = max(high - low, |high - prevClose|, |low - prevClose|)
 */
function trueRange(current: HistoricalDataPoint, prevClose: number): number {
  const hl = current.high - current.low;
  const hpc = Math.abs(current.high - prevClose);
  const lpc = Math.abs(current.low - prevClose);
  return Math.max(hl, hpc, lpc);
}

// ============================================================
// Main computation
// ============================================================

/**
 * Compute SuperTrend for an array of OHLCV bars.
 *
 * Algorithm (from PineScript reference):
 * 1. Compute True ATR with Wilder's smoothing over `period` bars.
 * 2. For each bar, compute raw upper/lower bands from source ± (multiplier × ATR).
 * 3. Ratchet bands:
 *    - Lower band (support, "up" in PineScript): only moves UP (max of current vs previous).
 *      Resets when previous close was below the previous lower band.
 *    - Upper band (resistance, "dn" in PineScript): only moves DOWN (min of current vs previous).
 *      Resets when previous close was above the previous upper band.
 * 4. Determine trend:
 *    - Flip to bullish (1) when trend was -1 and close > previous upper band.
 *    - Flip to bearish (-1) when trend was 1 and close < previous lower band.
 *
 * Returns one SuperTrendBar per input bar (starting from index `period`).
 * Returns empty array if fewer than (period + 1) bars provided.
 */
export function computeSuperTrend(
  data: HistoricalDataPoint[],
  params?: Partial<SuperTrendParams>
): SuperTrendBar[] {
  const { period, multiplier, source } = { ...DEFAULT_SUPERTREND_PARAMS, ...params };

  // Need at least period + 1 bars: period bars to seed ATR + 1 bar to produce first result
  if (data.length < period + 1) {
    return [];
  }

  // Step 1: Compute True Range for all bars (starting from index 1)
  const trValues: number[] = new Array(data.length);
  trValues[0] = data[0].high - data[0].low; // No previous close for first bar
  for (let i = 1; i < data.length; i++) {
    trValues[i] = trueRange(data[i], data[i - 1].close);
  }

  // Step 2: Compute Wilder's smoothed ATR
  // Seed: simple average of first `period` true ranges (indices 1..period)
  const atrValues: number[] = new Array(data.length);
  let atrSum = 0;
  for (let i = 1; i <= period; i++) {
    atrSum += trValues[i];
  }
  atrValues[period] = atrSum / period;

  // Wilder's smoothing for subsequent bars
  for (let i = period + 1; i < data.length; i++) {
    atrValues[i] = (atrValues[i - 1] * (period - 1) + trValues[i]) / period;
  }

  // Step 3 & 4: Compute bands and trend starting from index `period`
  const results: SuperTrendBar[] = [];

  // Initialize first SuperTrend bar at index `period`
  const firstSrc = getSource(data[period], source);
  const firstAtr = atrValues[period];
  let prevLowerBand = firstSrc - multiplier * firstAtr;  // "up" in PineScript — support
  let prevUpperBand = firstSrc + multiplier * firstAtr;  // "dn" in PineScript — resistance
  let prevTrend: 1 | -1 = 1; // Start bullish (matches PineScript: var trend = 1)

  results.push({
    trend: prevTrend,
    upperBand: prevUpperBand,
    lowerBand: prevLowerBand,
  });

  // Process remaining bars
  for (let i = period + 1; i < data.length; i++) {
    const src = getSource(data[i], source);
    const currentAtr = atrValues[i];
    const prevClose = data[i - 1].close;
    const currentClose = data[i].close;

    // Raw bands
    let rawLowerBand = src - multiplier * currentAtr;
    let rawUpperBand = src + multiplier * currentAtr;

    // Ratchet lower band (support — "up" in PineScript):
    // Only moves up (max) when previous close was above previous lower band
    // PineScript: up := close[1] > up1 ? math.max(up, up1) : up
    if (prevClose > prevLowerBand) {
      rawLowerBand = Math.max(rawLowerBand, prevLowerBand);
    }

    // Ratchet upper band (resistance — "dn" in PineScript):
    // Only moves down (min) when previous close was below previous upper band
    // PineScript: dn := close[1] < dn1 ? math.min(dn, dn1) : dn
    if (prevClose < prevUpperBand) {
      rawUpperBand = Math.min(rawUpperBand, prevUpperBand);
    }

    // Determine trend
    // PineScript: trend := trend == -1 and close > dn1 ? 1 : trend == 1 and close < up1 ? -1 : trend
    let trend: 1 | -1;
    if (prevTrend === -1 && currentClose > prevUpperBand) {
      trend = 1;  // Flip to bullish: close crossed above previous upper band
    } else if (prevTrend === 1 && currentClose < prevLowerBand) {
      trend = -1; // Flip to bearish: close dropped below previous lower band
    } else {
      trend = prevTrend; // No change
    }

    results.push({
      trend,
      upperBand: rawUpperBand,
      lowerBand: rawLowerBand,
    });

    // Update state for next iteration
    prevLowerBand = rawLowerBand;
    prevUpperBand = rawUpperBand;
    prevTrend = trend;
  }

  return results;
}
