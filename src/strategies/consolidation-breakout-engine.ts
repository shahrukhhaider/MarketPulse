import crypto from 'node:crypto';
import type {
  Strategy,
  StrategyType,
  StrategyParams,
  PricePoint,
  Signal,
  SignalDirection,
  HistoricalDataPoint,
  V2Signal,
} from '../types.js';
import type {
  ConsolidationBreakoutParams,
  ConsolidationBreakoutConfiguration,
} from './strategy-configs.js';
import { range_pct, atr_ratio, atr, sma, sma_slope, highestHigh, swingLow, avgVolume, returnNd } from '../indicators.js';
import type { IndicatorCache } from '../indicator-cache.js';
import { computeConfidenceScore, DEFAULT_WEIGHTS } from '../confidence-score.js';

// ============================================================
// Result interfaces for standalone detection functions
// ============================================================

export interface ConsolidationResult {
  detected: boolean;
  consolidationHigh: number;
  consolidationLow: number;
  consolidationBar: number;
}

export interface ConsolidationConfig {
  consolidation_window: number;
  max_range_pct: number;
  atr_ratio_threshold: number;
  sma_proximity_pct?: number;  // undefined = disabled
}

export interface BreakoutConfig {
  volume_multiplier: number;
  return_20d_threshold?: number;  // undefined = disabled
}

export interface EntryResult {
  entryPrice: number;
  stopLossPrice: number;
  profitTargetPrice: number;
  rValue: number;
  confidenceScore: number;
}

// ============================================================
// ConsolidationBreakoutEngine
// ============================================================

export class ConsolidationBreakoutEngine implements Strategy {
  type: StrategyType = 'consolidation_breakout';

  // Internal state
  private positionOpen = false;
  private entryBarIndex = -1;
  private entryPrice = 0;
  private stopLossPrice = 0;
  private profitTargetPrice = 0;
  private currentBarIndex = 0;
  private lastConsolidation: { bar: number; high: number; low: number } | null = null;

  // Trailing exit state
  private effectiveStopLoss = 0;
  private originalStopLoss = 0;
  private highestCloseSinceEntry = 0;

  reset(): void {
    this.positionOpen = false;
    this.entryBarIndex = -1;
    this.entryPrice = 0;
    this.stopLossPrice = 0;
    this.profitTargetPrice = 0;
    this.currentBarIndex = 0;
    this.lastConsolidation = null;
    this.effectiveStopLoss = 0;
    this.originalStopLoss = 0;
    this.highestCloseSinceEntry = 0;
  }

  // ============================================================
  // Standalone detection functions (static for independent testability)
  // ============================================================

  /**
   * Detect a consolidation event at the given bar index.
   *
   * Conditions checked:
   *  1. range_pct over consolidation_window <= max_range_pct
   *  2. atr_ratio(5, 20) < atr_ratio_threshold
   *  3. close >= SMA(50)
   *  4. (optional) abs(close - SMA20) / SMA20 < sma_proximity_pct
   *
   * Returns detected: false when insufficient data.
   */
  static detectConsolidation(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    config: ConsolidationConfig,
    cache?: IndicatorCache
  ): ConsolidationResult {
    const notDetected: ConsolidationResult = {
      detected: false,
      consolidationHigh: 0,
      consolidationLow: 0,
      consolidationBar: barIndex,
    };

    // Slice data up to and including barIndex
    const slice = dataPoints.slice(0, barIndex + 1);

    // Minimum data check: need enough for consolidation window, ATR(20) (needs 21 points), and SMA(50)
    const minRequired = Math.max(config.consolidation_window, 21, 50);
    if (slice.length < minRequired) {
      return notDetected;
    }

    // 1. Compute range_pct over the consolidation window
    const rangePct = cache ? cache.getRangePct(config.consolidation_window, barIndex) : range_pct(slice, config.consolidation_window);
    if (rangePct === undefined) return notDetected;

    // range_pct returns a ratio (e.g. 0.04 for 4%), config uses percentage (e.g. 4)
    // Convert range_pct to percentage for comparison
    const rangePctPercent = rangePct * 100;
    if (rangePctPercent > config.max_range_pct) return notDetected;

    // 2. Compute atr_ratio(5, 20)
    const atrRat = cache ? cache.getAtrRatio(5, 20, barIndex) : atr_ratio(slice, 5, 20);
    if (atrRat === undefined) return notDetected;
    if (atrRat >= config.atr_ratio_threshold) return notDetected;

    // 3. Check close >= SMA(50)
    const closes = slice.map(d => d.close);
    const sma50 = cache ? cache.getSma(50, barIndex) : sma(closes, 50);
    if (sma50 === undefined) return notDetected;

    const currentClose = slice[slice.length - 1].close;
    if (currentClose < sma50) return notDetected;

    // 4. Optional SMA proximity check
    if (config.sma_proximity_pct !== undefined) {
      const sma20 = cache ? cache.getSma(20, barIndex) : sma(closes, 20);
      if (sma20 === undefined || sma20 === 0) return notDetected;

      const proximity = Math.abs(currentClose - sma20) / sma20;
      // sma_proximity_pct is in percentage (e.g. 2 for 2%), convert to ratio for comparison
      if (proximity >= config.sma_proximity_pct / 100) return notDetected;
    }

    // All conditions pass — compute consolidation high and low over the window
    const consolidationHighVal = cache ? cache.getHighestHigh(config.consolidation_window, barIndex) : highestHigh(slice, config.consolidation_window);
    const consolidationLowVal = cache ? cache.getSwingLow(config.consolidation_window, barIndex) : swingLow(slice, config.consolidation_window);

    if (consolidationHighVal === undefined || consolidationLowVal === undefined) {
      return notDetected;
    }

    return {
      detected: true,
      consolidationHigh: consolidationHighVal,
      consolidationLow: consolidationLowVal,
      consolidationBar: barIndex,
    };
  }

  /**
   * Detect a breakout event at the given bar index.
   *
   * Conditions checked:
   *  1. close > consolidationHigh (strict inequality)
   *  2. volume > avgVolume(20) × volume_multiplier
   *  3. (optional) returnNd(20) > return_20d_threshold
   *
   * Returns false when insufficient data or any condition fails.
   */
  static detectBreakout(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    consolidationHigh: number,
    config: BreakoutConfig,
    cache?: IndicatorCache
  ): boolean {
    // Slice data up to and including barIndex
    const slice = dataPoints.slice(0, barIndex + 1);

    // Need at least 20 bars for avgVolume(20) and 21 for returnNd(20)
    if (slice.length < 21) {
      return false;
    }

    const currentBar = slice[slice.length - 1];

    // 1. Check close > consolidationHigh (strict inequality)
    if (currentBar.close <= consolidationHigh) {
      return false;
    }

    // 2. Check volume > avgVolume(20) × volume_multiplier
    const avg20Vol = cache ? cache.getAvgVolume(20, barIndex) : avgVolume(slice, 20);
    if (avg20Vol === undefined) {
      return false;
    }
    if (currentBar.volume <= avg20Vol * config.volume_multiplier) {
      return false;
    }

    // 3. Optionally check returnNd(20) > return_20d_threshold
    if (config.return_20d_threshold !== undefined) {
      const closes = slice.map(d => d.close);
      const ret20 = returnNd(closes, 20);
      if (ret20 === undefined) {
        return false;
      }
      if (ret20 <= config.return_20d_threshold) {
        return false;
      }
    }

    // All conditions pass
    return true;
  }



  /**
   * Orchestrate all entry checks in order:
   * 1. Direction check
   * 2. Scan backwards for consolidation within staleness window
   * 3. Check breakout on current bar
   * 4. Overextension filter
   * 5. Compute stop-loss
   * 6. R_Value check
   * 7. Max risk filter
   * 8. Compute profit target
   * 9. Return EntryResult
   */
  static shouldEnter(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    config: ConsolidationBreakoutConfiguration,
    cache?: IndicatorCache
  ): EntryResult | null {
    const slice = dataPoints.slice(0, barIndex + 1);

    // Need sufficient data for SMA(50) at minimum
    if (slice.length < 50) return null;

    const closes = slice.map(d => d.close);
    const currentClose = slice[slice.length - 1].close;

    // ---- Step 1: Direction check ----
    const sma50 = cache ? cache.getSma(50, barIndex) : sma(closes, 50);
    if (sma50 === undefined) return null;

    // close > SMA(50) — always required
    if (currentClose <= sma50) return null;

    // Optional: SMA(20) >= SMA(50)
    if (config.direction.require_sma20_above_sma50) {
      const sma20 = cache ? cache.getSma(20, barIndex) : sma(closes, 20);
      if (sma20 === undefined) return null;
      if (sma20 < sma50) return null;
    }

    // Optional: SMA(50) slope positive — current SMA(50) > previous bar's SMA(50)
    if (config.direction.require_sma50_slope_positive) {
      const slope = cache ? cache.getSmaSlope(50, barIndex) : sma_slope(closes, 50);
      if (slope === undefined || slope === false) return null;
    }

    // ---- Step 2: Scan backwards for consolidation within staleness window ----
    let consolidation: ConsolidationResult | null = null;
    const maxStaleness = config.consolidation.max_staleness;
    const scanStart = barIndex - 1;
    const scanEnd = barIndex - maxStaleness;

    for (let i = scanStart; i >= Math.max(scanEnd, 0); i--) {
      const result = ConsolidationBreakoutEngine.detectConsolidation(
        dataPoints,
        i,
        {
          consolidation_window: config.consolidation.consolidation_window,
          max_range_pct: config.consolidation.max_range_pct,
          atr_ratio_threshold: config.consolidation.atr_ratio_threshold,
          sma_proximity_pct: config.consolidation.sma_proximity_pct,
        },
        cache
      );
      if (result.detected) {
        consolidation = result;
        break;
      }
    }

    if (!consolidation) return null;

    // ---- Step 3: Check breakout on current bar ----
    const breakoutDetected = ConsolidationBreakoutEngine.detectBreakout(
      dataPoints,
      barIndex,
      consolidation.consolidationHigh,
      {
        volume_multiplier: config.breakout.volume_multiplier,
        return_20d_threshold: config.breakout.return_20d_threshold,
      },
      cache
    );

    if (!breakoutDetected) return null;

    // ---- Step 4: Overextension filter ----
    const sma20 = cache ? cache.getSma(20, barIndex) : sma(closes, 20);
    if (sma20 === undefined || sma20 === 0) return null;
    if (sma50 === 0) return null;

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

    const atrStop = entryPrice - config.stopLoss.atr_multiple * atr14;

    const swingLowVal = cache ? cache.getSwingLow(config.stopLoss.swing_lookback, barIndex) : swingLow(slice, config.stopLoss.swing_lookback);
    const structureStop = swingLowVal !== undefined
      ? swingLowVal - config.stopLoss.buffer * atr14
      : -Infinity;

    // Take the tighter (higher) stop
    const stopLossPrice = Math.max(atrStop, structureStop);

    // ---- Step 6: R_Value check ----
    const rValue = entryPrice - stopLossPrice;
    if (rValue <= 0) return null;

    // ---- Step 7: Max risk filter (disabled — risk filtering moved to post-trade layer) ----
    // const riskPct = (entryPrice - stopLossPrice) / entryPrice * 100;
    // if (riskPct > config.maxRisk.max_risk_pct) return null;

    // ---- Step 8: Compute profit target ----
    const profitTargetPrice = entryPrice + config.profitTarget.r_multiple * rValue;

    // ---- Step 9: Compute confidence score ----
    const weights = config.confidenceWeights ?? DEFAULT_WEIGHTS;
    const confidenceScore = cache
      ? computeConfidenceScore(barIndex, cache, weights)
      : 0.5;

    // ---- Step 10: Return EntryResult ----
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

  minimumDataPoints(): number {
    // Need at least 51 bars: SMA(50) requires 50 prices, plus ATR(20) needs 21 data points
    return 51;
  }

  minimumDataPointsForParams(params: ConsolidationBreakoutParams): number {
    const { config } = params;
    let maxPeriod = 0;

    // SMA(50) for direction check and trend exit
    maxPeriod = Math.max(maxPeriod, 50);

    // SMA(20) for overextension / SMA proximity
    maxPeriod = Math.max(maxPeriod, 20);

    // ATR(20) needs period + 1 data points
    maxPeriod = Math.max(maxPeriod, 21);

    // ATR(14) for stop-loss computation needs period + 1
    maxPeriod = Math.max(maxPeriod, 15);

    // Consolidation window
    maxPeriod = Math.max(maxPeriod, config.consolidation.consolidation_window);

    // Swing lookback for structure stop
    maxPeriod = Math.max(maxPeriod, config.stopLoss.swing_lookback);

    // Trend exit SMA period
    maxPeriod = Math.max(maxPeriod, config.trendExit.trend_exit_sma_period);

    // returnNd(20) needs 21 prices
    maxPeriod = Math.max(maxPeriod, 21);

    // avgVolume(20) needs 20 data points
    maxPeriod = Math.max(maxPeriod, 20);

    return maxPeriod;
  }

  validateParams(params: StrategyParams): { valid: boolean; error?: string } {
    const cbParams = params as unknown as ConsolidationBreakoutParams;
    const { config } = cbParams;

    if (!config) {
      return { valid: false, error: 'Missing strategy configuration' };
    }

    // consolidation_window >= 1
    if (config.consolidation.consolidation_window < 1) {
      return { valid: false, error: 'consolidation_window must be >= 1' };
    }

    // max_range_pct in (0, 100]
    if (config.consolidation.max_range_pct <= 0 || config.consolidation.max_range_pct > 100) {
      return { valid: false, error: 'max_range_pct must be in range (0, 100]' };
    }

    // atr_ratio_threshold > 0
    if (config.consolidation.atr_ratio_threshold <= 0) {
      return { valid: false, error: 'atr_ratio_threshold must be > 0' };
    }

    // volume_multiplier > 0
    if (config.breakout.volume_multiplier <= 0) {
      return { valid: false, error: 'volume_multiplier must be > 0' };
    }

    // overextension_pct in (0, 100]
    if (config.overextension.overextension_pct <= 0 || config.overextension.overextension_pct > 100) {
      return { valid: false, error: 'overextension_pct must be in range (0, 100]' };
    }

    // atr_multiple > 0
    if (config.stopLoss.atr_multiple <= 0) {
      return { valid: false, error: 'atr_multiple must be > 0' };
    }

    // max_risk_pct in (0, 100]
    if (config.maxRisk.max_risk_pct <= 0 || config.maxRisk.max_risk_pct > 100) {
      return { valid: false, error: 'max_risk_pct must be in range (0, 100]' };
    }

    // r_multiple > 0
    if (config.profitTarget.r_multiple <= 0) {
      return { valid: false, error: 'r_multiple must be > 0' };
    }

    // swing_lookback >= 1
    if (config.stopLoss.swing_lookback < 1) {
      return { valid: false, error: 'swing_lookback must be >= 1' };
    }

    // exitMode validation (if provided, must be "fixed" or "trailing")
    if (config.exitMode !== undefined && config.exitMode !== 'fixed' && config.exitMode !== 'trailing') {
      return { valid: false, error: 'exitMode must be "fixed" or "trailing"' };
    }

    // When exitMode is "trailing", validate trailing stop parameters
    if (config.exitMode === 'trailing') {
      const ts = config.trailingStop;

      // trailingMethod must be "sma20" or "atr"
      if (!ts || (ts.trailingMethod !== 'sma20' && ts.trailingMethod !== 'atr')) {
        return { valid: false, error: 'trailingMethod must be "sma20" or "atr"' };
      }

      // atrTrailMultiple > 0 when method is "atr"
      if (ts.trailingMethod === 'atr' && (ts.atrTrailMultiple === undefined || ts.atrTrailMultiple <= 0)) {
        return { valid: false, error: 'atrTrailMultiple must be > 0 when trailingMethod is "atr"' };
      }

      // smaTrailBuffer >= 0 when method is "sma20"
      if (ts.trailingMethod === 'sma20' && (ts.smaTrailBuffer === undefined || ts.smaTrailBuffer < 0)) {
        return { valid: false, error: 'smaTrailBuffer must be >= 0 when trailingMethod is "sma20"' };
      }

      // breakevenThreshold > 0
      if (ts.breakevenThreshold <= 0) {
        return { valid: false, error: 'breakevenThreshold must be > 0' };
      }

      // trailActivationThreshold >= breakevenThreshold
      if (ts.trailActivationThreshold < ts.breakevenThreshold) {
        return { valid: false, error: 'trailActivationThreshold must be >= breakevenThreshold' };
      }
    }

    return { valid: true };
  }

  evaluate(priceHistory: PricePoint[], params: StrategyParams): Signal {
    // Convert PricePoint[] to synthetic HistoricalDataPoint[] and delegate to evaluateWithOHLCV
    const syntheticDataPoints: HistoricalDataPoint[] = priceHistory.map(pp => ({
      date: pp.timestamp,
      open: pp.price,
      high: pp.price,
      low: pp.price,
      close: pp.price,
      volume: 0,
    }));

    const cbParams = params as unknown as ConsolidationBreakoutParams;
    return this.evaluateWithOHLCV(syntheticDataPoints, cbParams);
  }

  evaluateWithOHLCV(dataPoints: HistoricalDataPoint[], params: ConsolidationBreakoutParams): V2Signal {
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

      if (exitMode === 'trailing') {
        // ---- Trailing exit mode ----
        const ts = config.trailingStop;
        const breakevenThreshold = ts?.breakevenThreshold ?? 1.0;
        const trailActivationThreshold = ts?.trailActivationThreshold ?? 2.0;
        const removeProfitTarget = ts?.removeProfitTarget ?? false;

        // 1. Update highest close tracking
        this.highestCloseSinceEntry = Math.max(this.highestCloseSinceEntry, currentBar.close);

        // 2. Compute R_Profit
        const rValue = this.entryPrice - this.originalStopLoss;
        const rProfit = rValue > 0 ? (currentBar.close - this.entryPrice) / rValue : 0;

        // 3. Phase evaluation
        if (rProfit >= trailActivationThreshold && ts) {
          // Trailing phase: compute trailing stop and apply ratchet
          const barIndex = this.currentBarIndex - 1;
          const computedStop = ConsolidationBreakoutEngine.computeTrailingStop(
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
          // Breakeven phase: move stop to entry price
          this.effectiveStopLoss = Math.max(this.effectiveStopLoss, this.entryPrice);
        }
        // Else: keep effectiveStopLoss unchanged

        // 4. Exit priority chain (trailing mode)

        // Priority 1: Effective stop-loss hit
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
            rValue,
          };
          this.entryBarIndex = -1;
          this.entryPrice = 0;
          this.stopLossPrice = 0;
          this.profitTargetPrice = 0;
          this.effectiveStopLoss = 0;
          this.originalStopLoss = 0;
          this.highestCloseSinceEntry = 0;
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
            rValue,
          };
          this.entryBarIndex = -1;
          this.entryPrice = 0;
          this.stopLossPrice = 0;
          this.profitTargetPrice = 0;
          this.effectiveStopLoss = 0;
          this.originalStopLoss = 0;
          this.highestCloseSinceEntry = 0;
          return signal;
        }

        // Priority 3: Trend failsafe
        const slice = dataPoints.slice(0, this.currentBarIndex);
        const closes = slice.map(d => d.close);
        const trendSmaBarIndex = this.currentBarIndex - 1;
        const trendSma = paramCache ? paramCache.getSma(config.trendExit.trend_exit_sma_period, trendSmaBarIndex) ?? sma(closes, config.trendExit.trend_exit_sma_period) : sma(closes, config.trendExit.trend_exit_sma_period);
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
            rValue,
          };
          this.entryBarIndex = -1;
          this.entryPrice = 0;
          this.stopLossPrice = 0;
          this.profitTargetPrice = 0;
          this.effectiveStopLoss = 0;
          this.originalStopLoss = 0;
          this.highestCloseSinceEntry = 0;
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

      // ---- Fixed exit mode (existing behavior, unchanged) ----

      // Priority 1: Stop-loss — bar.low <= stopLossPrice
      if (currentBar.low <= this.stopLossPrice) {
        this.positionOpen = false;
        const rValue = this.entryPrice - this.stopLossPrice;
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
          rValue,
        };
        this.entryBarIndex = -1;
        this.entryPrice = 0;
        this.stopLossPrice = 0;
        this.profitTargetPrice = 0;
        this.effectiveStopLoss = 0;
        this.originalStopLoss = 0;
        this.highestCloseSinceEntry = 0;
        return signal;
      }

      // Priority 2: Profit target — bar.high >= profitTargetPrice
      if (currentBar.high >= this.profitTargetPrice) {
        this.positionOpen = false;
        const rValue = this.entryPrice - this.stopLossPrice;
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
          rValue,
        };
        this.entryBarIndex = -1;
        this.entryPrice = 0;
        this.stopLossPrice = 0;
        this.profitTargetPrice = 0;
        this.effectiveStopLoss = 0;
        this.originalStopLoss = 0;
        this.highestCloseSinceEntry = 0;
        return signal;
      }

      // Priority 3: Trend failsafe — bar.close < SMA(trend_exit_sma_period)
      const slice = dataPoints.slice(0, this.currentBarIndex);
      const closes = slice.map(d => d.close);
      const trendSmaBarIndex = this.currentBarIndex - 1;
      const trendSma = paramCache ? paramCache.getSma(config.trendExit.trend_exit_sma_period, trendSmaBarIndex) ?? sma(closes, config.trendExit.trend_exit_sma_period) : sma(closes, config.trendExit.trend_exit_sma_period);
      if (trendSma !== undefined && currentBar.close < trendSma) {
        this.positionOpen = false;
        const rValue = this.entryPrice - this.stopLossPrice;
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
          rValue,
        };
        this.entryBarIndex = -1;
        this.entryPrice = 0;
        this.stopLossPrice = 0;
        this.profitTargetPrice = 0;
        this.effectiveStopLoss = 0;
        this.originalStopLoss = 0;
        this.highestCloseSinceEntry = 0;
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

    // Position not open — check for entry
    const barIndex = this.currentBarIndex - 1; // currentBarIndex was already incremented
    const entryResult = ConsolidationBreakoutEngine.shouldEnter(dataPoints, barIndex, config, paramCache);

    if (entryResult) {
      this.positionOpen = true;
      this.entryPrice = entryResult.entryPrice;
      this.stopLossPrice = entryResult.stopLossPrice;
      this.profitTargetPrice = entryResult.profitTargetPrice;
      this.entryBarIndex = barIndex;
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
