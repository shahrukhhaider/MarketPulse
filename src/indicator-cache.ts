import type { HistoricalDataPoint } from './types.js';
import { sma, atr, atr_ratio, avgVolume, swingLow, sma_slope, range_pct, highestHigh } from './indicators.js';

export interface IndicatorCacheConfig {
  smaPeriods: number[];
  atrPeriods: number[];
  atrRatioPairs: [number, number][];
  avgVolumePeriods: number[];
  swingLowLookbacks: number[];
  smaSlopePeriods: number[];
  rangePctWindows: number[];
  highestHighLookbacks: number[];
}

export class IndicatorCache {
  private readonly smaMap: Map<number, (number | undefined)[]>;
  private readonly atrMap: Map<number, (number | undefined)[]>;
  private readonly atrRatioMap: Map<string, (number | undefined)[]>;
  private readonly avgVolumeMap: Map<number, (number | undefined)[]>;
  private readonly swingLowMap: Map<number, (number | undefined)[]>;
  private readonly smaSlopeMap: Map<number, (boolean | undefined)[]>;
  private readonly rangePctMap: Map<number, (number | undefined)[]>;
  private readonly highestHighMap: Map<number, (number | undefined)[]>;

  constructor(data: HistoricalDataPoint[], config: IndicatorCacheConfig) {
    const len = data.length;

    // Initialize maps with empty arrays
    this.smaMap = new Map();
    for (const period of config.smaPeriods) {
      this.smaMap.set(period, new Array(len));
    }

    this.atrMap = new Map();
    for (const period of config.atrPeriods) {
      this.atrMap.set(period, new Array(len));
    }

    this.atrRatioMap = new Map();
    for (const [short, long] of config.atrRatioPairs) {
      this.atrRatioMap.set(`${short}:${long}`, new Array(len));
    }

    this.avgVolumeMap = new Map();
    for (const period of config.avgVolumePeriods) {
      this.avgVolumeMap.set(period, new Array(len));
    }

    this.swingLowMap = new Map();
    for (const lookback of config.swingLowLookbacks) {
      this.swingLowMap.set(lookback, new Array(len));
    }

    this.smaSlopeMap = new Map();
    for (const period of config.smaSlopePeriods) {
      this.smaSlopeMap.set(period, new Array(len));
    }

    this.rangePctMap = new Map();
    for (const window of config.rangePctWindows) {
      this.rangePctMap.set(window, new Array(len));
    }

    this.highestHighMap = new Map();
    for (const lookback of config.highestHighLookbacks) {
      this.highestHighMap.set(lookback, new Array(len));
    }

    // Pre-compute all indicator series
    const allCloses: number[] = new Array(len);
    for (let i = 0; i < len; i++) {
      allCloses[i] = data[i].close;
    }

    for (let i = 0; i < len; i++) {
      const closes = allCloses.slice(0, i + 1);
      const dataSlice = data.slice(0, i + 1);

      // SMA
      for (const period of config.smaPeriods) {
        this.smaMap.get(period)![i] = sma(closes, period);
      }

      // ATR
      for (const period of config.atrPeriods) {
        this.atrMap.get(period)![i] = atr(dataSlice, period);
      }

      // ATR Ratio
      for (const [short, long] of config.atrRatioPairs) {
        this.atrRatioMap.get(`${short}:${long}`)![i] = atr_ratio(dataSlice, short, long);
      }

      // Average Volume
      for (const period of config.avgVolumePeriods) {
        this.avgVolumeMap.get(period)![i] = avgVolume(dataSlice, period);
      }

      // Swing Low
      for (const lookback of config.swingLowLookbacks) {
        this.swingLowMap.get(lookback)![i] = swingLow(dataSlice, lookback);
      }

      // SMA Slope
      for (const period of config.smaSlopePeriods) {
        this.smaSlopeMap.get(period)![i] = sma_slope(closes, period);
      }

      // Range Pct
      for (const window of config.rangePctWindows) {
        this.rangePctMap.get(window)![i] = range_pct(dataSlice, window);
      }

      // Highest High
      for (const lookback of config.highestHighLookbacks) {
        this.highestHighMap.get(lookback)![i] = highestHigh(dataSlice, lookback);
      }
    }
  }

  getSma(period: number, barIndex: number): number | undefined {
    const series = this.smaMap.get(period);
    if (!series || barIndex < 0 || barIndex >= series.length) return undefined;
    return series[barIndex];
  }

  getAtr(period: number, barIndex: number): number | undefined {
    const series = this.atrMap.get(period);
    if (!series || barIndex < 0 || barIndex >= series.length) return undefined;
    return series[barIndex];
  }

  getAtrRatio(shortPeriod: number, longPeriod: number, barIndex: number): number | undefined {
    const series = this.atrRatioMap.get(`${shortPeriod}:${longPeriod}`);
    if (!series || barIndex < 0 || barIndex >= series.length) return undefined;
    return series[barIndex];
  }

  getAvgVolume(period: number, barIndex: number): number | undefined {
    const series = this.avgVolumeMap.get(period);
    if (!series || barIndex < 0 || barIndex >= series.length) return undefined;
    return series[barIndex];
  }

  getSwingLow(lookback: number, barIndex: number): number | undefined {
    const series = this.swingLowMap.get(lookback);
    if (!series || barIndex < 0 || barIndex >= series.length) return undefined;
    return series[barIndex];
  }

  getSmaSlope(period: number, barIndex: number): boolean | undefined {
    const series = this.smaSlopeMap.get(period);
    if (!series || barIndex < 0 || barIndex >= series.length) return undefined;
    return series[barIndex];
  }

  getRangePct(window: number, barIndex: number): number | undefined {
    const series = this.rangePctMap.get(window);
    if (!series || barIndex < 0 || barIndex >= series.length) return undefined;
    return series[barIndex];
  }

  getHighestHigh(lookback: number, barIndex: number): number | undefined {
    const series = this.highestHighMap.get(lookback);
    if (!series || barIndex < 0 || barIndex >= series.length) return undefined;
    return series[barIndex];
  }
}

export function getDefaultCacheConfig(): IndicatorCacheConfig {
  return {
    smaPeriods: [10, 20, 50],
    atrPeriods: [5, 14, 20],
    atrRatioPairs: [[5, 20]],
    avgVolumePeriods: [20],
    swingLowLookbacks: [5, 10, 15, 20],
    smaSlopePeriods: [50],
    rangePctWindows: [5, 10, 15],
    highestHighLookbacks: [5, 10, 15, 20],
  };
}
