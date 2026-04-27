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
//# sourceMappingURL=indicators.d.ts.map