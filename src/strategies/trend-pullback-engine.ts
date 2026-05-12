import crypto from 'node:crypto';
import type {
  StrategyType,
  HistoricalDataPoint,
  V2Signal,
  V2CompatibleEngine,
  SignalDirection,
} from '../types.js';
import type {
  TrendPullbackConfiguration,
  TrendPullbackParams,
} from './strategy-configs.js';
import { sma, sma_slope, atr, atr_ratio, avgVolume, swingLow } from '../indicators.js';
import type { IndicatorCache } from '../indicator-cache.js';
import { computeConfidenceScore, DEFAULT_WEIGHTS } from '../confidence-score.js';

// ============================================================
// Result interfaces for standalone detection functions
// ============================================================

export interface PullbackResult {
  detected: boolean;
  swingLow: number;
  pullbackBar: number;
}

export interface DirectionConfig {
  require_sma20_above_sma50: boolean;
  require_sma50_slope_positive: boolean;
}

export interface SetupConfig {
  pullback_proximity_pct: number;
  atr_contraction_threshold: number;
  volume_below_avg_multiplier: number;
  swing_lookback: number;
  max_pullback_staleness: number;
}

export interface TriggerConfig {
  trigger_volume_multiplier: number;
}

export interface EntryResult {
  entryPrice: number;
  stopLossPrice: number;
  profitTargetPrice: number;
  rValue: number;
  confidenceScore: number;
}

// ============================================================
// TrendPullbackEngine
// ============================================================

export class TrendPullbackEngine implements V2CompatibleEngine {
  type: StrategyType = 'trend_pullback';

  // Internal state
  private positionOpen = false;
  private entryPrice = 0;
  private stopLossPrice = 0;
  private profitTargetPrice = 0;
  private currentBarIndex = 0;
  private effectiveStopLoss = 0;
  private originalStopLoss = 0;
  private highestCloseSinceEntry = 0;
  private rValue = 0;

  reset(): void {
    this.positionOpen = false;
    this.entryPrice = 0;
    this.stopLossPrice = 0;
    this.profitTargetPrice = 0;
    this.currentBarIndex = 0;
    this.effectiveStopLoss = 0;
    this.originalStopLoss = 0;
    this.highestCloseSinceEntry = 0;
    this.rValue = 0;
  }

  minimumDataPointsForParams(params: TrendPullbackParams): number {
    const { config } = params;
    let maxPeriod = 0;

    // SMA(50) for direction check and trend exit
    maxPeriod = Math.max(maxPeriod, 50);

    // SMA(20) for pullback proximity
    maxPeriod = Math.max(maxPeriod, 20);

    // SMA(10) for trigger
    maxPeriod = Math.max(maxPeriod, 10);

    // ATR(20) needs period + 1 data points
    maxPeriod = Math.max(maxPeriod, 21);

    // ATR(14) for stop-loss computation needs period + 1
    maxPeriod = Math.max(maxPeriod, 15);

    // Swing lookback
    maxPeriod = Math.max(maxPeriod, config.pullback.swing_lookback);

    // Trend exit SMA period
    maxPeriod = Math.max(maxPeriod, config.trendExit.trend_exit_sma_period);

    // avgVolume(20) needs 20 data points
    maxPeriod = Math.max(maxPeriod, 20);

    return maxPeriod;
  }

  // ============================================================
  // Static detection functions
  // ============================================================

  /**
   * Detect whether an established uptrend exists at the given bar.
   *
   * Conditions:
   *  1. close > SMA(50) (always required)
   *  2. (optional) SMA(20) >= SMA(50) when require_sma20_above_sma50 is true
   *  3. (optional) SMA(50) slope positive when require_sma50_slope_positive is true
   *
   * Returns false when insufficient data (< 50 bars).
   */
  static detectDirection(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    config: DirectionConfig,
    cache?: IndicatorCache
  ): boolean {
    const slice = dataPoints.slice(0, barIndex + 1);

    // Need at least 50 bars for SMA(50)
    if (slice.length < 50) return false;

    const closes = slice.map(d => d.close);
    const currentClose = closes[closes.length - 1];

    // 1. close > SMA(50) — always required
    const sma50 = cache ? cache.getSma(50, barIndex) : sma(closes, 50);
    if (sma50 === undefined) return false;
    if (currentClose <= sma50) return false;

    // 2. Optional: SMA(20) >= SMA(50)
    if (config.require_sma20_above_sma50) {
      const sma20 = cache ? cache.getSma(20, barIndex) : sma(closes, 20);
      if (sma20 === undefined) return false;
      if (sma20 < sma50) return false;
    }

    // 3. Optional: SMA(50) slope positive
    if (config.require_sma50_slope_positive) {
      const slope = cache ? cache.getSmaSlope(50, barIndex) : sma_slope(closes, 50);
      if (slope === undefined || slope === false) return false;
    }

    return true;
  }

  /**
   * Detect a valid pullback to SMA(20) with volatility contraction and below-average volume.
   *
   * Conditions:
   *  1. close within pullback_proximity_pct of SMA(20)
   *  2. ATR(5)/ATR(20) < atr_contraction_threshold
   *  3. volume < avgVolume(20) × volume_below_avg_multiplier
   *
   * Returns swing low over swing_lookback period when detected.
   * Returns { detected: false, swingLow: 0, pullbackBar: barIndex } on insufficient data.
   */
  static detectPullback(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    config: SetupConfig,
    cache?: IndicatorCache
  ): PullbackResult {
    const notDetected: PullbackResult = {
      detected: false,
      swingLow: 0,
      pullbackBar: barIndex,
    };

    const slice = dataPoints.slice(0, barIndex + 1);

    // Need enough data for ATR(20) (21 points), SMA(20), avgVolume(20), and swing_lookback
    const minRequired = Math.max(21, 20, config.swing_lookback);
    if (slice.length < minRequired) return notDetected;

    const closes = slice.map(d => d.close);
    const currentClose = closes[closes.length - 1];

    // 1. Check close within pullback_proximity_pct of SMA(20)
    const sma20 = cache ? cache.getSma(20, barIndex) : sma(closes, 20);
    if (sma20 === undefined || sma20 === 0) return notDetected;

    const distancePct = Math.abs(currentClose - sma20) / sma20 * 100;
    if (distancePct > config.pullback_proximity_pct) return notDetected;

    // 2. Check ATR(5)/ATR(20) < atr_contraction_threshold
    const atrRat = cache ? cache.getAtrRatio(5, 20, barIndex) : atr_ratio(slice, 5, 20);
    if (atrRat === undefined) return notDetected;
    if (atrRat >= config.atr_contraction_threshold) return notDetected;

    // 3. Check volume < avgVolume(20) × volume_below_avg_multiplier
    const currentVolume = slice[slice.length - 1].volume;
    const avg20Vol = cache ? cache.getAvgVolume(20, barIndex) : avgVolume(slice, 20);
    if (avg20Vol === undefined) return notDetected;
    if (currentVolume >= avg20Vol * config.volume_below_avg_multiplier) return notDetected;

    // All conditions pass — compute swing low over swing_lookback period
    const swingLowVal = cache ? cache.getSwingLow(config.swing_lookback, barIndex) : swingLow(slice, config.swing_lookback);
    if (swingLowVal === undefined) return notDetected;

    return {
      detected: true,
      swingLow: swingLowVal,
      pullbackBar: barIndex,
    };
  }

  /**
   * Detect a trigger confirming trend resumption.
   *
   * Conditions:
   *  1. close > SMA(10)
   *  2. volume > avgVolume(20) × trigger_volume_multiplier
   *
   * Returns false on insufficient data or when conditions fail.
   */
  static detectTrigger(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    config: TriggerConfig,
    cache?: IndicatorCache
  ): boolean {
    const slice = dataPoints.slice(0, barIndex + 1);

    // Need at least 20 bars for avgVolume(20) and 10 for SMA(10)
    if (slice.length < 20) return false;

    const closes = slice.map(d => d.close);
    const currentClose = closes[closes.length - 1];

    // 1. Check close > SMA(10)
    const sma10 = cache ? cache.getSma(10, barIndex) : sma(closes, 10);
    if (sma10 === undefined) return false;
    if (currentClose <= sma10) return false;

    // 2. Check volume > avgVolume(20) × trigger_volume_multiplier
    const currentVolume = slice[slice.length - 1].volume;
    const avg20Vol = cache ? cache.getAvgVolume(20, barIndex) : avgVolume(slice, 20);
    if (avg20Vol === undefined) return false;
    if (currentVolume <= avg20Vol * config.trigger_volume_multiplier) return false;

    return true;
  }



  /**
   * Orchestrate all entry checks in order:
   * 1. Direction check
   * 2. Scan backwards for pullback within staleness window
   * 3. Trigger check on current bar
   * 4. Overextension filter
   * 5. Compute stop-loss
   * 6. Risk validation (rValue > 0)
   * 7. Compute profit target
   */
  static shouldEnter(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    config: TrendPullbackConfiguration,
    cache?: IndicatorCache
  ): EntryResult | null {
    const slice = dataPoints.slice(0, barIndex + 1);

    // Need sufficient data for SMA(50) at minimum
    if (slice.length < 50) return null;

    const closes = slice.map(d => d.close);
    const currentClose = closes[closes.length - 1];

    // ---- Step 1: Direction check ----
    const directionPassed = TrendPullbackEngine.detectDirection(
      dataPoints,
      barIndex,
      config.direction,
      cache
    );
    if (!directionPassed) return null;

    // ---- Step 2: Scan backwards for pullback within staleness window ----
    let pullback: PullbackResult | null = null;
    const maxStaleness = config.pullback.max_pullback_staleness;

    for (let i = barIndex; i >= Math.max(barIndex - maxStaleness, 0); i--) {
      const result = TrendPullbackEngine.detectPullback(
        dataPoints,
        i,
        {
          pullback_proximity_pct: config.pullback.pullback_proximity_pct,
          atr_contraction_threshold: config.pullback.atr_contraction_threshold,
          volume_below_avg_multiplier: config.pullback.volume_below_avg_multiplier,
          swing_lookback: config.pullback.swing_lookback,
          max_pullback_staleness: config.pullback.max_pullback_staleness,
        },
        cache
      );
      if (result.detected) {
        pullback = result;
        break;
      }
    }

    if (!pullback) return null;

    // ---- Step 3: Trigger check on current bar ----
    const triggerPassed = TrendPullbackEngine.detectTrigger(
      dataPoints,
      barIndex,
      config.trigger,
      cache
    );
    if (!triggerPassed) return null;

    // ---- Step 4: Overextension filter ----
    const sma20 = cache ? cache.getSma(20, barIndex) : sma(closes, 20);
    const sma50 = cache ? cache.getSma(50, barIndex) : sma(closes, 50);
    if (sma20 === undefined || sma20 === 0) return null;
    if (sma50 === undefined || sma50 === 0) return null;

    const distSMA20 = Math.abs(currentClose - sma20) / sma20 * 100;
    const distSMA50 = Math.abs(currentClose - sma50) / sma50 * 100;

    // Reject if BOTH distances exceed their limits
    if (distSMA20 > config.overextension.overextension_pct &&
        distSMA50 > config.overextension.overextension_pct * 1.5) {
      return null;
    }

    // ---- Step 5: Compute stop-loss ----
    const entryPrice = currentClose;

    const atr14 = cache ? cache.getAtr(14, barIndex) : atr(slice, 14);
    if (atr14 === undefined) return null;

    // ATR-based stop
    const atrStop = entryPrice - config.stopLoss.stop_atr_multiple * atr14;

    // Structure-based stop (swing low - buffer)
    const structureStop = pullback.swingLow - config.stopLoss.stop_buffer_atr * atr14;

    // Take the tighter (higher) stop
    const stopLossPrice = Math.max(atrStop, structureStop);

    // ---- Step 6: Risk validation ----
    const rValue = entryPrice - stopLossPrice;
    if (rValue <= 0) return null;

    // ---- Step 7: Compute profit target ----
    const profitTargetPrice = entryPrice + config.profitTarget.r_multiple * rValue;

    // ---- Step 8: Compute confidence score ----
    const weights = config.confidenceWeights ?? DEFAULT_WEIGHTS;
    const confidenceScore = cache
      ? computeConfidenceScore(barIndex, cache, weights)
      : 0.5;

    return {
      entryPrice,
      stopLossPrice,
      profitTargetPrice,
      rValue,
      confidenceScore,
    };
  }

  /**
   * Compute the trailing stop level for a given bar using the specified method.
   *
   * - 'sma20': SMA(20) - (smaTrailBuffer × ATR(14))
   * - 'atr' with reference 'close': close - (atrTrailMultiple × ATR(14))
   * - 'atr' with reference 'highest_close': highestCloseSinceEntry - (atrTrailMultiple × ATR(14))
   *
   * Returns undefined if required indicators are unavailable.
   */
  static computeTrailingStop(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    method: 'sma20' | 'atr',
    config: {
      smaTrailBuffer?: number;
      atrTrailMultiple?: number;
      atrTrailReference?: 'close' | 'highest_close';
    },
    highestCloseSinceEntry: number,
    cache?: IndicatorCache
  ): number | undefined {
    const slice = dataPoints.slice(0, barIndex + 1);

    // ATR(14) is required for all methods
    const atr14 = cache ? cache.getAtr(14, barIndex) : atr(slice, 14);
    if (atr14 === undefined) return undefined;

    if (method === 'sma20') {
      const closes = slice.map(d => d.close);
      const sma20 = cache ? cache.getSma(20, barIndex) : sma(closes, 20);
      if (sma20 === undefined) return undefined;

      const buffer = config.smaTrailBuffer ?? 0;
      return sma20 - buffer * atr14;
    }

    // method === 'atr'
    const multiple = config.atrTrailMultiple ?? 0;
    const reference = config.atrTrailReference ?? 'close';

    if (reference === 'highest_close') {
      return highestCloseSinceEntry - multiple * atr14;
    }

    // reference === 'close'
    const currentClose = slice[slice.length - 1].close;
    return currentClose - multiple * atr14;
  }

  /**
   * Validate all configuration parameters.
   * Returns { valid: true } if all checks pass, or { valid: false, error } with a descriptive message.
   */
  validateParams(params: TrendPullbackParams): { valid: boolean; error?: string } {
    const { config } = params;

    if (!config) {
      return { valid: false, error: 'Missing strategy configuration' };
    }

    // pullback_proximity_pct in (0, 100]
    if (config.pullback.pullback_proximity_pct <= 0 || config.pullback.pullback_proximity_pct > 100) {
      return { valid: false, error: 'pullback_proximity_pct must be in range (0, 100]' };
    }

    // atr_contraction_threshold > 0
    if (config.pullback.atr_contraction_threshold <= 0) {
      return { valid: false, error: 'atr_contraction_threshold must be > 0' };
    }

    // stop_atr_multiple > 0
    if (config.stopLoss.stop_atr_multiple <= 0) {
      return { valid: false, error: 'stop_atr_multiple must be > 0' };
    }

    // r_multiple > 0
    if (config.profitTarget.r_multiple <= 0) {
      return { valid: false, error: 'r_multiple must be > 0' };
    }

    // swing_lookback >= 1
    if (config.pullback.swing_lookback < 1) {
      return { valid: false, error: 'swing_lookback must be >= 1' };
    }

    // Trailing stop validation when exitMode is 'trailing'
    if (config.exitMode === 'trailing') {
      const ts = config.trailingStop;

      // trailingMethod must be present and valid
      if (!ts || (ts.trailingMethod !== 'sma20' && ts.trailingMethod !== 'atr')) {
        return { valid: false, error: 'trailingMethod must be "sma20" or "atr"' };
      }

      // atrTrailMultiple > 0 when method is 'atr'
      if (ts.trailingMethod === 'atr' && (ts.atrTrailMultiple === undefined || ts.atrTrailMultiple <= 0)) {
        return { valid: false, error: 'atrTrailMultiple must be > 0 when trailingMethod is "atr"' };
      }

      // smaTrailBuffer >= 0 when method is 'sma20'
      if (ts.trailingMethod === 'sma20' && (ts.smaTrailBuffer === undefined || ts.smaTrailBuffer < 0)) {
        return { valid: false, error: 'smaTrailBuffer must be >= 0 when trailingMethod is "sma20"' };
      }

      // breakeven_threshold > 0
      if (ts.breakeven_threshold <= 0) {
        return { valid: false, error: 'breakeven_threshold must be > 0' };
      }

      // trail_activation_threshold >= breakeven_threshold
      if (ts.trail_activation_threshold < ts.breakeven_threshold) {
        return { valid: false, error: 'trail_activation_threshold must be >= breakeven_threshold' };
      }
    }

    return { valid: true };
  }

  // ============================================================
  // evaluateWithOHLCV — bar-by-bar evaluation with entry and exit management
  // ============================================================

  evaluateWithOHLCV(dataPoints: HistoricalDataPoint[], params: TrendPullbackParams): V2Signal {
    if (!dataPoints || dataPoints.length === 0) {
      return {
        id: crypto.randomUUID(),
        ticker: '',
        direction: 'HOLD' as SignalDirection,
        strategyType: this.type,
        price: 0,
        timestamp: '',
      };
    }

    const { config, cache: paramCache } = params;
    const ticker = (params as any).ticker ?? '';
    const currentBar = dataPoints[this.currentBarIndex];
    this.currentBarIndex++;

    if (!currentBar) {
      return {
        id: crypto.randomUUID(),
        ticker,
        direction: 'HOLD' as SignalDirection,
        strategyType: this.type,
        price: 0,
        timestamp: '',
      };
    }

    if (this.positionOpen) {
      // Determine exit mode (default to "fixed" for backward compatibility)
      const exitMode = config.exitMode ?? 'fixed';

      if (exitMode === 'fixed') {
        // ---- Fixed exit mode ----

        // Priority 1: Stop-loss hit — bar.low <= stopLossPrice
        if (currentBar.low <= this.stopLossPrice) {
          this.positionOpen = false;
          const signal: V2Signal = {
            id: crypto.randomUUID(),
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
          this.effectiveStopLoss = 0;
          this.originalStopLoss = 0;
          this.highestCloseSinceEntry = 0;
          this.rValue = 0;
          return signal;
        }

        // Priority 2: Profit target hit — bar.high >= profitTargetPrice
        if (currentBar.high >= this.profitTargetPrice) {
          this.positionOpen = false;
          const signal: V2Signal = {
            id: crypto.randomUUID(),
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
          this.effectiveStopLoss = 0;
          this.originalStopLoss = 0;
          this.highestCloseSinceEntry = 0;
          this.rValue = 0;
          return signal;
        }

        // Priority 3: Trend failsafe — close < SMA(trend_exit_sma_period)
        const slice = dataPoints.slice(0, this.currentBarIndex);
        const closes = slice.map(d => d.close);
        const trendSma = sma(closes, config.trendExit.trend_exit_sma_period);
        if (trendSma !== undefined && currentBar.close < trendSma) {
          this.positionOpen = false;
          const signal: V2Signal = {
            id: crypto.randomUUID(),
            ticker,
            direction: 'SELL' as SignalDirection,
            strategyType: this.type,
            price: currentBar.close,
            timestamp: currentBar.date,
            exitReason: 'trend_failsafe',
            stopLossPrice: this.stopLossPrice,
            profitTargetPrice: this.profitTargetPrice,
            rValue: this.rValue,
          };
          this.entryPrice = 0;
          this.stopLossPrice = 0;
          this.profitTargetPrice = 0;
          this.effectiveStopLoss = 0;
          this.originalStopLoss = 0;
          this.highestCloseSinceEntry = 0;
          this.rValue = 0;
          return signal;
        }

        // No exit condition triggered — HOLD
        return {
          id: crypto.randomUUID(),
          ticker,
          direction: 'HOLD' as SignalDirection,
          strategyType: this.type,
          price: currentBar.close,
          timestamp: currentBar.date,
        };
      }

      // ---- Trailing exit mode ----
      const ts = config.trailingStop;
      const breakevenThreshold = ts?.breakeven_threshold ?? 1.0;
      const trailActivationThreshold = ts?.trail_activation_threshold ?? 2.0;
      const removeProfitTarget = ts?.remove_profit_target ?? false;

      // 1. Update highest close tracking
      this.highestCloseSinceEntry = Math.max(this.highestCloseSinceEntry, currentBar.close);

      // 2. Compute R_Profit
      const rProfit = this.rValue > 0 ? (currentBar.close - this.entryPrice) / this.rValue : 0;

      // 3. Phase evaluation — trailing activation takes priority over breakeven
      if (rProfit >= trailActivationThreshold && ts) {
        // Trailing phase: compute trailing stop and apply ratchet (only moves up)
        const barIndex = this.currentBarIndex - 1;
        const computedStop = TrendPullbackEngine.computeTrailingStop(
          dataPoints,
          barIndex,
          ts.trailingMethod,
          {
            smaTrailBuffer: ts.smaTrailBuffer,
            atrTrailMultiple: ts.atrTrailMultiple,
            atrTrailReference: ts.atrTrailReference,
          },
          this.highestCloseSinceEntry,
          paramCache
        );
        if (computedStop !== undefined) {
          this.effectiveStopLoss = Math.max(this.effectiveStopLoss, computedStop);
        }
      } else if (rProfit >= breakevenThreshold) {
        // Breakeven phase: move stop to entry price (ratchet — only moves up)
        this.effectiveStopLoss = Math.max(this.effectiveStopLoss, this.entryPrice);
      }
      // Else: keep effectiveStopLoss unchanged (at original stop)

      // 4. Exit priority chain (trailing mode)

      // Priority 1: Effective stop-loss hit — bar.low <= effectiveStopLoss
      if (currentBar.low <= this.effectiveStopLoss) {
        this.positionOpen = false;
        const exitReason = this.effectiveStopLoss > this.originalStopLoss ? 'trailing_stop' as const : 'stop_loss' as const;
        const signal: V2Signal = {
          id: crypto.randomUUID(),
          ticker,
          direction: 'SELL' as SignalDirection,
          strategyType: this.type,
          price: this.effectiveStopLoss,
          timestamp: currentBar.date,
          exitReason,
          stopLossPrice: this.stopLossPrice,
          profitTargetPrice: this.profitTargetPrice,
          rValue: this.rValue,
        };
        this.entryPrice = 0;
        this.stopLossPrice = 0;
        this.profitTargetPrice = 0;
        this.effectiveStopLoss = 0;
        this.originalStopLoss = 0;
        this.highestCloseSinceEntry = 0;
        this.rValue = 0;
        return signal;
      }

      // Priority 2: Profit target (if not removed)
      if (!removeProfitTarget && currentBar.high >= this.profitTargetPrice) {
        this.positionOpen = false;
        const signal: V2Signal = {
          id: crypto.randomUUID(),
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
        this.effectiveStopLoss = 0;
        this.originalStopLoss = 0;
        this.highestCloseSinceEntry = 0;
        this.rValue = 0;
        return signal;
      }

      // Priority 3: Trend failsafe — close < SMA(trend_exit_sma_period)
      {
        const slice = dataPoints.slice(0, this.currentBarIndex);
        const closes = slice.map(d => d.close);
        const trendSma = sma(closes, config.trendExit.trend_exit_sma_period);
        if (trendSma !== undefined && currentBar.close < trendSma) {
          this.positionOpen = false;
          const signal: V2Signal = {
            id: crypto.randomUUID(),
            ticker,
            direction: 'SELL' as SignalDirection,
            strategyType: this.type,
            price: currentBar.close,
            timestamp: currentBar.date,
            exitReason: 'trend_failsafe',
            stopLossPrice: this.stopLossPrice,
            profitTargetPrice: this.profitTargetPrice,
            rValue: this.rValue,
          };
          this.entryPrice = 0;
          this.stopLossPrice = 0;
          this.profitTargetPrice = 0;
          this.effectiveStopLoss = 0;
          this.originalStopLoss = 0;
          this.highestCloseSinceEntry = 0;
          this.rValue = 0;
          return signal;
        }
      }

      // No exit condition triggered — HOLD
      return {
        id: crypto.randomUUID(),
        ticker,
        direction: 'HOLD' as SignalDirection,
        strategyType: this.type,
        price: currentBar.close,
        timestamp: currentBar.date,
      };
    }

    // Position not open — check for entry
    const barIndex = this.currentBarIndex - 1;
    const entryResult = TrendPullbackEngine.shouldEnter(dataPoints, barIndex, config, paramCache);

    if (entryResult) {
      this.positionOpen = true;
      this.entryPrice = entryResult.entryPrice;
      this.stopLossPrice = entryResult.stopLossPrice;
      this.profitTargetPrice = entryResult.profitTargetPrice;
      this.rValue = entryResult.rValue;
      this.originalStopLoss = entryResult.stopLossPrice;
      this.effectiveStopLoss = entryResult.stopLossPrice;
      this.highestCloseSinceEntry = entryResult.entryPrice;

      return {
        id: crypto.randomUUID(),
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
      id: crypto.randomUUID(),
      ticker,
      direction: 'HOLD' as SignalDirection,
      strategyType: this.type,
      price: currentBar.close,
      timestamp: currentBar.date,
    };
  }
}
