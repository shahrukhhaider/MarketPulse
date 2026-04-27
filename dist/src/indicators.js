"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sma = sma;
exports.rsi = rsi;
exports.atr = atr;
exports.returnNd = returnNd;
exports.highest = highest;
exports.lowest = lowest;
exports.avgVolume = avgVolume;
exports.swingLow = swingLow;
exports.distanceToSma = distanceToSma;
exports.highestHigh = highestHigh;
exports.range_pct = range_pct;
exports.atr_ratio = atr_ratio;
exports.sma_slope = sma_slope;
/**
 * Simple Moving Average — arithmetic mean of the last `period` closing prices.
 * Requires at least `period` prices.
 */
function sma(prices, period) {
    if (prices.length < period)
        return undefined;
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
function rsi(prices, period) {
    if (prices.length < period + 1)
        return undefined;
    // Calculate initial average gain and average loss over the first `period` changes
    const start = prices.length - period - 1;
    let gainSum = 0;
    let lossSum = 0;
    for (let i = start + 1; i <= start + period; i++) {
        const change = prices[i] - prices[i - 1];
        if (change > 0) {
            gainSum += change;
        }
        else {
            lossSum += Math.abs(change);
        }
    }
    const avgGain = gainSum / period;
    const avgLoss = lossSum / period;
    if (avgLoss === 0)
        return 100;
    const rs = avgGain / avgLoss;
    return 100 - 100 / (1 + rs);
}
/**
 * Average True Range using Wilder's smoothing.
 * True range = max(high - low, |high - prevClose|, |low - prevClose|).
 * Requires at least `period + 1` data points.
 */
function atr(dataPoints, period) {
    if (dataPoints.length < period + 1)
        return undefined;
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
function returnNd(prices, period) {
    if (prices.length < period + 1)
        return undefined;
    const base = prices[prices.length - 1 - period];
    if (base === 0)
        return undefined;
    const current = prices[prices.length - 1];
    return ((current - base) / base) * 100;
}
/**
 * Highest closing price over the last `period` prices.
 * Requires at least `period` prices.
 */
function highest(prices, period) {
    if (prices.length < period)
        return undefined;
    let max = -Infinity;
    for (let i = prices.length - period; i < prices.length; i++) {
        if (prices[i] > max)
            max = prices[i];
    }
    return max;
}
/**
 * Lowest closing price over the last `period` prices.
 * Requires at least `period` prices.
 */
function lowest(prices, period) {
    if (prices.length < period)
        return undefined;
    let min = Infinity;
    for (let i = prices.length - period; i < prices.length; i++) {
        if (prices[i] < min)
            min = prices[i];
    }
    return min;
}
/**
 * Average volume over the last `period` data points.
 * Requires at least `period` data points.
 */
function avgVolume(dataPoints, period) {
    if (dataPoints.length < period)
        return undefined;
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
function swingLow(dataPoints, lookback) {
    if (dataPoints.length < lookback)
        return undefined;
    let min = Infinity;
    for (let i = dataPoints.length - lookback; i < dataPoints.length; i++) {
        if (dataPoints[i].low < min)
            min = dataPoints[i].low;
    }
    return min;
}
/**
 * Percentage distance from the current price to its SMA.
 * Formula: ((currentPrice - SMA) / SMA) × 100
 * Requires at least `smaPeriod` prices.
 */
function distanceToSma(prices, smaPeriod) {
    if (prices.length < smaPeriod)
        return undefined;
    const smaValue = sma(prices, smaPeriod);
    if (smaValue === undefined || smaValue === 0)
        return undefined;
    const currentPrice = prices[prices.length - 1];
    return ((currentPrice - smaValue) / smaValue) * 100;
}
/**
 * Highest High — highest high over the last `lookback` data points.
 * Used for trigger phase breakout conditions.
 * Requires at least `lookback` data points.
 */
function highestHigh(dataPoints, lookback) {
    if (dataPoints.length < lookback)
        return undefined;
    let max = -Infinity;
    for (let i = dataPoints.length - lookback; i < dataPoints.length; i++) {
        if (dataPoints[i].high > max)
            max = dataPoints[i].high;
    }
    return max;
}
/**
 * Percentage range over a window of data points.
 * Formula: (highestHigh - lowestLow) / close
 * Uses the last `window` data points from the array.
 * Requires at least `window` data points.
 */
function range_pct(dataPoints, window) {
    if (dataPoints.length < window)
        return undefined;
    const hh = highestHigh(dataPoints, window);
    const ll = swingLow(dataPoints, window);
    if (hh === undefined || ll === undefined)
        return undefined;
    const close = dataPoints[dataPoints.length - 1].close;
    if (close === 0)
        return undefined;
    return (hh - ll) / close;
}
/**
 * Ratio of short-term ATR to long-term ATR.
 * Returns undefined if either ATR is undefined or long-term ATR is 0.
 */
function atr_ratio(dataPoints, shortPeriod, longPeriod) {
    const shortAtr = atr(dataPoints, shortPeriod);
    const longAtr = atr(dataPoints, longPeriod);
    if (shortAtr === undefined || longAtr === undefined)
        return undefined;
    if (longAtr === 0)
        return undefined;
    return shortAtr / longAtr;
}
/**
 * Whether the current SMA exceeds the previous bar's SMA (positive slope).
 * Computes SMA over the full prices array vs SMA over all-but-last.
 * Returns true if current SMA > previous SMA, false otherwise.
 * Returns undefined if insufficient data.
 */
function sma_slope(prices, period) {
    if (prices.length < period + 1)
        return undefined;
    const currentSma = sma(prices, period);
    const previousSma = sma(prices.slice(0, -1), period);
    if (currentSma === undefined || previousSma === undefined)
        return undefined;
    return currentSma > previousSma;
}
//# sourceMappingURL=indicators.js.map