import type { FilterCondition } from './filter-evaluator.js';
import type { HistoricalDataPoint, StrategyType } from '../types.js';
export type ExitRule = {
    type: 'hold_days';
    days: number;
} | {
    type: 'rsi_above';
    period: number;
    threshold: number;
} | {
    type: 'rsi_below';
    period: number;
    threshold: number;
} | {
    type: 'price_below_sma';
    period: number;
} | {
    type: 'price_above_sma';
    period: number;
};
export type RiskRule = {
    type: 'atr_multiple';
    atrPeriod: number;
    multiple: number;
} | {
    type: 'percentage';
    percentage: number;
};
export interface StrategyConfiguration {
    name: string;
    directionFilters: FilterCondition[];
    timingFilters: FilterCondition[];
    confirmationFilters: FilterCondition[];
    exitRules: ExitRule[];
    riskRule?: RiskRule;
    indexTicker?: string;
    signalMode?: 'binary' | 'confidence';
    confidenceThreshold?: number;
    directionWeight?: number;
    timingWeight?: number;
    confirmationWeight?: number;
}
export interface CompositeStrategyParams {
    config: StrategyConfiguration;
    auxiliaryData?: Record<string, HistoricalDataPoint[]>;
    primaryDataPoints?: HistoricalDataPoint[];
}
export interface PhaseDefinition {
    conditions: FilterCondition[];
    logic: 'ALL' | 'ANY';
}
export interface PhasedStrategyConfiguration {
    name: string;
    phases: {
        direction: PhaseDefinition;
        setup: PhaseDefinition;
        trigger: PhaseDefinition;
    };
    stopLoss: {
        atr_period: number;
        atr_multiple: number;
        swing_low_lookback: number;
        swing_buffer_atr: number;
    };
    profitTarget: {
        target_r_multiple: number;
    };
    trendExit: {
        trend_exit_sma_period: number;
    };
    maxRisk: {
        max_risk_pct: number;
    };
    min_hold_days: number;
}
export interface PhasedStrategyParams {
    config: PhasedStrategyConfiguration;
    primaryDataPoints?: HistoricalDataPoint[];
}
export declare const MOMENTUM_CONTINUATION_CONFIG: StrategyConfiguration;
export declare const TREND_PULLBACK_CONFIG: StrategyConfiguration;
export declare const BREAKOUT_VOLUME_CONFIG: StrategyConfiguration;
export interface ConsolidationBreakoutConfiguration {
    name: string;
    consolidation: {
        consolidation_window: number;
        max_range_pct: number;
        atr_ratio_threshold: number;
        sma_proximity_pct?: number;
        max_staleness: number;
    };
    breakout: {
        volume_multiplier: number;
        return_20d_threshold?: number;
    };
    direction: {
        require_sma20_above_sma50: boolean;
        require_sma50_slope_positive: boolean;
    };
    overextension: {
        overextension_pct: number;
    };
    stopLoss: {
        atr_multiple: number;
        swing_lookback: number;
        buffer: number;
    };
    profitTarget: {
        r_multiple: number;
    };
    maxRisk: {
        max_risk_pct: number;
    };
    trendExit: {
        trend_exit_sma_period: number;
    };
    exitMode?: 'fixed' | 'trailing';
    trailingStop?: {
        trailingMethod: 'sma20' | 'atr';
        atrTrailMultiple?: number;
        atrTrailReference?: 'close' | 'highest_close';
        smaTrailBuffer?: number;
        breakevenThreshold: number;
        trailActivationThreshold: number;
        removeProfitTarget: boolean;
    };
}
export interface ConsolidationBreakoutParams {
    config: ConsolidationBreakoutConfiguration;
    primaryDataPoints?: HistoricalDataPoint[];
}
export declare function isConsolidationBreakoutConfig(config: any): config is ConsolidationBreakoutConfiguration;
export declare function isV2Config(config: any): config is PhasedStrategyConfiguration;
export declare function isV1Config(config: any): config is StrategyConfiguration;
export declare function getDefaultCompositeConfig(strategyType: StrategyType): StrategyConfiguration;
//# sourceMappingURL=strategy-configs.d.ts.map