import type { HistoricalDataPoint, PricePoint, Strategy, StrategyParams, Signal, V2CompatibleEngine, BacktestResult, PerformanceSummary, Trade } from './types.js';
import type { PhasedStrategyParams, ConsolidationBreakoutParams } from './strategies/strategy-configs.js';
export declare function convertHistoricalData(dataPoints: HistoricalDataPoint[], ticker: string): PricePoint[];
export declare function computePerformanceSummary(signals: Signal[], pricePoints: PricePoint[]): PerformanceSummary;
export declare function computePerformanceSummaryFromTrades(trades: Trade[], dataPoints: HistoricalDataPoint[]): PerformanceSummary;
export declare class BacktestEngine {
    run(pricePoints: PricePoint[], strategy: Strategy, params: StrategyParams, period?: string): BacktestResult;
    runV2(dataPoints: HistoricalDataPoint[], engine: V2CompatibleEngine, params: PhasedStrategyParams | ConsolidationBreakoutParams, period?: string): BacktestResult;
    private generateSignalId;
}
//# sourceMappingURL=backtest-engine.d.ts.map