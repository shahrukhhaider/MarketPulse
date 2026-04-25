"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StrategyManager = void 0;
const types_js_1 = require("./types.js");
const config_store_js_1 = require("./config-store.js");
class StrategyManager {
    config;
    configFilePath;
    constructor(config, configFilePath) {
        this.config = config;
        this.configFilePath = configFilePath;
    }
    validateParams(strategyType, params) {
        switch (strategyType) {
            case 'moving_average_crossover': {
                const p = params;
                if (p.shortWindow <= 0) {
                    return {
                        success: false,
                        error: `${types_js_1.ErrorCodes.INVALID_PARAM_RANGE}: shortWindow must be greater than 0`,
                    };
                }
                if (p.longWindow <= p.shortWindow) {
                    return {
                        success: false,
                        error: `${types_js_1.ErrorCodes.INVALID_PARAM_RANGE}: longWindow must be greater than shortWindow (${p.shortWindow})`,
                    };
                }
                return { success: true, data: undefined };
            }
            case 'rsi_threshold': {
                const p = params;
                if (p.period <= 0) {
                    return {
                        success: false,
                        error: `${types_js_1.ErrorCodes.INVALID_PARAM_RANGE}: period must be greater than 0`,
                    };
                }
                if (p.oversold <= 0 || p.oversold >= 100) {
                    return {
                        success: false,
                        error: `${types_js_1.ErrorCodes.INVALID_PARAM_RANGE}: oversold must be between 0 and 100 (exclusive)`,
                    };
                }
                if (p.overbought <= 0 || p.overbought >= 100) {
                    return {
                        success: false,
                        error: `${types_js_1.ErrorCodes.INVALID_PARAM_RANGE}: overbought must be between 0 and 100 (exclusive)`,
                    };
                }
                if (p.oversold >= p.overbought) {
                    return {
                        success: false,
                        error: `${types_js_1.ErrorCodes.INVALID_PARAM_RANGE}: oversold (${p.oversold}) must be less than overbought (${p.overbought})`,
                    };
                }
                return { success: true, data: undefined };
            }
            case 'price_breakout': {
                const p = params;
                if (p.lowerLevel <= 0) {
                    return {
                        success: false,
                        error: `${types_js_1.ErrorCodes.INVALID_PARAM_RANGE}: lowerLevel must be greater than 0`,
                    };
                }
                if (p.upperLevel <= p.lowerLevel) {
                    return {
                        success: false,
                        error: `${types_js_1.ErrorCodes.INVALID_PARAM_RANGE}: upperLevel must be greater than lowerLevel (${p.lowerLevel})`,
                    };
                }
                return { success: true, data: undefined };
            }
            default:
                return {
                    success: false,
                    error: `${types_js_1.ErrorCodes.INVALID_PARAM_RANGE}: Unknown strategy type '${strategyType}'`,
                };
        }
    }
    configureStrategy(ticker, strategyType, params) {
        const entry = this.findEntry(ticker);
        if (!entry) {
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.STOCK_NOT_FOUND}: Stock '${ticker.toUpperCase()}' is not in the watchlist`,
            };
        }
        const validation = this.validateParams(strategyType, params);
        if (!validation.success) {
            return validation;
        }
        const existingIndex = entry.strategies.findIndex((s) => s.type === strategyType);
        if (existingIndex !== -1) {
            const previous = { ...entry.strategies[existingIndex] };
            entry.strategies[existingIndex] = {
                type: strategyType,
                params,
                enabled: entry.strategies[existingIndex].enabled,
            };
            const saveResult = (0, config_store_js_1.save)(this.config, this.configFilePath);
            if (!saveResult.success) {
                entry.strategies[existingIndex] = previous;
                return { success: false, error: saveResult.error };
            }
        }
        else {
            const newConfig = {
                type: strategyType,
                params,
                enabled: true,
            };
            entry.strategies.push(newConfig);
            const saveResult = (0, config_store_js_1.save)(this.config, this.configFilePath);
            if (!saveResult.success) {
                entry.strategies.pop();
                return { success: false, error: saveResult.error };
            }
        }
        return { success: true, data: undefined };
    }
    enableStrategy(ticker, strategyType) {
        return this.toggleStrategy(ticker, strategyType, true);
    }
    disableStrategy(ticker, strategyType) {
        return this.toggleStrategy(ticker, strategyType, false);
    }
    getStrategies(ticker) {
        const entry = this.findEntry(ticker);
        if (!entry) {
            return [];
        }
        return entry.strategies;
    }
    toggleStrategy(ticker, strategyType, enabled) {
        const entry = this.findEntry(ticker);
        if (!entry) {
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.STOCK_NOT_FOUND}: Stock '${ticker.toUpperCase()}' is not in the watchlist`,
            };
        }
        const strategy = entry.strategies.find((s) => s.type === strategyType);
        if (!strategy) {
            return {
                success: false,
                error: `${types_js_1.ErrorCodes.STOCK_NOT_FOUND}: Strategy '${strategyType}' is not configured for '${ticker.toUpperCase()}'`,
            };
        }
        const previousEnabled = strategy.enabled;
        strategy.enabled = enabled;
        const saveResult = (0, config_store_js_1.save)(this.config, this.configFilePath);
        if (!saveResult.success) {
            strategy.enabled = previousEnabled;
            return { success: false, error: saveResult.error };
        }
        return { success: true, data: undefined };
    }
    findEntry(ticker) {
        const normalized = ticker.toUpperCase();
        return this.config.watchlist.find((e) => e.ticker.toUpperCase() === normalized);
    }
}
exports.StrategyManager = StrategyManager;
//# sourceMappingURL=strategy-manager.js.map