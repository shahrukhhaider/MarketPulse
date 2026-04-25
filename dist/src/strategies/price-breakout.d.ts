import type { Strategy, StrategyType, StrategyParams, PricePoint, Signal } from '../types.js';
/**
 * Price Breakout strategy.
 *
 * BUY when the current price breaks above the upper level.
 * SELL when the current price breaks below the lower level.
 * HOLD when the price is between the two levels (inclusive).
 */
export declare class PriceBreakoutStrategy implements Strategy {
    type: StrategyType;
    evaluate(priceHistory: PricePoint[], params: StrategyParams): Signal;
    validateParams(params: StrategyParams): {
        valid: boolean;
        error?: string;
    };
    minimumDataPoints(): number;
    private holdSignal;
}
//# sourceMappingURL=price-breakout.d.ts.map