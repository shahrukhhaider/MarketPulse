import type { HistoricalDataPoint } from '../types.js';
import { sma, rsi, returnNd, highest, avgVolume } from '../indicators.js';

export type FilterCondition =
  | { type: 'return_above'; period: number; threshold: number }
  | { type: 'return_below'; period: number; threshold: number }
  | { type: 'price_above_sma'; period: number }
  | { type: 'price_below_sma'; period: number }
  | { type: 'sma_above_sma'; shortPeriod: number; longPeriod: number }
  | { type: 'rsi_below'; period: number; threshold: number }
  | { type: 'rsi_above'; period: number; threshold: number }
  | { type: 'price_near_sma'; period: number; tolerance: number }
  | { type: 'price_above_highest'; period: number }
  | { type: 'volume_above_avg'; period: number; multiplier: number }
  | { type: 'volume_below_avg'; period: number }
  | { type: 'outperforms_index'; period: number; indexTicker: string };

function evaluateCondition(
  condition: FilterCondition,
  prices: number[],
  dataPoints: HistoricalDataPoint[],
  auxiliaryData?: Record<string, HistoricalDataPoint[]>
): boolean {
  const currentPrice = prices[prices.length - 1];

  switch (condition.type) {
    case 'return_above': {
      const ret = returnNd(prices, condition.period);
      return ret !== undefined && ret > condition.threshold;
    }
    case 'return_below': {
      const ret = returnNd(prices, condition.period);
      return ret !== undefined && ret < condition.threshold;
    }
    case 'price_above_sma': {
      const smaVal = sma(prices, condition.period);
      return smaVal !== undefined && currentPrice > smaVal;
    }
    case 'price_below_sma': {
      const smaVal = sma(prices, condition.period);
      return smaVal !== undefined && currentPrice < smaVal;
    }
    case 'sma_above_sma': {
      const shortSma = sma(prices, condition.shortPeriod);
      const longSma = sma(prices, condition.longPeriod);
      return shortSma !== undefined && longSma !== undefined && shortSma > longSma;
    }
    case 'rsi_below': {
      const rsiVal = rsi(prices, condition.period);
      return rsiVal !== undefined && rsiVal < condition.threshold;
    }
    case 'rsi_above': {
      const rsiVal = rsi(prices, condition.period);
      return rsiVal !== undefined && rsiVal > condition.threshold;
    }
    case 'price_near_sma': {
      const smaVal = sma(prices, condition.period);
      if (smaVal === undefined) return false;
      return Math.abs(currentPrice - smaVal) / smaVal <= condition.tolerance;
    }
    case 'price_above_highest': {
      // Exclude current price — breakout means current price exceeds the highest of the PREVIOUS N periods
      const previousPrices = prices.slice(0, -1);
      const high = highest(previousPrices, condition.period);
      return high !== undefined && currentPrice > high;
    }
    case 'volume_above_avg': {
      const avg = avgVolume(dataPoints, condition.period);
      if (avg === undefined) return false;
      const currentVolume = dataPoints[dataPoints.length - 1].volume;
      return currentVolume > condition.multiplier * avg;
    }
    case 'volume_below_avg': {
      const avg = avgVolume(dataPoints, condition.period);
      if (avg === undefined) return false;
      const currentVolume = dataPoints[dataPoints.length - 1].volume;
      return currentVolume < avg;
    }
    case 'outperforms_index': {
      if (!auxiliaryData || !auxiliaryData[condition.indexTicker]) return false;
      const indexData = auxiliaryData[condition.indexTicker];
      const indexPrices = indexData.map(dp => dp.close);
      const stockReturn = returnNd(prices, condition.period);
      const indexReturn = returnNd(indexPrices, condition.period);
      if (stockReturn === undefined || indexReturn === undefined) return false;
      return stockReturn > indexReturn;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

export function scoreCondition(
  condition: FilterCondition,
  prices: number[],
  dataPoints: HistoricalDataPoint[],
  auxiliaryData?: Record<string, HistoricalDataPoint[]>
): number {
  const currentPrice = prices[prices.length - 1];

  switch (condition.type) {
    case 'return_above': {
      const ret = returnNd(prices, condition.period);
      if (ret === undefined) return 0;
      return clamp(ret / condition.threshold, 0, 1);
    }
    case 'return_below': {
      const ret = returnNd(prices, condition.period);
      if (ret === undefined) return 0;
      if (condition.threshold < 0) {
        return clamp(1 - ret / condition.threshold, 0, 1);
      }
      return clamp((condition.threshold - ret) / condition.threshold, 0, 1);
    }
    case 'price_above_sma': {
      const smaVal = sma(prices, condition.period);
      if (smaVal === undefined) return 0;
      return clamp((currentPrice - smaVal * 0.95) / (smaVal * 0.05), 0, 1);
    }
    case 'price_below_sma': {
      const smaVal = sma(prices, condition.period);
      if (smaVal === undefined) return 0;
      return clamp((smaVal * 1.05 - currentPrice) / (smaVal * 0.05), 0, 1);
    }
    case 'sma_above_sma': {
      const shortSma = sma(prices, condition.shortPeriod);
      const longSma = sma(prices, condition.longPeriod);
      if (shortSma === undefined || longSma === undefined) return 0;
      return clamp((shortSma - longSma * 0.95) / (longSma * 0.05), 0, 1);
    }
    case 'rsi_below': {
      const rsiVal = rsi(prices, condition.period);
      if (rsiVal === undefined) return 0;
      return clamp((condition.threshold + 20 - rsiVal) / 20, 0, 1);
    }
    case 'rsi_above': {
      const rsiVal = rsi(prices, condition.period);
      if (rsiVal === undefined) return 0;
      return clamp((rsiVal - (condition.threshold - 20)) / 20, 0, 1);
    }
    case 'price_near_sma': {
      const smaVal = sma(prices, condition.period);
      if (smaVal === undefined) return 0;
      const distance = Math.abs(currentPrice - smaVal) / smaVal;
      return clamp((condition.tolerance * 2 - distance) / condition.tolerance, 0, 1);
    }
    case 'price_above_highest': {
      const previousPrices = prices.slice(0, -1);
      const high = highest(previousPrices, condition.period);
      if (high === undefined) return 0;
      return clamp((currentPrice - high * 0.95) / (high * 0.05), 0, 1);
    }
    case 'volume_above_avg': {
      const avg = avgVolume(dataPoints, condition.period);
      if (avg === undefined) return 0;
      const currentVolume = dataPoints[dataPoints.length - 1].volume;
      return clamp((currentVolume - avg) / ((condition.multiplier - 1) * avg), 0, 1);
    }
    case 'volume_below_avg': {
      const avg = avgVolume(dataPoints, condition.period);
      if (avg === undefined) return 0;
      const currentVolume = dataPoints[dataPoints.length - 1].volume;
      return clamp((avg * 1.5 - currentVolume) / (avg * 0.5), 0, 1);
    }
    case 'outperforms_index': {
      if (!auxiliaryData || !auxiliaryData[condition.indexTicker]) return 0;
      const indexData = auxiliaryData[condition.indexTicker];
      const indexPrices = indexData.map(dp => dp.close);
      const stockReturn = returnNd(prices, condition.period);
      const indexReturn = returnNd(indexPrices, condition.period);
      if (stockReturn === undefined || indexReturn === undefined) return 0;
      const diff = stockReturn - indexReturn;
      return clamp((diff + 5) / 5, 0, 1);
    }
  }
}

export function scoreConditions(
  conditions: FilterCondition[],
  prices: number[],
  dataPoints: HistoricalDataPoint[],
  auxiliaryData?: Record<string, HistoricalDataPoint[]>
): number {
  if (conditions.length === 0) return 1;
  const total = conditions.reduce(
    (sum, c) => sum + scoreCondition(c, prices, dataPoints, auxiliaryData),
    0
  );
  return total / conditions.length;
}

export function evaluateConditions(
  conditions: FilterCondition[],
  prices: number[],
  dataPoints: HistoricalDataPoint[],
  auxiliaryData?: Record<string, HistoricalDataPoint[]>
): boolean {
  if (conditions.length === 0) return true;
  return conditions.every(c => evaluateCondition(c, prices, dataPoints, auxiliaryData));
}
