import type { HistoricalDataPoint, PricePoint, Strategy, StrategyParams, Signal, BacktestResult, PerformanceSummary } from './types.js';
export declare function convertHistoricalData(dataPoints: HistoricalDataPoint[], ticker: string): PricePoint[];
export declare function computePerformanceSummary(signals: Signal[], pricePoints: PricePoint[]): PerformanceSummary;
export declare class BacktestEngine {
    run(pricePoints: PricePoint[], strategy: Strategy, params: StrategyParams, period?: string): BacktestResult;
    private generateSignalId;
}
//# sourceMappingURL=backtest-engine.d.ts.map