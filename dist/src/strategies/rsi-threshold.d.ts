import type { Strategy, StrategyType, StrategyParams, PricePoint, Signal, RSIThresholdParams } from '../types.js';
/**
 * RSI (Relative Strength Index) Threshold strategy.
 *
 * BUY when RSI drops below the oversold threshold.
 * SELL when RSI rises above the overbought threshold.
 * HOLD otherwise.
 */
export declare class RSIThresholdStrategy implements Strategy {
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
    minimumDataPointsForParams(params: RSIThresholdParams): number;
    /**
     * Calculate RSI using the standard Wilder's smoothing method.
     *
     * RSI = 100 - (100 / (1 + RS))
     * RS = Average Gain / Average Loss over the period
     */
    private calculateRSI;
    private holdSignal;
}
//# sourceMappingURL=rsi-threshold.d.ts.map