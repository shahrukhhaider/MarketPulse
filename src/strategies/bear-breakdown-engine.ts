import type {
  StrategyType,
  HistoricalDataPoint,
  V2Signal,
  V2CompatibleEngine,
} from '../types.js';
import type {
  BearBreakdownConfiguration,
  BearBreakdownParams,
} from './strategy-configs.js';
import { range_pct, atr_ratio, atr, sma, highestHigh, swingLow, avgVolume } from '../indicators/indicators.js';
import type { IndicatorCache } from '../indicators/indicator-cache.js';

// ============================================================
// Result interfaces for standalone detection functions
// ============================================================

export interface BearConsolidationResult {
  detected: boolean;
  consolidationHigh: number;
  consolidationLow: number;
  consolidationBar: number;
}

export interface BearConsolidationConfig {
  consolidation_window: number;
  max_range_pct: number;
  atr_ratio_threshold: number;
}

export interface BearBreakdownConfig {
  volume_multiplier: number;
}

export interface BearEntryResult {
  entryPrice: number;
  stopLossPrice: number;
  profitTargetPrice: number;
  rValue: number;
}

// ============================================================
// BearBreakdownEngine
// ============================================================

export class BearBreakdownEngine implements V2CompatibleEngine {
  type: StrategyType = 'bear_breakdown' as StrategyType;

  // Internal state
  private positionOpen = false;
  private entryBarIndex = -1;
  private entryPrice = 0;
  private stopLossPrice = 0;
  private profitTargetPrice = 0;
  private currentBarIndex = 0;
  private lastConsolidation: { bar: number; high: number; low: number } | null = null;

  reset(): void {
    this.positionOpen = false;
    this.entryBarIndex = -1;
    this.entryPrice = 0;
    this.stopLossPrice = 0;
    this.profitTargetPrice = 0;
    this.currentBarIndex = 0;
    this.lastConsolidation = null;
  }

  // ============================================================
  // Standalone detection functions (static for independent testability)
  // ============================================================

  /**
   * Detect a consolidation event at the given bar index (bear direction).
   *
   * Conditions (inverted from bullish):
   *  1. close < SMA(50) ← inverted: was close >= SMA(50)
   *  2. range_pct(consolidation_window) <= max_range_pct ← same
   *  3. atr_ratio(5, 20) < atr_ratio_threshold ← same
   *
   * Returns detected: false when insufficient data.
   */
  static detectConsolidation(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    config: BearConsolidationConfig,
    cache?: IndicatorCache
  ): BearConsolidationResult {
    const notDetected: BearConsolidationResult = {
      detected: false,
      consolidationHigh: 0,
      consolidationLow: 0,
      consolidationBar: barIndex,
    };

    // Minimum data check: need enough for consolidation window, ATR(20) (needs 21 points), and SMA(50)
    const minRequired = Math.max(config.consolidation_window, 21, 50);
    if (barIndex + 1 < minRequired) {
      return notDetected;
    }

    // 1. Compute range_pct over the consolidation window
    const rangePct = cache
      ? cache.getRangePct(config.consolidation_window, barIndex)
      : range_pct(dataPoints.slice(0, barIndex + 1), config.consolidation_window);
    if (rangePct === undefined) return notDetected;

    // range_pct returns a ratio (e.g. 0.04 for 4%), config uses percentage (e.g. 4)
    // Convert range_pct to percentage for comparison
    const rangePctPercent = rangePct * 100;
    if (rangePctPercent > config.max_range_pct) return notDetected;

    // 2. Compute atr_ratio(5, 20)
    const atrRat = cache
      ? cache.getAtrRatio(5, 20, barIndex)
      : atr_ratio(dataPoints.slice(0, barIndex + 1), 5, 20);
    if (atrRat === undefined) return notDetected;
    if (atrRat >= config.atr_ratio_threshold) return notDetected;

    // 3. Check close < SMA(50) — INVERTED from bullish (was close >= SMA(50))
    const currentClose = dataPoints[barIndex].close;
    let sma50: number | undefined;
    if (cache) {
      sma50 = cache.getSma(50, barIndex);
    } else {
      const closes = dataPoints.slice(0, barIndex + 1).map(d => d.close);
      sma50 = sma(closes, 50);
    }
    if (sma50 === undefined) return notDetected;
    if (currentClose >= sma50) return notDetected;

    // All conditions pass — compute consolidation high and low over the window
    const consolidationHighVal = cache
      ? cache.getHighestHigh(config.consolidation_window, barIndex)
      : highestHigh(dataPoints.slice(0, barIndex + 1), config.consolidation_window);
    const consolidationLowVal = cache
      ? cache.getSwingLow(config.consolidation_window, barIndex)
      : swingLow(dataPoints.slice(0, barIndex + 1), config.consolidation_window);

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

  minimumDataPointsForParams(_params: any): number {
    return 51;
  }

  validateParams(params: BearBreakdownParams): { valid: boolean; error?: string } {
    const { config } = params;

    if (!config) {
      return { valid: false, error: 'Missing strategy configuration' };
    }

    // Validate consolidation params
    if (!config.consolidation || typeof config.consolidation !== 'object') {
      return { valid: false, error: 'Missing consolidation configuration' };
    }
    if (config.consolidation.consolidation_window < 1) {
      return { valid: false, error: 'consolidation_window must be >= 1' };
    }
    if (config.consolidation.max_range_pct <= 0 || config.consolidation.max_range_pct > 100) {
      return { valid: false, error: 'max_range_pct must be in range (0, 100]' };
    }
    if (config.consolidation.atr_ratio_threshold <= 0) {
      return { valid: false, error: 'atr_ratio_threshold must be > 0' };
    }

    // Validate breakdown params
    if (!config.breakdown || typeof config.breakdown !== 'object') {
      return { valid: false, error: 'Missing breakdown configuration' };
    }
    if (config.breakdown.volume_multiplier <= 0) {
      return { valid: false, error: 'volume_multiplier must be > 0' };
    }

    // Validate stop loss params
    if (!config.stopLoss || typeof config.stopLoss !== 'object') {
      return { valid: false, error: 'Missing stopLoss configuration' };
    }
    if (config.stopLoss.atr_multiple <= 0) {
      return { valid: false, error: 'atr_multiple must be > 0' };
    }
    if (config.stopLoss.swing_lookback < 1) {
      return { valid: false, error: 'swing_lookback must be >= 1' };
    }

    // Validate profit target params
    if (!config.profitTarget || typeof config.profitTarget !== 'object') {
      return { valid: false, error: 'Missing profitTarget configuration' };
    }
    if (config.profitTarget.r_multiple <= 0) {
      return { valid: false, error: 'r_multiple must be > 0' };
    }

    // Validate max risk params
    if (!config.maxRisk || typeof config.maxRisk !== 'object') {
      return { valid: false, error: 'Missing maxRisk configuration' };
    }
    if (config.maxRisk.max_risk_pct <= 0 || config.maxRisk.max_risk_pct > 100) {
      return { valid: false, error: 'max_risk_pct must be in range (0, 100]' };
    }

    // Validate exitMode
    if (config.exitMode !== 'fixed') {
      return { valid: false, error: 'exitMode must be "fixed"' };
    }

    return { valid: true };
  }

  evaluateWithOHLCV(dataPoints: HistoricalDataPoint[], params: BearBreakdownParams): V2Signal {
    if (!dataPoints || dataPoints.length === 0) {
      return {
        id: `bb${this.currentBarIndex}`,
        ticker: '',
        direction: 'HOLD' as any,
        strategyType: this.type,
        price: 0,
        timestamp: '',
      };
    }

    const { config, cache } = params;
    const ticker = (params as any).ticker ?? '';
    const currentBar = dataPoints[this.currentBarIndex];
    this.currentBarIndex++;

    if (!currentBar) {
      return {
        id: `bb${this.currentBarIndex}`,
        ticker,
        direction: 'HOLD' as any,
        strategyType: this.type,
        price: 0,
        timestamp: '',
      };
    }

    const barIndex = this.currentBarIndex - 1;

    // ---- Position is open: check exit conditions ----
    if (this.positionOpen) {
      // Priority 1: Stop loss — bar HIGH >= stopLossPrice (exit at loss for short)
      if (currentBar.high >= this.stopLossPrice) {
        this.positionOpen = false;
        const exitPrice = this.stopLossPrice;
        const profitLossPercent = (this.entryPrice - exitPrice) / this.entryPrice * 100;
        const signal: V2Signal = {
          id: `bb${this.currentBarIndex}`,
          ticker,
          direction: 'BUY' as any,
          strategyType: this.type,
          price: exitPrice,
          timestamp: currentBar.date,
          exitReason: 'stop_loss',
          stopLossPrice: this.stopLossPrice,
          profitTargetPrice: this.profitTargetPrice,
          rValue: (this.stopLossPrice - this.entryPrice) / this.entryPrice * 100,
          profitLossPercent,
        } as any;
        this.entryBarIndex = -1;
        this.entryPrice = 0;
        this.stopLossPrice = 0;
        this.profitTargetPrice = 0;
        return signal;
      }

      // Priority 2: Profit target — bar LOW <= profitTargetPrice (exit at profit for short)
      if (currentBar.low <= this.profitTargetPrice) {
        this.positionOpen = false;
        const exitPrice = this.profitTargetPrice;
        const profitLossPercent = (this.entryPrice - exitPrice) / this.entryPrice * 100;
        const signal: V2Signal = {
          id: `bb${this.currentBarIndex}`,
          ticker,
          direction: 'BUY' as any,
          strategyType: this.type,
          price: exitPrice,
          timestamp: currentBar.date,
          exitReason: 'profit_target',
          stopLossPrice: this.stopLossPrice,
          profitTargetPrice: this.profitTargetPrice,
          rValue: (this.stopLossPrice - this.entryPrice) / this.entryPrice * 100,
          profitLossPercent,
        } as any;
        this.entryBarIndex = -1;
        this.entryPrice = 0;
        this.stopLossPrice = 0;
        this.profitTargetPrice = 0;
        return signal;
      }

      // No exit condition triggered — HOLD
      return {
        id: `bb${this.currentBarIndex}`,
        ticker,
        direction: 'HOLD' as any,
        strategyType: this.type,
        price: currentBar.close,
        timestamp: currentBar.date,
      };
    }

    // ---- Position not open: check for entry ----

    // Step 1: Try to detect consolidation at current bar
    const consolidationResult = BearBreakdownEngine.detectConsolidation(
      dataPoints,
      barIndex,
      {
        consolidation_window: config.consolidation.consolidation_window,
        max_range_pct: config.consolidation.max_range_pct,
        atr_ratio_threshold: config.consolidation.atr_ratio_threshold,
      },
      cache
    );

    if (consolidationResult.detected) {
      this.lastConsolidation = {
        bar: consolidationResult.consolidationBar,
        high: consolidationResult.consolidationHigh,
        low: consolidationResult.consolidationLow,
      };
    }

    // Step 2: Check if we have a valid consolidation (current or within staleness window)
    let validConsolidation: { bar: number; high: number; low: number } | null = null;
    if (this.lastConsolidation) {
      const staleness = barIndex - this.lastConsolidation.bar;
      if (staleness <= config.consolidation.max_staleness) {
        validConsolidation = this.lastConsolidation;
      }
    }

    if (!validConsolidation) {
      return {
        id: `bb${this.currentBarIndex}`,
        ticker,
        direction: 'HOLD' as any,
        strategyType: this.type,
        price: currentBar.close,
        timestamp: currentBar.date,
      };
    }

    // Step 3: Try to detect breakdown
    const breakdownDetected = BearBreakdownEngine.detectBreakdown(
      dataPoints,
      barIndex,
      validConsolidation.low,
      { volume_multiplier: config.breakdown.volume_multiplier },
      cache
    );

    if (!breakdownDetected) {
      return {
        id: `bb${this.currentBarIndex}`,
        ticker,
        direction: 'HOLD' as any,
        strategyType: this.type,
        price: currentBar.close,
        timestamp: currentBar.date,
      };
    }

    // Step 4: Check entry validity via shouldEnter
    const entryResult = BearBreakdownEngine.shouldEnter(dataPoints, barIndex, config);

    if (!entryResult) {
      return {
        id: `bb${this.currentBarIndex}`,
        ticker,
        direction: 'HOLD' as any,
        strategyType: this.type,
        price: currentBar.close,
        timestamp: currentBar.date,
      };
    }

    // Step 5: Open short position — emit SELL signal
    this.positionOpen = true;
    this.entryPrice = entryResult.entryPrice;
    this.stopLossPrice = entryResult.stopLossPrice;
    this.profitTargetPrice = entryResult.profitTargetPrice;
    this.entryBarIndex = barIndex;

    return {
      id: `bb${this.currentBarIndex}`,
      ticker,
      direction: 'SELL' as any,
      strategyType: this.type,
      price: entryResult.entryPrice,
      timestamp: currentBar.date,
      stopLossPrice: entryResult.stopLossPrice,
      profitTargetPrice: entryResult.profitTargetPrice,
      rValue: entryResult.rValue,
    };
  }

  /**
   * Detect a breakdown event at the given bar index.
   *
   * Conditions (inverted from bullish breakout):
   *  1. close < consolidationLow (strict inequality)
   *  2. volume > avgVolume(20) × volume_multiplier
   *
   * Returns false when insufficient data or any condition fails.
   */
  static detectBreakdown(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    consolidationLow: number,
    config: BearBreakdownConfig,
    cache?: IndicatorCache
  ): boolean {
    // Need at least 21 bars for avgVolume(20)
    if (barIndex + 1 < 21) {
      return false;
    }

    const currentBar = dataPoints[barIndex];

    // 1. Check close < consolidationLow (strict inequality)
    if (currentBar.close >= consolidationLow) {
      return false;
    }

    // 2. Check volume > avgVolume(20) × volume_multiplier
    const avg20Vol = cache
      ? cache.getAvgVolume(20, barIndex)
      : avgVolume(dataPoints.slice(0, barIndex + 1), 20);
    if (avg20Vol === undefined) {
      return false;
    }
    if (currentBar.volume <= avg20Vol * config.volume_multiplier) {
      return false;
    }

    // All conditions pass
    return true;
  }

  /**
   * Compute entry, stop, and target for a short trade.
   *
   * Entry:  current close
   * Stop:   swingHigh(swing_lookback) + buffer × ATR(14)  ← inverted: was swingLow - buffer × ATR
   * Target: entry - r_multiple × (stop - entry)  ← inverted: was entry + r_multiple × (entry - stop)
   * Risk:   (stop - entry) / entry × 100  ← inverted: was (entry - stop) / entry × 100
   *
   * Returns null if risk_pct > max_risk_pct.
   */
  static shouldEnter(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    config: BearBreakdownConfiguration
  ): BearEntryResult | null {
    // Need sufficient data for ATR(14) (requires 15 data points) and swing_lookback
    const minRequired = Math.max(15, config.stopLoss.swing_lookback);
    if (barIndex + 1 < minRequired) return null;

    const entryPrice = dataPoints[barIndex].close;

    // Compute ATR(14) for the buffer
    const atr14 = atr(dataPoints.slice(0, barIndex + 1), 14);
    if (atr14 === undefined) return null;

    // Compute swing high over swing_lookback bars (highest high)
    const swingHighVal = highestHigh(dataPoints.slice(0, barIndex + 1), config.stopLoss.swing_lookback);
    if (swingHighVal === undefined) return null;

    // Stop loss = swingHigh + buffer × ATR(14) — above entry for short
    const stopLossPrice = swingHighVal + config.stopLoss.buffer * atr14;

    // Risk = (stop - entry) / entry × 100
    const riskPct = (stopLossPrice - entryPrice) / entryPrice * 100;

    // Reject if risk exceeds max_risk_pct
    if (riskPct > config.maxRisk.max_risk_pct) return null;

    // Reject if stop is not above entry (invalid short setup)
    if (stopLossPrice <= entryPrice) return null;

    // Profit target = entry - r_multiple × (stop - entry)
    const profitTargetPrice = entryPrice - config.profitTarget.r_multiple * (stopLossPrice - entryPrice);

    return {
      entryPrice,
      stopLossPrice,
      profitTargetPrice,
      rValue: riskPct,
    };
  }
}
