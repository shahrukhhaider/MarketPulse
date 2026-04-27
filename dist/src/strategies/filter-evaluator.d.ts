import type { HistoricalDataPoint } from '../types.js';
export type FilterCondition = {
    type: 'return_above';
    period: number;
    threshold: number;
} | {
    type: 'return_below';
    period: number;
    threshold: number;
} | {
    type: 'price_above_sma';
    period: number;
} | {
    type: 'price_below_sma';
    period: number;
} | {
    type: 'sma_above_sma';
    shortPeriod: number;
    longPeriod: number;
} | {
    type: 'rsi_below';
    period: number;
    threshold: number;
} | {
    type: 'rsi_above';
    period: number;
    threshold: number;
} | {
    type: 'price_near_sma';
    period: number;
    tolerance: number;
} | {
    type: 'price_above_highest';
    period: number;
} | {
    type: 'volume_above_avg';
    period: number;
    multiplier: number;
} | {
    type: 'volume_below_avg';
    period: number;
} | {
    type: 'outperforms_index';
    period: number;
    indexTicker: string;
};
export declare function evaluateConditions(conditions: FilterCondition[], prices: number[], dataPoints: HistoricalDataPoint[], auxiliaryData?: Record<string, HistoricalDataPoint[]>): boolean;
//# sourceMappingURL=filter-evaluator.d.ts.map