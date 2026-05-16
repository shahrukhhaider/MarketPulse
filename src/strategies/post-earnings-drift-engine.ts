import type {
  StrategyType,
  HistoricalDataPoint,
  V2Signal,
  SignalDirection,
  V2CompatibleEngine,
} from '../types.js';
import type {
  PostEarningsDriftConfiguration,
  PostEarningsDriftParams,
} from './strategy-configs.js';
import { sma, atr, avgVolume } from '../indicators/indicators.js';

// Fast signal ID generator
let _peadSignalCounter = 0;
function fastPeadSignalId(): string {
  return `pead_s${++_peadSignalCounter}`;
}

// ============================================================
// Result interfaces for static detection methods
// ============================================================

export type ConsolidationStatus = 'idle' | 'in_progress' | 'valid' | 'failed' | 'expired';

export interface EarningsGapResult {
  detected: boolean;
  gapPct: number;
  gapDayIndex: number;
  gapDayHigh: number;
  gapDayLow: number;
  gapDayVolume: number;
  previousDayClose: number;
}

export interface ConsolidationResult {
  status: ConsolidationStatus;
  consolidationHigh: number;
  consolidationLow: number;
  decliningVolumeFlag: boolean;
  daysInConsolidation: number;
}

export interface EntryResult {
  entryPrice: number;
  stopLossPrice: number;
  profitTargetPrice: number;
  rValue: number;
}

// ============================================================
// PostEarningsDriftEngine
// ============================================================

export class PostEarningsDriftEngine implements V2CompatibleEngine {
  type: StrategyType = 'post_earnings_drift';

  // Internal state
  private positionOpen = false;
  private entryPrice = 0;
  private stopLossPrice = 0;
  private profitTargetPrice = 0;
  private currentBarIndex = 0;
  private activeGap: {
    gapDayIndex: number;
    gapDayHigh: number;
    gapDayLow: number;
    gapDayVolume: number;
    previousDayClose: number;
  } | null = null;
  private consolidationState: ConsolidationResult | null = null;
  private breakoutTriggered = false;

  reset(): void {
    this.positionOpen = false;
    this.entryPrice = 0;
    this.stopLossPrice = 0;
    this.profitTargetPrice = 0;
    this.currentBarIndex = 0;
    this.activeGap = null;
    this.consolidationState = null;
    this.breakoutTriggered = false;
  }

  minimumDataPointsForParams(_params: PostEarningsDriftParams): number {
    return 60;
  }

  // ============================================================
  // Static detection methods
  // ============================================================

  /**
   * Detect an earnings gap at the given bar index.
   *
   * Computes gap percentage = (earningsClose - prevClose) / prevClose × 100
   * Checks volume > gap_volume_multiplier × average volume (20-day or min 5-bar fallback)
   *
   * Returns detected: false when conditions are not met or insufficient data.
   */
  static detectEarningsGap(
    dataPoints: HistoricalDataPoint[],
    earningsBarIndex: number,
    config: PostEarningsDriftConfiguration
  ): EarningsGapResult {
    const notDetected: EarningsGapResult = {
      detected: false,
      gapPct: 0,
      gapDayIndex: earningsBarIndex,
      gapDayHigh: 0,
      gapDayLow: 0,
      gapDayVolume: 0,
      previousDayClose: 0,
    };

    // Need at least the earnings bar and one previous bar
    if (earningsBarIndex < 1 || earningsBarIndex >= dataPoints.length) {
      return notDetected;
    }

    const earningsBar = dataPoints[earningsBarIndex];
    const previousBar = dataPoints[earningsBarIndex - 1];

    // Skip if previous day close is 0 or missing
    if (!previousBar || previousBar.close === 0) {
      return notDetected;
    }

    // Compute gap percentage
    const gapPct = ((earningsBar.close - previousBar.close) / previousBar.close) * 100;

    // Check gap_min_pct threshold
    if (gapPct < config.gap_min_pct) {
      return notDetected;
    }

    // Compute average volume for bars preceding the earnings day
    // Use 20-day average, fallback to available bars (min 5)
    const barsBeforeEarnings = earningsBarIndex; // number of bars available before earnings bar
    let volumeAvgPeriod: number;

    if (barsBeforeEarnings >= 20) {
      volumeAvgPeriod = 20;
    } else if (barsBeforeEarnings >= 5) {
      volumeAvgPeriod = barsBeforeEarnings;
    } else {
      // Fewer than 5 bars — skip
      return notDetected;
    }

    // Compute average volume from bars preceding the earnings bar
    const precedingBars = dataPoints.slice(0, earningsBarIndex);
    const avgVol = avgVolume(precedingBars, volumeAvgPeriod);

    if (avgVol === undefined || avgVol === 0) {
      return notDetected;
    }

    // Check volume threshold
    if (earningsBar.volume <= avgVol * config.gap_volume_multiplier) {
      return notDetected;
    }

    return {
      detected: true,
      gapPct,
      gapDayIndex: earningsBarIndex,
      gapDayHigh: earningsBar.high,
      gapDayLow: earningsBar.low,
      gapDayVolume: earningsBar.volume,
      previousDayClose: previousBar.close,
    };
  }

  /**
   * Evaluate consolidation status for bars after the gap day.
   *
   * Tracks consolidation status:
   * - idle: not yet started (currentBarIndex <= gapDayIndex)
   * - in_progress: within window, conditions still holding
   * - valid: min days reached, range within max_range_pct
   * - failed: close dropped below gap day low OR below previous day's close
   * - expired: max days exceeded without valid consolidation
   */
  static evaluateConsolidation(
    dataPoints: HistoricalDataPoint[],
    gapDayIndex: number,
    currentBarIndex: number,
    gapDayHigh: number,
    gapDayLow: number,
    gapDayVolume: number,
    config: PostEarningsDriftConfiguration,
    previousDayClose?: number
  ): ConsolidationResult {
    const idle: ConsolidationResult = {
      status: 'idle',
      consolidationHigh: 0,
      consolidationLow: 0,
      decliningVolumeFlag: false,
      daysInConsolidation: 0,
    };

    // Consolidation starts the day after the gap day
    const consolidationStartIndex = gapDayIndex + 1;
    const daysInConsolidation = currentBarIndex - gapDayIndex;

    if (currentBarIndex <= gapDayIndex || currentBarIndex >= dataPoints.length) {
      return idle;
    }

    // Check if expired (beyond max days)
    if (daysInConsolidation > config.consolidation_max_days) {
      return {
        status: 'expired',
        consolidationHigh: 0,
        consolidationLow: 0,
        decliningVolumeFlag: false,
        daysInConsolidation,
      };
    }

    // Compute consolidation high and low across all bars in the window
    let consolidationHigh = -Infinity;
    let consolidationLow = Infinity;
    let allDecliningVolume = true;
    let anyClosesBelowGapLow = false;
    let allWithinRange = true;

    for (let i = consolidationStartIndex; i <= currentBarIndex; i++) {
      if (i >= dataPoints.length) break;

      const bar = dataPoints[i];

      if (bar.high > consolidationHigh) consolidationHigh = bar.high;
      if (bar.low < consolidationLow) consolidationLow = bar.low;

      // Check if any close drops below gap day low or previous day's close (Req 8.2)
      if (bar.close < gapDayLow) {
        anyClosesBelowGapLow = true;
      }
      if (previousDayClose !== undefined && bar.close < previousDayClose) {
        anyClosesBelowGapLow = true;
      }

      // Check if close is within max_range_pct of gap day high
      const distanceFromHigh = ((gapDayHigh - bar.close) / gapDayHigh) * 100;
      if (distanceFromHigh > config.max_range_pct) {
        allWithinRange = false;
      }

      // Check declining volume
      if (bar.volume > gapDayVolume) {
        allDecliningVolume = false;
      }
    }

    // Failed: close below gap day low
    if (anyClosesBelowGapLow) {
      return {
        status: 'failed',
        consolidationHigh: consolidationHigh === -Infinity ? 0 : consolidationHigh,
        consolidationLow: consolidationLow === Infinity ? 0 : consolidationLow,
        decliningVolumeFlag: allDecliningVolume,
        daysInConsolidation,
      };
    }

    // Check if range condition holds and minimum days met
    if (allWithinRange && daysInConsolidation >= config.consolidation_min_days) {
      return {
        status: 'valid',
        consolidationHigh: consolidationHigh === -Infinity ? 0 : consolidationHigh,
        consolidationLow: consolidationLow === Infinity ? 0 : consolidationLow,
        decliningVolumeFlag: allDecliningVolume,
        daysInConsolidation,
      };
    }

    // If max days reached without valid consolidation and range not within threshold
    if (daysInConsolidation >= config.consolidation_max_days && !allWithinRange) {
      return {
        status: 'failed',
        consolidationHigh: consolidationHigh === -Infinity ? 0 : consolidationHigh,
        consolidationLow: consolidationLow === Infinity ? 0 : consolidationLow,
        decliningVolumeFlag: allDecliningVolume,
        daysInConsolidation,
      };
    }

    // Still in progress
    return {
      status: 'in_progress',
      consolidationHigh: consolidationHigh === -Infinity ? 0 : consolidationHigh,
      consolidationLow: consolidationLow === Infinity ? 0 : consolidationLow,
      decliningVolumeFlag: allDecliningVolume,
      daysInConsolidation,
    };
  }

  /**
   * Check if breakout entry conditions are met.
   *
   * Conditions:
   * 1. close > consolidation high
   * 2. volume > breakout_volume_multiplier × 20-bar average volume
   *
   * If conditions met, computes entry price, stop-loss, and profit target.
   * Returns null if conditions not met or insufficient data.
   */
  static shouldEnter(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    consolidationHigh: number,
    consolidationLow: number,
    config: PostEarningsDriftConfiguration
  ): EntryResult | null {
    if (barIndex < 0 || barIndex >= dataPoints.length) return null;

    const currentBar = dataPoints[barIndex];

    // Condition 1: close > consolidation high
    if (currentBar.close <= consolidationHigh) return null;

    // Need at least 20 bars for volume average at breakout
    const barsAvailable = barIndex + 1;
    if (barsAvailable < 20) return null;

    // Condition 2: volume > breakout_volume_multiplier × 20-bar avg volume
    const barsUpToAndIncluding = dataPoints.slice(0, barIndex + 1);
    const avgVol20 = avgVolume(barsUpToAndIncluding, 20);
    if (avgVol20 === undefined || avgVol20 === 0) return null;

    if (currentBar.volume <= avgVol20 * config.breakout_volume_multiplier) return null;

    // Need at least 14 bars for ATR calculation (ATR needs period + 1 = 15 bars)
    if (barsAvailable < 15) return null;

    // Compute ATR(14)
    const atr14 = atr(barsUpToAndIncluding, 14);
    if (atr14 === undefined) return null;

    // Compute entry, stop, target
    const entryPrice = currentBar.close;
    const stopLossPrice = consolidationLow - (config.stop_buffer_atr * atr14);
    const rValue = entryPrice - stopLossPrice;

    if (rValue <= 0) return null;

    const profitTargetPrice = entryPrice + (config.r_multiple * rValue);

    return {
      entryPrice,
      stopLossPrice,
      profitTargetPrice,
      rValue,
    };
  }

  // ============================================================
  // Bar-by-bar evaluation
  // ============================================================

  evaluateWithOHLCV(dataPoints: HistoricalDataPoint[], params: PostEarningsDriftParams): V2Signal {
    const { config, earningsDates } = params;

    if (!dataPoints || dataPoints.length === 0) {
      return {
        id: fastPeadSignalId(),
        ticker: '',
        direction: 'HOLD' as SignalDirection,
        strategyType: this.type,
        price: 0,
        timestamp: '',
      };
    }

    const currentBar = dataPoints[this.currentBarIndex];
    const barIndex = this.currentBarIndex;
    this.currentBarIndex++;

    if (!currentBar) {
      return {
        id: fastPeadSignalId(),
        ticker: '',
        direction: 'HOLD' as SignalDirection,
        strategyType: this.type,
        price: 0,
        timestamp: '',
      };
    }

    // ---- Phase 1: If position open, evaluate exits ----
    if (this.positionOpen) {
      return this.evaluateExits(dataPoints, barIndex, currentBar, config);
    }

    // ---- Phase 2: If no active gap, scan for earnings gap ----
    if (!this.activeGap) {
      this.scanForEarningsGap(dataPoints, barIndex, currentBar, earningsDates, config);

      // If we just detected a gap, check for gap-and-run on the same bar
      // (gap-and-run is checked in subsequent bars, not on the gap day itself)

      return {
        id: fastPeadSignalId(),
        ticker: '',
        direction: 'HOLD' as SignalDirection,
        strategyType: this.type,
        price: currentBar.close,
        timestamp: currentBar.date,
      };
    }

    // ---- Phase 3: Active gap, check for breakout ----
    if (this.activeGap && !this.breakoutTriggered) {
      return this.evaluateConsolidationAndBreakout(dataPoints, barIndex, currentBar, config);
    }

    // Default: HOLD
    return {
      id: fastPeadSignalId(),
      ticker: '',
      direction: 'HOLD' as SignalDirection,
      strategyType: this.type,
      price: currentBar.close,
      timestamp: currentBar.date,
    };
  }

  // ============================================================
  // Private helper methods
  // ============================================================

  private evaluateExits(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    currentBar: HistoricalDataPoint,
    config: PostEarningsDriftConfiguration
  ): V2Signal {
    const rValue = this.entryPrice - this.stopLossPrice;

    // Priority 1: Stop-loss — bar.low <= stopLossPrice
    if (currentBar.low <= this.stopLossPrice) {
      this.positionOpen = false;
      const signal: V2Signal = {
        id: fastPeadSignalId(),
        ticker: '',
        direction: 'SELL' as SignalDirection,
        strategyType: this.type,
        price: this.stopLossPrice,
        timestamp: currentBar.date,
        exitReason: 'stop_loss',
        stopLossPrice: this.stopLossPrice,
        profitTargetPrice: this.profitTargetPrice,
        rValue,
      };
      this.resetPositionState();
      return signal;
    }

    // Priority 2: Profit target — bar.high >= profitTargetPrice
    if (currentBar.high >= this.profitTargetPrice) {
      this.positionOpen = false;
      const signal: V2Signal = {
        id: fastPeadSignalId(),
        ticker: '',
        direction: 'SELL' as SignalDirection,
        strategyType: this.type,
        price: this.profitTargetPrice,
        timestamp: currentBar.date,
        exitReason: 'profit_target',
        stopLossPrice: this.stopLossPrice,
        profitTargetPrice: this.profitTargetPrice,
        rValue,
      };
      this.resetPositionState();
      return signal;
    }

    // Priority 3: Trend failsafe — bar.close < SMA(trend_exit_sma_period)
    // Skip if insufficient bars for SMA calculation
    const barsAvailable = barIndex + 1;
    if (barsAvailable >= config.trend_exit_sma_period) {
      const closes = dataPoints.slice(0, barIndex + 1).map(d => d.close);
      const trendSma = sma(closes, config.trend_exit_sma_period);

      if (trendSma !== undefined && currentBar.close < trendSma) {
        this.positionOpen = false;
        const signal: V2Signal = {
          id: fastPeadSignalId(),
          ticker: '',
          direction: 'SELL' as SignalDirection,
          strategyType: this.type,
          price: currentBar.close,
          timestamp: currentBar.date,
          exitReason: 'trend_failsafe',
          stopLossPrice: this.stopLossPrice,
          profitTargetPrice: this.profitTargetPrice,
          rValue,
        };
        this.resetPositionState();
        return signal;
      }
    }

    // No exit condition triggered — HOLD
    return {
      id: fastPeadSignalId(),
      ticker: '',
      direction: 'HOLD' as SignalDirection,
      strategyType: this.type,
      price: currentBar.close,
      timestamp: currentBar.date,
    };
  }

  private scanForEarningsGap(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    currentBar: HistoricalDataPoint,
    earningsDates: string[],
    config: PostEarningsDriftConfiguration
  ): void {
    // Check if the current bar's date matches an earnings date
    const currentDate = currentBar.date.slice(0, 10); // normalize to YYYY-MM-DD

    const earningsIndex = earningsDates.findIndex(d => d.slice(0, 10) === currentDate);
    if (earningsIndex === -1) return;

    // Check for nearby earnings (another earnings within 14 calendar days)
    if (this.hasNearbyEarnings(earningsDates, earningsIndex)) {
      return; // Skip this setup
    }

    // Detect the gap
    const gapResult = PostEarningsDriftEngine.detectEarningsGap(dataPoints, barIndex, config);

    if (gapResult.detected) {
      this.activeGap = {
        gapDayIndex: gapResult.gapDayIndex,
        gapDayHigh: gapResult.gapDayHigh,
        gapDayLow: gapResult.gapDayLow,
        gapDayVolume: gapResult.gapDayVolume,
        previousDayClose: gapResult.previousDayClose,
      };
      this.consolidationState = null;
      this.breakoutTriggered = false;
    }
  }

  private evaluateConsolidationAndBreakout(
    dataPoints: HistoricalDataPoint[],
    barIndex: number,
    currentBar: HistoricalDataPoint,
    config: PostEarningsDriftConfiguration
  ): V2Signal {
    const holdSignal: V2Signal = {
      id: fastPeadSignalId(),
      ticker: '',
      direction: 'HOLD' as SignalDirection,
      strategyType: this.type,
      price: currentBar.close,
      timestamp: currentBar.date,
    };

    if (!this.activeGap) return holdSignal;

    const daysAfterGap = barIndex - this.activeGap.gapDayIndex;

    // Gap-and-run detection: first bar after gap closes above gap day high
    // AND no bar within consolidation_min_days closes below gap day high
    if (daysAfterGap === 1) {
      if (currentBar.close > this.activeGap.gapDayHigh) {
        // Mark as potential gap-and-run; we'll confirm after consolidation_min_days
        // For now, if first bar closes above gap day high, we start tracking
        // but will check the full window at consolidation_min_days
      }
    }

    // Check gap-and-run: if we're at consolidation_min_days and all bars since gap
    // closed above gap day high, it's a gap-and-run → skip
    if (daysAfterGap === config.consolidation_min_days) {
      let allAboveGapHigh = true;
      for (let i = this.activeGap.gapDayIndex + 1; i <= barIndex; i++) {
        if (i < dataPoints.length && dataPoints[i].close <= this.activeGap.gapDayHigh) {
          allAboveGapHigh = false;
          break;
        }
      }
      // Also check that the first bar after gap closed above gap day high
      const firstBarAfterGap = dataPoints[this.activeGap.gapDayIndex + 1];
      if (firstBarAfterGap && firstBarAfterGap.close > this.activeGap.gapDayHigh && allAboveGapHigh) {
        // Gap-and-run detected — reset and skip
        this.activeGap = null;
        this.consolidationState = null;
        return holdSignal;
      }
    }

    // Evaluate consolidation
    const consolidation = PostEarningsDriftEngine.evaluateConsolidation(
      dataPoints,
      this.activeGap.gapDayIndex,
      barIndex,
      this.activeGap.gapDayHigh,
      this.activeGap.gapDayLow,
      this.activeGap.gapDayVolume,
      config,
      this.activeGap.previousDayClose
    );

    this.consolidationState = consolidation;

    // If consolidation failed or expired, reset
    if (consolidation.status === 'failed' || consolidation.status === 'expired') {
      this.activeGap = null;
      this.consolidationState = null;
      return holdSignal;
    }

    // If consolidation is valid, check for breakout
    if (consolidation.status === 'valid') {
      const entryResult = PostEarningsDriftEngine.shouldEnter(
        dataPoints,
        barIndex,
        consolidation.consolidationHigh,
        consolidation.consolidationLow,
        config
      );

      if (entryResult) {
        // Check max risk
        const riskPct = ((entryResult.entryPrice - entryResult.stopLossPrice) / entryResult.entryPrice) * 100;
        if (riskPct > config.max_risk_pct) {
          // Risk too high — don't enter but keep monitoring
          return holdSignal;
        }

        // Generate BUY signal
        this.positionOpen = true;
        this.entryPrice = entryResult.entryPrice;
        this.stopLossPrice = entryResult.stopLossPrice;
        this.profitTargetPrice = entryResult.profitTargetPrice;
        this.breakoutTriggered = true;

        return {
          id: fastPeadSignalId(),
          ticker: '',
          direction: 'BUY' as SignalDirection,
          strategyType: this.type,
          price: entryResult.entryPrice,
          timestamp: currentBar.date,
          stopLossPrice: entryResult.stopLossPrice,
          profitTargetPrice: entryResult.profitTargetPrice,
          rValue: entryResult.rValue,
        };
      }
    }

    // Check if consolidation window has expired (beyond max days without breakout)
    if (daysAfterGap > config.consolidation_max_days) {
      this.activeGap = null;
      this.consolidationState = null;
      return holdSignal;
    }

    return holdSignal;
  }

  /**
   * Check if there's another earnings date within 14 calendar days of the current one.
   */
  private hasNearbyEarnings(earningsDates: string[], currentIndex: number): boolean {
    const currentDate = new Date(earningsDates[currentIndex]);
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;

    // Check next earnings date
    if (currentIndex + 1 < earningsDates.length) {
      const nextDate = new Date(earningsDates[currentIndex + 1]);
      const diffMs = nextDate.getTime() - currentDate.getTime();
      if (diffMs > 0 && diffMs <= fourteenDaysMs) {
        return true;
      }
    }

    return false;
  }

  private resetPositionState(): void {
    this.entryPrice = 0;
    this.stopLossPrice = 0;
    this.profitTargetPrice = 0;
    this.activeGap = null;
    this.consolidationState = null;
    this.breakoutTriggered = false;
  }
}
