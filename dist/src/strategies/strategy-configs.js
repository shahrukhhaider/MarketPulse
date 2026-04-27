"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BREAKOUT_VOLUME_CONFIG = exports.TREND_PULLBACK_CONFIG = exports.MOMENTUM_CONTINUATION_CONFIG = void 0;
exports.isV2Config = isV2Config;
exports.isV1Config = isV1Config;
exports.getDefaultCompositeConfig = getDefaultCompositeConfig;
// ============================================================
// Default Strategy Configurations
// ============================================================
exports.MOMENTUM_CONTINUATION_CONFIG = {
    name: 'momentum_continuation',
    directionFilters: [
        { type: 'return_above', period: 20, threshold: 10 },
        { type: 'price_above_sma', period: 50 },
    ],
    timingFilters: [
        { type: 'return_above', period: 3, threshold: 3 },
    ],
    confirmationFilters: [
        { type: 'outperforms_index', period: 20, indexTicker: 'SPY' },
    ],
    exitRules: [
        { type: 'hold_days', days: 63 },
        { type: 'price_below_sma', period: 10 },
        { type: 'rsi_above', period: 14, threshold: 70 },
    ],
    riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: 5.0 },
    indexTicker: 'SPY',
};
exports.TREND_PULLBACK_CONFIG = {
    name: 'trend_pullback',
    directionFilters: [
        { type: 'price_above_sma', period: 50 },
        { type: 'sma_above_sma', shortPeriod: 50, longPeriod: 200 },
    ],
    timingFilters: [
        { type: 'rsi_below', period: 14, threshold: 40 },
        { type: 'price_near_sma', period: 50, tolerance: 0.02 },
    ],
    confirmationFilters: [
        { type: 'volume_below_avg', period: 20 },
    ],
    exitRules: [
        { type: 'rsi_above', period: 14, threshold: 60 },
        { type: 'hold_days', days: 63 },
        { type: 'price_below_sma', period: 10 },
    ],
    riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: 5.0 },
};
exports.BREAKOUT_VOLUME_CONFIG = {
    name: 'breakout_volume',
    directionFilters: [
        { type: 'price_above_sma', period: 50 },
    ],
    timingFilters: [
        { type: 'price_above_highest', period: 20 },
    ],
    confirmationFilters: [
        { type: 'volume_above_avg', period: 20, multiplier: 1.5 },
    ],
    exitRules: [
        { type: 'price_below_sma', period: 10 },
        { type: 'hold_days', days: 63 },
        { type: 'rsi_above', period: 14, threshold: 70 },
    ],
    riskRule: { type: 'atr_multiple', atrPeriod: 14, multiple: 5.0 },
};
// ============================================================
// Configuration Detection Helpers
// ============================================================
function isV2Config(config) {
    return config && typeof config.phases === 'object';
}
function isV1Config(config) {
    return config && Array.isArray(config.directionFilters);
}
// ============================================================
// Config Lookup
// ============================================================
const configMap = {
    momentum_continuation: exports.MOMENTUM_CONTINUATION_CONFIG,
    trend_pullback: exports.TREND_PULLBACK_CONFIG,
    breakout_volume: exports.BREAKOUT_VOLUME_CONFIG,
};
function getDefaultCompositeConfig(strategyType) {
    const config = configMap[strategyType];
    if (!config) {
        throw new Error(`No default composite config for strategy type: ${strategyType}`);
    }
    return config;
}
//# sourceMappingURL=strategy-configs.js.map