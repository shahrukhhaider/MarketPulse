import type { HistoricalDataPoint, PricePoint, Strategy, StrategyParams, Signal, BacktestResult, PerformanceSummary, Trade } from './types.js';
import type { PhasedStrategyEngine } from './strategies/phased-engine.js';
import type { PhasedStrategyParams } from './strategies/strategy-configs.js';
export declare function convertHistoricalData(dataPoints: HistoricalDataPoint[], ticker: string): PricePoint[];
export declare function computePerformanceSummary(signals: Signal[], pricePoints: PricePoint[]): PerformanceSummary;
export declare function computePerformanceSummaryFromTrades(trades: Trade[], dataPoints: HistoricalDataPoint[]): PerformanceSummary;
export declare class BacktestEngine {
    run(pricePoints: PricePoint[], strategy: Strategy, params: StrategyParams, period?: string): BacktestResult;
    runV2(dataPoints: HistoricalDataPoint[], engine: PhasedStrategyEngine, params: PhasedStrategyParams, period?: string): BacktestResult;
    private generateSignalId;
}
//# sourceMappingURL=backtest-engine.d.ts.map