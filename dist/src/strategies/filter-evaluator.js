"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scoreCondition = scoreCondition;
exports.scoreConditions = scoreConditions;
exports.evaluateConditions = evaluateConditions;
const indicators_js_1 = require("../indicators.js");
function evaluateCondition(condition, prices, dataPoints, auxiliaryData) {
    const currentPrice = prices[prices.length - 1];
    switch (condition.type) {
        case 'return_above': {
            const ret = (0, indicators_js_1.returnNd)(prices, condition.period);
            return ret !== undefined && ret > condition.threshold;
        }
        case 'return_below': {
            const ret = (0, indicators_js_1.returnNd)(prices, condition.period);
            return ret !== undefined && ret < condition.threshold;
        }
        case 'price_above_sma': {
            const smaVal = (0, indicators_js_1.sma)(prices, condition.period);
            return smaVal !== undefined && currentPrice > smaVal;
        }
        case 'price_below_sma': {
            const smaVal = (0, indicators_js_1.sma)(prices, condition.period);
            return smaVal !== undefined && currentPrice < smaVal;
        }
        case 'sma_above_sma': {
            const shortSma = (0, indicators_js_1.sma)(prices, condition.shortPeriod);
            const longSma = (0, indicators_js_1.sma)(prices, condition.longPeriod);
            return shortSma !== undefined && longSma !== undefined && shortSma > longSma;
        }
        case 'rsi_below': {
            const rsiVal = (0, indicators_js_1.rsi)(prices, condition.period);
            return rsiVal !== undefined && rsiVal < condition.threshold;
        }
        case 'rsi_above': {
            const rsiVal = (0, indicators_js_1.rsi)(prices, condition.period);
            return rsiVal !== undefined && rsiVal > condition.threshold;
        }
        case 'price_near_sma': {
            const smaVal = (0, indicators_js_1.sma)(prices, condition.period);
            if (smaVal === undefined)
                return false;
            return Math.abs(currentPrice - smaVal) / smaVal <= condition.tolerance;
        }
        case 'price_above_highest': {
            // Exclude current price — breakout means current price exceeds the highest of the PREVIOUS N periods
            const previousPrices = prices.slice(0, -1);
            const high = (0, indicators_js_1.highest)(previousPrices, condition.period);
            return high !== undefined && currentPrice > high;
        }
        case 'volume_above_avg': {
            const avg = (0, indicators_js_1.avgVolume)(dataPoints, condition.period);
            if (avg === undefined)
                return false;
            const currentVolume = dataPoints[dataPoints.length - 1].volume;
            return currentVolume > condition.multiplier * avg;
        }
        case 'volume_below_avg': {
            const avg = (0, indicators_js_1.avgVolume)(dataPoints, condition.period);
            if (avg === undefined)
                return false;
            const currentVolume = dataPoints[dataPoints.length - 1].volume;
            return currentVolume < avg;
        }
        case 'outperforms_index': {
            if (!auxiliaryData || !auxiliaryData[condition.indexTicker])
                return false;
            const indexData = auxiliaryData[condition.indexTicker];
            const indexPrices = indexData.map(dp => dp.close);
            const stockReturn = (0, indicators_js_1.returnNd)(prices, condition.period);
            const indexReturn = (0, indicators_js_1.returnNd)(indexPrices, condition.period);
            if (stockReturn === undefined || indexReturn === undefined)
                return false;
            return stockReturn > indexReturn;
        }
    }
}
function clamp(value, min, max) {
    if (value < min)
        return min;
    if (value > max)
        return max;
    return value;
}
function scoreCondition(condition, prices, dataPoints, auxiliaryData) {
    const currentPrice = prices[prices.length - 1];
    switch (condition.type) {
        case 'return_above': {
            const ret = (0, indicators_js_1.returnNd)(prices, condition.period);
            if (ret === undefined)
                return 0;
            return clamp(ret / condition.threshold, 0, 1);
        }
        case 'return_below': {
            const ret = (0, indicators_js_1.returnNd)(prices, condition.period);
            if (ret === undefined)
                return 0;
            if (condition.threshold < 0) {
                return clamp(1 - ret / condition.threshold, 0, 1);
            }
            return clamp((condition.threshold - ret) / condition.threshold, 0, 1);
        }
        case 'price_above_sma': {
            const smaVal = (0, indicators_js_1.sma)(prices, condition.period);
            if (smaVal === undefined)
                return 0;
            return clamp((currentPrice - smaVal * 0.95) / (smaVal * 0.05), 0, 1);
        }
        case 'price_below_sma': {
            const smaVal = (0, indicators_js_1.sma)(prices, condition.period);
            if (smaVal === undefined)
                return 0;
            return clamp((smaVal * 1.05 - currentPrice) / (smaVal * 0.05), 0, 1);
        }
        case 'sma_above_sma': {
            const shortSma = (0, indicators_js_1.sma)(prices, condition.shortPeriod);
            const longSma = (0, indicators_js_1.sma)(prices, condition.longPeriod);
            if (shortSma === undefined || longSma === undefined)
                return 0;
            return clamp((shortSma - longSma * 0.95) / (longSma * 0.05), 0, 1);
        }
        case 'rsi_below': {
            const rsiVal = (0, indicators_js_1.rsi)(prices, condition.period);
            if (rsiVal === undefined)
                return 0;
            return clamp((condition.threshold + 20 - rsiVal) / 20, 0, 1);
        }
        case 'rsi_above': {
            const rsiVal = (0, indicators_js_1.rsi)(prices, condition.period);
            if (rsiVal === undefined)
                return 0;
            return clamp((rsiVal - (condition.threshold - 20)) / 20, 0, 1);
        }
        case 'price_near_sma': {
            const smaVal = (0, indicators_js_1.sma)(prices, condition.period);
            if (smaVal === undefined)
                return 0;
            const distance = Math.abs(currentPrice - smaVal) / smaVal;
            return clamp((condition.tolerance * 2 - distance) / condition.tolerance, 0, 1);
        }
        case 'price_above_highest': {
            const previousPrices = prices.slice(0, -1);
            const high = (0, indicators_js_1.highest)(previousPrices, condition.period);
            if (high === undefined)
                return 0;
            return clamp((currentPrice - high * 0.95) / (high * 0.05), 0, 1);
        }
        case 'volume_above_avg': {
            const avg = (0, indicators_js_1.avgVolume)(dataPoints, condition.period);
            if (avg === undefined)
                return 0;
            const currentVolume = dataPoints[dataPoints.length - 1].volume;
            return clamp((currentVolume - avg) / ((condition.multiplier - 1) * avg), 0, 1);
        }
        case 'volume_below_avg': {
            const avg = (0, indicators_js_1.avgVolume)(dataPoints, condition.period);
            if (avg === undefined)
                return 0;
            const currentVolume = dataPoints[dataPoints.length - 1].volume;
            return clamp((avg * 1.5 - currentVolume) / (avg * 0.5), 0, 1);
        }
        case 'outperforms_index': {
            if (!auxiliaryData || !auxiliaryData[condition.indexTicker])
                return 0;
            const indexData = auxiliaryData[condition.indexTicker];
            const indexPrices = indexData.map(dp => dp.close);
            const stockReturn = (0, indicators_js_1.returnNd)(prices, condition.period);
            const indexReturn = (0, indicators_js_1.returnNd)(indexPrices, condition.period);
            if (stockReturn === undefined || indexReturn === undefined)
                return 0;
            const diff = stockReturn - indexReturn;
            return clamp((diff + 5) / 5, 0, 1);
        }
    }
}
function scoreConditions(conditions, prices, dataPoints, auxiliaryData) {
    if (conditions.length === 0)
        return 1;
    const total = conditions.reduce((sum, c) => sum + scoreCondition(c, prices, dataPoints, auxiliaryData), 0);
    return total / conditions.length;
}
function evaluateConditions(conditions, prices, dataPoints, auxiliaryData) {
    if (conditions.length === 0)
        return true;
    return conditions.every(c => evaluateCondition(c, prices, dataPoints, auxiliaryData));
}
//# sourceMappingURL=filter-evaluator.js.map