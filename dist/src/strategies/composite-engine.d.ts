import type { Strategy, StrategyType, StrategyParams, PricePoint, Signal } from '../types.js';
import { type CompositeStrategyParams } from './strategy-configs.js';
export declare class CompositeStrategyEngine implements Strategy {
    type: StrategyType;
    private positionOpen;
    private entryBarIndex;
    private entryPrice;
    private stopLossPrice;
    private currentBarIndex;
    constructor(strategyType: StrategyType);
    reset(): void;
    minimumDataPoints(): number;
    minimumDataPointsForParams(params: CompositeStrategyParams): number;
    evaluate(priceHistory: PricePoint[], params: StrategyParams): Signal;
    validateParams(params: StrategyParams): {
        valid: boolean;
        error?: string;
    };
    private makeSignal;
    private closePosition;
    private evaluateExitRules;
    private computeStopLoss;
    private periodRequirementForFilter;
    private periodRequirementForExitRule;
    private periodRequirementForRiskRule;
    private validateFilterCondition;
    private validateExitRule;
    private validateRiskRule;
}
//# sourceMappingURL=composite-engine.d.ts.map