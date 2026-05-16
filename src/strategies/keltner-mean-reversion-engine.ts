import type {
  StrategyType,
  HistoricalDataPoint,
  V2Signal,
  V2CompatibleEngine,
  SignalDirection,
} from '../types.js';
import type {
  KeltnerMeanReversionConfiguration,
  KeltnerMeanReversionParams,
} from './strategy-configs.js';
import { ema, atr, sma, swingLow } from '../indicators/indicators.js';
import type { IndicatorCache } from '../indicators/indicator-cache.js';

// ============================================================
// Result interfaces
// ============================================================

export interface KeltnerBands {
  midline: number;
  upperBand: number;
  lowerBand: number;
}

export interface DipResult {
  detected: boolean;
  dipBarIndex: number; // -1 if no dip
}

export interface EntryResult {
  entryPrice: number;
  stopLossPrice: number;
  profitTargetPrice: number;
  rValue: number;
  confidenceScore: number;
}

// ============================================================
// Helpers
// ============================================================

// Fast signal ID generator — avoids crypto.randomUUID() overhead in hot loops
let _kmrSignalCounter = 0;
function fastSignalId(): string {
  return `kmr${++_kmrSignalCounter}`;
}

/**
 * Compute confidence score for active signals.
 * Linearly scales from 0.6 (at max risk) to 1.0 (at zero risk).
 * Returns 0.5 when maxRiskPct <= 0.
 */
function computeActiveConfidence(riskPct: number, maxRiskPct: number): number {
  if (maxRiskPct <= 0) return 0.5;
  const ratio = Math.min(riskPct / maxRiskPct, 1);
  return 0.6 + (1 - ratio) * 0.4;
}

/**
 * Precompute the full EMA series for a given close array and period.
 * Returns an array where result[i] is the EMA value at bar i (undefined if insufficient data).
 */
function precomputeEmaSeries(closes: number[], period: number): (number | undefined)[] {
  const len = closes.length;
  const result: (number | undefined)[] = new Array(len);

  if (period < 1) {
    result.fill(undefined);
    return result;
  }

  // Fill undefined for bars before we have enough data
  for (let i = 0; i < Math.min(period - 1, len); i++) {
    result[i] = undefined;
  }

  if (len < period) return result;

  // Seed with SMA of first `period` values
  const multiplier = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += closes[i];
  }
  let value = sum / period;
  result[period - 1] = value;

  // Iteratively compute EMA for remaining bars
  for (let i = period; i < len; i++) {
    value = (closes[i] - value) * multiplier + value;
    result[i] = value;
  }

  return result;
}

// ============================================================
// KeltnerMeanReversionEngine
// ============================================================

export class KeltnerMeanReversionEngine implements V2CompatibleEngine {
  type: StrategyType = 'keltner_mean_reversion';

  // Internal state for bar-by-bar evaluation
  private positionOpen = false;
  private entryPrice = 0;
  private stopLossPrice = 0;
  private profitTargetPrice = 0;
  private rValue = 0;
  private currentBarIndex = 0;

  // Precomputed series for fast backtest evaluation
  private emaSeries: (number | undefined)[] | null = null;
  private atrSeries: (number | undefined)[] | null = null;
  private smaSeries: (number | undefined)[] | null = null;
  private swingLowSeries: (number | undefined)[] | null = null;

  reset(): void {
    this.positionOpen = false;
    this.entryPrice = 0;
    this.stopLossPrice = 0;
    this.profitTargetPrice = 0;
    this.rValue = 0;
    this.currentBarIndex = 0;
    this.emaSeries = null;
    this.atrSeries = null;
    this.smaSeries = null;
    this.swingLowSeries = null;
  }

  minimumDataPointsForParams(params: KeltnerMeanReversionParams): number {
    const { config } = params;
    return Math.max(config.ema_period, config.atr_period + 1, config.trend_filter_period);
  }

  // ============================================================
  // Static detection methods (used by signal-detector for single-bar evaluation)
  // ============================================================

  /**
   * Compute Keltner Bands at a given bar index.
   * Returns undefined if insufficient data.
   */
  static computeBands(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    config: KeltnerMeanReversionConfiguration,
    cache?: IndicatorCache
  ): KeltnerBands | undefined {
    const barsAvailable = barIndex + 1;
    const minRequired = Math.max(config.ema_period, config.atr_period + 1);

    if (barsAvailable < minRequired) return undefined;

    // Compute midline: EMA of closes
    const closes = dataPoints.slice(0, barIndex + 1).map(d => d.close);
    const midline = ema(closes, config.ema_period);
    if (midline === undefined) return undefined;

    // Compute ATR (use cache if available)
    let atrValue: number | undefined;
    if (cache) {
      atrValue = cache.getAtr(config.atr_period, barIndex);
    }
    if (atrValue === undefined) {
      const atrSlice = dataPoints.slice(0, barIndex + 1);
      atrValue = atr(atrSlice, config.atr_period);
    }
    if (atrValue === undefined) return undefined;

    const lowerBand = midline - config.band_multiplier * atrValue;
    const upperBand = midline + config.band_multiplier * atrValue;

    return { midline, upperBand, lowerBand };
  }

  /**
   * Detect if a dip below the lower Keltner Band occurred within the reclaim_lookback window.
   */
  static detectDip(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    config: KeltnerMeanReversionConfiguration,
    cache?: IndicatorCache
  ): DipResult {
    const lookback = config.reclaim_lookback;
    const startBar = Math.max(0, barIndex - lookback + 1);

    for (let i = barIndex; i >= startBar; i--) {
      const bands = KeltnerMeanReversionEngine.computeBands(dataPoints, i, config, cache);
      if (bands === undefined) continue;

      if (dataPoints[i].close < bands.lowerBand) {
        return { detected: true, dipBarIndex: i };
      }
    }

    return { detected: false, dipBarIndex: -1 };
  }

  /**
   * Determine if an entry should be taken at the given bar.
   * Used by signal-detector for single-bar evaluation.
   */
  static shouldEnter(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    config: KeltnerMeanReversionConfiguration,
    cache?: IndicatorCache
  ): EntryResult | null {
    const barsAvailable = barIndex + 1;

    // ---- Step 1: Uptrend filter ----
    if (barsAvailable < config.trend_filter_period) return null;

    const currentClose = dataPoints[barIndex].close;
    let trendSma: number | undefined;
    if (cache) {
      trendSma = cache.getSma(config.trend_filter_period, barIndex);
    }
    if (trendSma === undefined) {
      const closes = dataPoints.slice(0, barIndex + 1).map(d => d.close);
      trendSma = sma(closes, config.trend_filter_period);
    }
    if (trendSma === undefined) return null;
    if (currentClose <= trendSma) return null;

    // ---- Step 2: Compute bands ----
    const bands = KeltnerMeanReversionEngine.computeBands(dataPoints, barIndex, config, cache);
    if (bands === undefined) return null;

    // ---- Step 3: Detect dip ----
    const dip = KeltnerMeanReversionEngine.detectDip(dataPoints, barIndex, config, cache);
    if (!dip.detected) return null;

    // ---- Step 4: Reclaim check ----
    if (currentClose <= bands.lowerBand) return null;

    // ---- Step 5: Compute stop-loss ----
    const entryPrice = currentClose;

    let atrValue: number | undefined;
    if (cache) {
      atrValue = cache.getAtr(config.atr_period, barIndex);
    }
    if (atrValue === undefined) {
      const atrSlice = dataPoints.slice(0, barIndex + 1);
      atrValue = atr(atrSlice, config.atr_period);
    }
    if (atrValue === undefined) return null;

    const atrStop = entryPrice - config.stop_atr_multiple * atrValue;

    let swingLowValue: number | undefined;
    if (cache) {
      swingLowValue = cache.getSwingLow(config.reclaim_lookback, barIndex);
    }
    if (swingLowValue === undefined) {
      const swingLowSlice = dataPoints.slice(0, barIndex + 1);
      swingLowValue = swingLow(swingLowSlice, config.reclaim_lookback);
    }
    if (swingLowValue === undefined) return null;

    const structureStop = swingLowValue - 0.3 * atrValue;
    const stopLossPrice = Math.max(atrStop, structureStop);

    // ---- Step 6: Validate rValue ----
    const rValueCalc = entryPrice - stopLossPrice;
    if (rValueCalc <= 0) return null;

    // ---- Step 7: Compute profit target and confidence ----
    const profitTargetPrice = entryPrice + config.r_multiple * rValueCalc;
    const riskPct = (rValueCalc / entryPrice) * 100;
    const confidenceScore = computeActiveConfidence(riskPct, config.max_risk_pct);

    return {
      entryPrice,
      stopLossPrice,
      profitTargetPrice,
      rValue: rValueCalc,
      confidenceScore,
    };
  }

  // ============================================================
  // Fast precomputed entry check (used during backtest loop)
  // ============================================================

  /**
   * Fast shouldEnter using precomputed series. O(1) per bar for indicator lookups.
   */
  private shouldEnterFast(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    config: KeltnerMeanReversionConfiguration
  ): EntryResult | null {
    // ---- Step 1: Uptrend filter ----
    const trendSma = this.smaSeries![barIndex];
    if (trendSma === undefined) return null;
    const currentClose = dataPoints[barIndex].close;
    if (currentClose <= trendSma) return null;

    // ---- Step 2: Compute bands from precomputed series ----
    const midline = this.emaSeries![barIndex];
    const atrValue = this.atrSeries![barIndex];
    if (midline === undefined || atrValue === undefined) return null;

    const lowerBand = midline - config.band_multiplier * atrValue;

    // ---- Step 3: Detect dip in lookback window ----
    const lookback = config.reclaim_lookback;
    const startBar = Math.max(0, barIndex - lookback + 1);
    let dipDetected = false;

    for (let i = barIndex; i >= startBar; i--) {
      const mid = this.emaSeries![i];
      const atrVal = this.atrSeries![i];
      if (mid === undefined || atrVal === undefined) continue;
      const lb = mid - config.band_multiplier * atrVal;
      if (dataPoints[i].close < lb) {
        dipDetected = true;
        break;
      }
    }
    if (!dipDetected) return null;

    // ---- Step 4: Reclaim check ----
    if (currentClose <= lowerBand) return null;

    // ---- Step 5: Compute stop-loss ----
    const entryPrice = currentClose;
    const atrStop = entryPrice - config.stop_atr_multiple * atrValue;

    const swingLowValue = this.swingLowSeries![barIndex];
    if (swingLowValue === undefined) return null;

    const structureStop = swingLowValue - 0.3 * atrValue;
    const stopLossPrice = Math.max(atrStop, structureStop);

    // ---- Step 6: Validate rValue ----
    const rValueCalc = entryPrice - stopLossPrice;
    if (rValueCalc <= 0) return null;

    // ---- Step 7: Compute profit target and confidence ----
    const profitTargetPrice = entryPrice + config.r_multiple * rValueCalc;
    const riskPct = (rValueCalc / entryPrice) * 100;
    const confidenceScore = computeActiveConfidence(riskPct, config.max_risk_pct);

    return {
      entryPrice,
      stopLossPrice,
      profitTargetPrice,
      rValue: rValueCalc,
      confidenceScore,
    };
  }

  // ============================================================
  // Instance methods (V2CompatibleEngine)
  // ============================================================

  /**
   * Bar-by-bar evaluation for backtest integration.
   * Precomputes EMA, ATR, SMA, and swingLow series on first call for O(1) per-bar lookups.
   */
  evaluateWithOHLCV(dataPoints: HistoricalDataPoint[], params: KeltnerMeanReversionParams): V2Signal {
    if (!dataPoints || dataPoints.length === 0) {
      return {
        id: fastSignalId(),
        ticker: '',
        direction: 'HOLD' as SignalDirection,
        strategyType: this.type,
        price: 0,
        timestamp: '',
      };
    }

    const { config, cache } = params;
    const ticker = (params as any).ticker ?? '';

    // Precompute indicator series on first bar (O(n) once, then O(1) per bar)
    if (this.emaSeries === null) {
      const len = dataPoints.length;
      const closes = new Array<number>(len);
      for (let i = 0; i < len; i++) closes[i] = dataPoints[i].close;

      this.emaSeries = precomputeEmaSeries(closes, config.ema_period);

      // Precompute ATR series
      if (cache) {
        // Use cache if available
        this.atrSeries = new Array(len);
        for (let i = 0; i < len; i++) {
          this.atrSeries[i] = cache.getAtr(config.atr_period, i);
        }
      } else {
        this.atrSeries = new Array(len);
        for (let i = 0; i < len; i++) {
          this.atrSeries[i] = atr(dataPoints.slice(0, i + 1), config.atr_period);
        }
      }

      // Precompute SMA series (trend filter)
      if (cache) {
        this.smaSeries = new Array(len);
        for (let i = 0; i < len; i++) {
          this.smaSeries[i] = cache.getSma(config.trend_filter_period, i);
        }
      } else {
        this.smaSeries = new Array(len);
        for (let i = 0; i < len; i++) {
          this.smaSeries[i] = sma(closes.slice(0, i + 1), config.trend_filter_period);
        }
      }

      // Precompute swingLow series
      if (cache) {
        this.swingLowSeries = new Array(len);
        for (let i = 0; i < len; i++) {
          this.swingLowSeries[i] = cache.getSwingLow(config.reclaim_lookback, i);
        }
      } else {
        this.swingLowSeries = new Array(len);
        for (let i = 0; i < len; i++) {
          this.swingLowSeries[i] = swingLow(dataPoints.slice(0, i + 1), config.reclaim_lookback);
        }
      }
    }

    const currentBar = dataPoints[this.currentBarIndex];
    this.currentBarIndex++;

    if (!currentBar) {
      return {
        id: fastSignalId(),
        ticker,
        direction: 'HOLD' as SignalDirection,
        strategyType: this.type,
        price: 0,
        timestamp: '',
      };
    }

    if (this.positionOpen) {
      // Priority 1: Stop-loss hit
      if (currentBar.low <= this.stopLossPrice) {
        this.positionOpen = false;
        const signal: V2Signal = {
          id: fastSignalId(),
          ticker,
          direction: 'SELL' as SignalDirection,
          strategyType: this.type,
          price: this.stopLossPrice,
          timestamp: currentBar.date,
          exitReason: 'stop_loss',
          stopLossPrice: this.stopLossPrice,
          profitTargetPrice: this.profitTargetPrice,
          rValue: this.rValue,
        };
        this.entryPrice = 0;
        this.stopLossPrice = 0;
        this.profitTargetPrice = 0;
        this.rValue = 0;
        return signal;
      }

      // Priority 2: Profit target hit
      if (currentBar.high >= this.profitTargetPrice) {
        this.positionOpen = false;
        const signal: V2Signal = {
          id: fastSignalId(),
          ticker,
          direction: 'SELL' as SignalDirection,
          strategyType: this.type,
          price: this.profitTargetPrice,
          timestamp: currentBar.date,
          exitReason: 'profit_target',
          stopLossPrice: this.stopLossPrice,
          profitTargetPrice: this.profitTargetPrice,
          rValue: this.rValue,
        };
        this.entryPrice = 0;
        this.stopLossPrice = 0;
        this.profitTargetPrice = 0;
        this.rValue = 0;
        return signal;
      }

      // No exit — HOLD
      return {
        id: fastSignalId(),
        ticker,
        direction: 'HOLD' as SignalDirection,
        strategyType: this.type,
        price: currentBar.close,
        timestamp: currentBar.date,
      };
    }

    // Position not open — check for entry using fast precomputed path
    const barIndex = this.currentBarIndex - 1;
    const entryResult = this.shouldEnterFast(dataPoints, barIndex, config);

    if (entryResult) {
      this.positionOpen = true;
      this.entryPrice = entryResult.entryPrice;
      this.stopLossPrice = entryResult.stopLossPrice;
      this.profitTargetPrice = entryResult.profitTargetPrice;
      this.rValue = entryResult.rValue;

      return {
        id: fastSignalId(),
        ticker,
        direction: 'BUY' as SignalDirection,
        strategyType: this.type,
        price: entryResult.entryPrice,
        timestamp: currentBar.date,
        stopLossPrice: entryResult.stopLossPrice,
        profitTargetPrice: entryResult.profitTargetPrice,
        rValue: entryResult.rValue,
      };
    }

    // No entry — HOLD
    return {
      id: fastSignalId(),
      ticker,
      direction: 'HOLD' as SignalDirection,
      strategyType: this.type,
      price: currentBar.close,
      timestamp: currentBar.date,
    };
  }
}
