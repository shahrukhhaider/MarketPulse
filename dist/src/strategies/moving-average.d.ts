import type { Strategy, StrategyType, StrategyParams, PricePoint, Signal, MovingAverageCrossoverParams } from '../types.js';
/**
 * Moving Average Crossover strategy.
 *
 * BUY when the short-window moving average crosses above the long-window MA.
 * SELL when the short-window MA crosses below the long-window MA.
 * HOLD otherwise.
 */
export declare class MovingAverageCrossoverStrategy implements Strategy {
    type: StrategyType;
    evaluate(priceHistory: PricePoint[], params: StrategyParams): Signal;
    validateParams(params: StrategyParams): {
        valid: boolean;
        error?: string;
    };
    minimumDataPoints(): number;
    /**
     * Returns the minimum data points needed for the given params.
     */
    minimumDataPointsForParams(params: MovingAverageCrossoverParams): number;
    private average;
    private holdSignal;
}
//# sourceMappingURL=moving-average.d.ts.map