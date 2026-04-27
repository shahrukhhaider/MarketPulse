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
  PhasedStrategyParams,
  PhasedStrategyConfiguration,
  PhaseDefinition,
} from './strategy-configs.js';
import { evaluateConditions } from './filter-evaluator.js';
import { atr, sma, swingLow } from '../indicators.js';

export class PhasedStrategyEngine implements Strategy {
  type: StrategyType;

  private positionOpen: boolean = false;
  private entryBarIndex: number = -1;
  private entryPrice: number = 0;
  private stopLossPrice: number = 0;
  private profitTargetPrice: number = 0;
  private currentBarIndex: number = 0;

  constructor(strategyType: StrategyType = 'momentum_continuation') {
    this.type = strategyType;
  }

  reset(): void {
    this.positionOpen = false;
    this.entryBarIndex = -1;
    this.entryPrice = 0;
    this.stopLossPrice = 0;
    this.profitTargetPrice = 0;
    this.currentBarIndex = 0;
  }

  minimumDataPoints(): number {
    return 200;
  }

  minimumDataPointsForParams(params: PhasedStrategyParams): number {
    const { config } = params;
    let maxPeriod = 0;

    // Collect period requirements from all phase conditions
    const allPhases: PhaseDefinition[] = [
      config.phases.direction,
      config.phases.setup,
      config.phases.trigger,
    ];

    for (const phase of allPhases) {
      for (const condition of phase.conditions) {
        maxPeriod = Math.max(maxPeriod, this.periodRequirementForCondition(condition));
      }
    }

    // Stop-loss ATR period requirement: ATR needs period + 1
    maxPeriod = Math.max(maxPeriod, config.stopLoss.atr_period + 1);

    // Swing low lookback requirement
    maxPeriod = Math.max(maxPeriod, config.stopLoss.swing_low_lookback);

    // Trend exit SMA period requirement
    maxPeriod = Math.max(maxPeriod, config.trendExit.trend_exit_sma_period);

    return maxPeriod;
  }

  evaluate(priceHistory: PricePoint[], params: StrategyParams): Signal {
    // Convert PricePoint[] to synthetic HistoricalDataPoint[]
    const syntheticDataPoints: HistoricalDataPoint[] = priceHistory.map(pp => ({
      date: pp.timestamp,
      open: pp.price,
      high: pp.price,
      low: pp.price,
      close: pp.price,
      volume: 0,
    }));

    const phasedParams = params as unknown as PhasedStrategyParams;
    return this.evaluateWithOHLCV(syntheticDataPoints, phasedParams);
  }

  evaluateWithOHLCV(dataPoints: HistoricalDataPoint[], params: PhasedStrategyParams): V2Signal {
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

    const { config } = params;
    const prices = dataPoints.map(dp => dp.close);
    const latestBar = dataPoints[dataPoints.length - 1];
    this.currentBarIndex++;

    // Build auxiliary data from primaryDataPoints if provided
    const auxiliaryData = params.primaryDataPoints
      ? { SPY: params.primaryDataPoints }
      : undefined;

    if (this.positionOpen) {
      // Evaluate exit
      const barsHeld = this.currentBarIndex - this.entryBarIndex;
      const exitResult = this.evaluateExit(latestBar, prices, config, barsHeld);

      if (exitResult) {
        this.positionOpen = false;
        const rValue = this.entryPrice - this.stopLossPrice;
        return {
          id: crypto.randomUUID(),
          ticker: '',
          direction: 'SELL' as SignalDirection,
          strategyType: this.type,
          price: exitResult.exitPrice,
          timestamp: latestBar.date,
          exitReason: exitResult.exitReason,
          stopLossPrice: this.stopLossPrice,
          profitTargetPrice: this.profitTargetPrice,
          rValue,
        };
      }

      // No exit — HOLD
      return {
        id: crypto.randomUUID(),
        ticker: '',
        direction: 'HOLD' as SignalDirection,
        strategyType: this.type,
        price: latestBar.close,
        timestamp: latestBar.date,
      };
    }

    // Position not open — evaluate entry
    const entryResult = this.evaluateEntry(prices, dataPoints, config, auxiliaryData);

    if (entryResult) {
      this.positionOpen = true;
      this.entryBarIndex = this.currentBarIndex;
      this.entryPrice = latestBar.close;
      this.stopLossPrice = entryResult.stopLossPrice;
      this.profitTargetPrice = entryResult.profitTargetPrice;

      return {
        id: crypto.randomUUID(),
        ticker: '',
        direction: 'BUY' as SignalDirection,
        strategyType: this.type,
        price: latestBar.close,
        timestamp: latestBar.date,
        stopLossPrice: entryResult.stopLossPrice,
        profitTargetPrice: entryResult.profitTargetPrice,
        rValue: entryResult.rValue,
      };
    }

    // No entry — HOLD
    return {
      id: crypto.randomUUID(),
      ticker: '',
      direction: 'HOLD' as SignalDirection,
      strategyType: this.type,
      price: latestBar.close,
      timestamp: latestBar.date,
    };
  }

  validateParams(params: StrategyParams): { valid: boolean; error?: string } {
    const phasedParams = params as unknown as PhasedStrategyParams;
    const { config } = phasedParams;

    if (!config) {
      return { valid: false, error: 'Missing strategy configuration' };
    }

    // Validate stop-loss parameters
    if (config.stopLoss.atr_period < 1) {
      return { valid: false, error: 'atr_period must be >= 1' };
    }
    if (config.stopLoss.atr_multiple <= 0) {
      return { valid: false, error: 'atr_multiple must be > 0' };
    }
    if (config.stopLoss.swing_low_lookback < 1) {
      return { valid: false, error: 'swing_low_lookback must be >= 1' };
    }
    if (config.stopLoss.swing_buffer_atr < 0) {
      return { valid: false, error: 'swing_buffer_atr must be >= 0' };
    }

    // Validate max risk
    if (config.maxRisk.max_risk_pct <= 0 || config.maxRisk.max_risk_pct > 100) {
      return { valid: false, error: 'max_risk_pct must be in range (0, 100]' };
    }

    // Validate profit target
    if (config.profitTarget.target_r_multiple <= 0) {
      return { valid: false, error: 'target_r_multiple must be > 0' };
    }

    // Validate trend exit
    if (config.trendExit.trend_exit_sma_period < 1) {
      return { valid: false, error: 'trend_exit_sma_period must be >= 1' };
    }

    // Validate min hold days
    if (config.min_hold_days < 1) {
      return { valid: false, error: 'min_hold_days must be >= 1' };
    }

    return { valid: true };
  }

  // ============================================================
  // Phase evaluation
  // ============================================================

  evaluatePhase(
    phase: PhaseDefinition,
    prices: number[],
    dataPoints: HistoricalDataPoint[],
    auxiliaryData?: Record<string, HistoricalDataPoint[]>
  ): boolean {
    // Empty conditions → phase is valid (Req 1.5)
    if (phase.conditions.length === 0) {
      return true;
    }

    if (phase.logic === 'ALL') {
      // ALL-of: every condition must pass (Req 1.2, 1.4)
      return evaluateConditions(phase.conditions, prices, dataPoints, auxiliaryData);
    }

    // ANY-of: at least one condition must pass (Req 1.3)
    return phase.conditions.some(condition =>
      evaluateConditions([condition], prices, dataPoints, auxiliaryData)
    );
  }

  // ============================================================
  // Entry evaluation
  // ============================================================

  evaluateEntry(
    prices: number[],
    dataPoints: HistoricalDataPoint[],
    config: PhasedStrategyConfiguration,
    auxiliaryData?: Record<string, HistoricalDataPoint[]>
  ): { direction: 'BUY'; stopLossPrice: number; profitTargetPrice: number; rValue: number } | null {
    // Suppress BUY when position is already open (Req 2.3)
    if (this.positionOpen) {
      return null;
    }

    // Evaluate all 3 phases (Req 2.1, 2.2)
    const directionValid = this.evaluatePhase(config.phases.direction, prices, dataPoints, auxiliaryData);
    const setupValid = this.evaluatePhase(config.phases.setup, prices, dataPoints, auxiliaryData);
    const triggerValid = this.evaluatePhase(config.phases.trigger, prices, dataPoints, auxiliaryData);

    // If any phase fails, return null (Req 2.2)
    if (!directionValid || !setupValid || !triggerValid) {
      return null;
    }

    // Entry price = last data point's close (Req 2.4)
    const entryPrice = dataPoints[dataPoints.length - 1].close;

    // Compute ATR (Req 3.1)
    const atrValue = atr(dataPoints, config.stopLoss.atr_period);
    if (atrValue === undefined) {
      return null; // Insufficient data (Req 3.4)
    }

    // ATR Stop = entry_price - (atr_multiple × ATR) (Req 3.1)
    const atrStop = entryPrice - config.stopLoss.atr_multiple * atrValue;

    // Swing low for structure stop (Req 3.2)
    const swingLowValue = swingLow(dataPoints, config.stopLoss.swing_low_lookback);
    if (swingLowValue === undefined) {
      return null; // Insufficient data
    }

    // Structure Stop = swing_low - (swing_buffer_atr × ATR) (Req 3.2)
    const structureStop = swingLowValue - config.stopLoss.swing_buffer_atr * atrValue;

    // Stop price = tighter (higher) of the two stops (Req 3.3)
    const stopPrice = Math.max(atrStop, structureStop);

    // R_Value = entry_price - stop_price; skip if <= 0 (Req 6.1, 6.4)
    const rValue = entryPrice - stopPrice;
    if (rValue <= 0) {
      return null;
    }

    // Profit target = entry_price + target_r_multiple × R_Value (Req 6.2)
    const profitTargetPrice = entryPrice + config.profitTarget.target_r_multiple * rValue;

    // Risk percentage filter (Req 4.1, 4.2)
    const riskPct = ((entryPrice - stopPrice) / entryPrice) * 100;
    if (riskPct > config.maxRisk.max_risk_pct) {
      return null;
    }

    return {
      direction: 'BUY',
      stopLossPrice: stopPrice,
      profitTargetPrice,
      rValue,
    };
  }

  // ============================================================
  // Exit evaluation
  // ============================================================

  evaluateExit(
    bar: HistoricalDataPoint,
    prices: number[],
    config: PhasedStrategyConfiguration,
    barsHeld: number
  ): { direction: 'SELL'; exitPrice: number; exitReason: 'stop_loss' | 'profit_target' | 'trend_failsafe' } | null {
    // Priority 1: Stop-loss — never suppressed by min_hold_days (Req 5.2, 8.3)
    if (bar.low <= this.stopLossPrice) {
      return { direction: 'SELL', exitPrice: this.stopLossPrice, exitReason: 'stop_loss' };
    }

    // If within min_hold_days, suppress profit target and trend failsafe (Req 8.1, 8.2)
    if (barsHeld < config.min_hold_days) {
      return null;
    }

    // Priority 2: Profit target (Req 5.3)
    if (bar.high >= this.profitTargetPrice) {
      return { direction: 'SELL', exitPrice: this.profitTargetPrice, exitReason: 'profit_target' };
    }

    // Priority 3: Trend failsafe — close < SMA(trend_exit_sma_period) (Req 5.4, 7.2, 7.3)
    const trendSma = sma(prices, config.trendExit.trend_exit_sma_period);
    if (trendSma !== undefined && bar.close < trendSma) {
      return { direction: 'SELL', exitPrice: bar.close, exitReason: 'trend_failsafe' };
    }

    // No exit condition triggered (Req 5.5)
    return null;
  }

  // ============================================================
  // Private helpers
  // ============================================================

  private periodRequirementForCondition(condition: { type: string; [key: string]: any }): number {
    switch (condition.type) {
      case 'return_above':
      case 'return_below':
        return condition.period + 1;
      case 'price_above_sma':
      case 'price_below_sma':
      case 'price_near_sma':
        return condition.period;
      case 'sma_above_sma':
        return condition.longPeriod;
      case 'rsi_below':
      case 'rsi_above':
        return condition.period + 1;
      case 'price_above_highest':
        return condition.period + 1;
      case 'volume_above_avg':
      case 'volume_below_avg':
        return condition.period;
      case 'outperforms_index':
        return condition.period + 1;
      default:
        return 0;
    }
  }
}
