import type { Config, StrategyType, StrategyParams, StrategyConfig } from './types.js';
import { type Result } from './config-store.js';
export declare class StrategyManager {
    private config;
    private configFilePath;
    constructor(config: Config, configFilePath: string);
    validateParams(strategyType: StrategyType, params: StrategyParams): Result<void>;
    configureStrategy(ticker: string, strategyType: StrategyType, params: StrategyParams): Result<void>;
    enableStrategy(ticker: string, strategyType: StrategyType): Result<void>;
    disableStrategy(ticker: string, strategyType: StrategyType): Result<void>;
    getStrategies(ticker: string): StrategyConfig[];
    private toggleStrategy;
    private findEntry;
}
//# sourceMappingURL=strategy-manager.d.ts.map