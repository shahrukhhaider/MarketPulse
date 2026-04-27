"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sma = sma;
exports.rsi = rsi;
exports.atr = atr;
exports.returnNd = returnNd;
exports.highest = highest;
exports.lowest = lowest;
exports.avgVolume = avgVolume;
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
//# sourceMappingURL=indicators.js.map