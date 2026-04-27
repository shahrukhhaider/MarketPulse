import type { HistoricalDataPoint } from './types.js';
/**
 * Simple Moving Average — arithmetic mean of the last `period` closing prices.
 * Requires at least `period` prices.
 */
export declare function sma(prices: number[], period: number): number | undefined;
/**
 * Relative Strength Index using Wilder's smoothing.
 * Requires at least `period + 1` prices.
 * Returns 100 when average loss is 0 (no losses = maximum strength).
 */
export declare function rsi(prices: number[], period: number): number | undefined;
/**
 * Average True Range using Wilder's smoothing.
 * True range = max(high - low, |high - prevClose|, |low - prevClose|).
 * Requires at least `period + 1` data points.
 */
export declare function atr(dataPoints: HistoricalDataPoint[], period: number): number | undefined;
/**
 * N-day return — percentage change over `period` days.
 * Formula: ((prices[last] - prices[last - period]) / prices[last - period]) * 100
 * Requires at least `period + 1` prices.
 * Returns `undefined` if the base price is 0.
 */
export declare function returnNd(prices: number[], period: number): number | undefined;
/**
 * Highest closing price over the last `period` prices.
 * Requires at least `period` prices.
 */
export declare function highest(prices: number[], period: number): number | undefined;
/**
 * Lowest closing price over the last `period` prices.
 * Requires at least `period` prices.
 */
export declare function lowest(prices: number[], period: number): number | undefined;
/**
 * Average volume over the last `period` data points.
 * Requires at least `period` data points.
 */
export declare function avgVolume(dataPoints: HistoricalDataPoint[], period: number): number | undefined;
/**
 * Swing Low — lowest low over the last `lookback` data points.
 * Used for structure stop-loss calculation.
 * Requires at least `lookback` data points.
 */
export declare function swingLow(dataPoints: HistoricalDataPoint[], lookback: number): number | undefined;
/**
 * Percentage distance from the current price to its SMA.
 * Formula: ((currentPrice - SMA) / SMA) × 100
 * Requires at least `smaPeriod` prices.
 */
export declare function distanceToSma(prices: number[], smaPeriod: number): number | undefined;
/**
 * Highest High — highest high over the last `lookback` data points.
 * Used for trigger phase breakout conditions.
 * Requires at least `lookback` data points.
 */
export declare function highestHigh(dataPoints: HistoricalDataPoint[], lookback: number): number | undefined;
/**
 * Percentage range over a window of data points.
 * Formula: (highestHigh - lowestLow) / close
 * Uses the last `window` data points from the array.
 * Requires at least `window` data points.
 */
export declare function range_pct(dataPoints: HistoricalDataPoint[], window: number): number | undefined;
/**
 * Ratio of short-term ATR to long-term ATR.
 * Returns undefined if either ATR is undefined or long-term ATR is 0.
 */
export declare function atr_ratio(dataPoints: HistoricalDataPoint[], shortPeriod: number, longPeriod: number): number | undefined;
/**
 * Whether the current SMA exceeds the previous bar's SMA (positive slope).
 * Computes SMA over the full prices array vs SMA over all-but-last.
 * Returns true if current SMA > previous SMA, false otherwise.
 * Returns undefined if insufficient data.
 */
export declare function sma_slope(prices: number[], period: number): boolean | undefined;
//# sourceMappingURL=indicators.d.ts.map