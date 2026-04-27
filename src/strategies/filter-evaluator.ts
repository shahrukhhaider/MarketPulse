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

export function evaluateConditions(
  conditions: FilterCondition[],
  prices: number[],
  dataPoints: HistoricalDataPoint[],
  auxiliaryData?: Record<string, HistoricalDataPoint[]>
): boolean {
  if (conditions.length === 0) return true;
  return conditions.every(c => evaluateCondition(c, prices, dataPoints, auxiliaryData));
}
