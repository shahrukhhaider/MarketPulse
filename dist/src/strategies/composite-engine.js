"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompositeStrategyEngine = void 0;
const indicators_js_1 = require("../indicators.js");
const filter_evaluator_js_1 = require("./filter-evaluator.js");
const strategy_configs_js_1 = require("./strategy-configs.js");
class CompositeStrategyEngine {
    type;
    positionOpen = false;
    entryBarIndex = -1;
    entryPrice = 0;
    stopLossPrice = undefined;
    currentBarIndex = 0;
    constructor(strategyType) {
        this.type = strategyType;
    }
    reset() {
        this.positionOpen = false;
        this.entryBarIndex = -1;
        this.entryPrice = 0;
        this.stopLossPrice = undefined;
        this.currentBarIndex = 0;
    }
    minimumDataPoints() {
        const config = (0, strategy_configs_js_1.getDefaultCompositeConfig)(this.type);
        return this.minimumDataPointsForParams({ config });
    }
    minimumDataPointsForParams(params) {
        const { config } = params;
        let maxPeriod = 0;
        const allFilters = [
            ...config.directionFilters,
            ...config.timingFilters,
            ...config.confirmationFilters,
        ];
        for (const f of allFilters) {
            maxPeriod = Math.max(maxPeriod, this.periodRequirementForFilter(f));
        }
        for (const rule of config.exitRules) {
            maxPeriod = Math.max(maxPeriod, this.periodRequirementForExitRule(rule));
        }
        if (config.riskRule) {
            maxPeriod = Math.max(maxPeriod, this.periodRequirementForRiskRule(config.riskRule));
        }
        return maxPeriod;
    }
    evaluate(priceHistory, params) {
        const compositeParams = params;
        const { config, auxiliaryData } = compositeParams;
        const latest = priceHistory[priceHistory.length - 1];
        const prices = priceHistory.map(p => p.price);
        // Use real OHLCV data if provided, otherwise synthesize from close prices
        const dataPoints = compositeParams.primaryDataPoints && compositeParams.primaryDataPoints.length >= priceHistory.length
            ? compositeParams.primaryDataPoints.slice(0, priceHistory.length)
            : priceHistory.map(p => ({
                date: p.timestamp,
                open: p.price,
                high: p.price,
                low: p.price,
                close: p.price,
                volume: 0,
            }));
        const barIndex = this.currentBarIndex;
        this.currentBarIndex++;
        const minRequired = this.minimumDataPointsForParams(compositeParams);
        if (priceHistory.length < minRequired) {
            return this.makeSignal(latest, 'HOLD');
        }
        // --- Exit rule evaluation (only when position is open) ---
        if (this.positionOpen) {
            const shouldSell = this.evaluateExitRules(config, prices, dataPoints, barIndex, latest.price);
            if (shouldSell) {
                this.closePosition();
                return this.makeSignal(latest, 'SELL');
            }
            // Position open but no exit triggered — HOLD (suppress BUY)
            return this.makeSignal(latest, 'HOLD');
        }
        // --- Entry signal evaluation (only when no position is open) ---
        if (config.signalMode === 'confidence') {
            const directionScore = (0, filter_evaluator_js_1.scoreConditions)(config.directionFilters, prices, dataPoints, auxiliaryData);
            const timingScore = (0, filter_evaluator_js_1.scoreConditions)(config.timingFilters, prices, dataPoints, auxiliaryData);
            const confirmationScore = (0, filter_evaluator_js_1.scoreConditions)(config.confirmationFilters, prices, dataPoints, auxiliaryData);
            const dw = config.directionWeight ?? 1.0;
            const tw = config.timingWeight ?? 1.0;
            const cw = config.confirmationWeight ?? 1.0;
            const totalWeight = dw + tw + cw;
            const compositeScore = totalWeight === 0
                ? 0
                : (dw * directionScore + tw * timingScore + cw * confirmationScore) / totalWeight;
            const threshold = config.confidenceThreshold ?? 0.6;
            if (compositeScore > threshold) {
                this.stopLossPrice = this.computeStopLoss(config.riskRule, latest.price, dataPoints);
                this.positionOpen = true;
                this.entryBarIndex = barIndex;
                this.entryPrice = latest.price;
                return this.makeSignal(latest, 'BUY');
            }
            return this.makeSignal(latest, 'HOLD');
        }
        else {
            // Existing binary AND path (unchanged)
            const directionPass = (0, filter_evaluator_js_1.evaluateConditions)(config.directionFilters, prices, dataPoints, auxiliaryData);
            const timingPass = (0, filter_evaluator_js_1.evaluateConditions)(config.timingFilters, prices, dataPoints, auxiliaryData);
            const confirmationPass = (0, filter_evaluator_js_1.evaluateConditions)(config.confirmationFilters, prices, dataPoints, auxiliaryData);
            if (directionPass && timingPass && confirmationPass) {
                this.stopLossPrice = this.computeStopLoss(config.riskRule, latest.price, dataPoints);
                this.positionOpen = true;
                this.entryBarIndex = barIndex;
                this.entryPrice = latest.price;
                return this.makeSignal(latest, 'BUY');
            }
            return this.makeSignal(latest, 'HOLD');
        }
    }
    validateParams(params) {
        const compositeParams = params;
        const { config } = compositeParams;
        if (!config) {
            return { valid: false, error: 'Missing strategy configuration' };
        }
        const allFilters = [
            ...config.directionFilters,
            ...config.timingFilters,
            ...config.confirmationFilters,
        ];
        const hasFilters = allFilters.length > 0;
        const hasExitRules = config.exitRules.length > 0;
        if (!hasFilters && !hasExitRules) {
            return { valid: false, error: 'At least one filter or exit rule is required' };
        }
        // Validate filter conditions
        for (const f of allFilters) {
            const err = this.validateFilterCondition(f);
            if (err)
                return { valid: false, error: err };
        }
        // Validate exit rules
        for (const rule of config.exitRules) {
            const err = this.validateExitRule(rule);
            if (err)
                return { valid: false, error: err };
        }
        // Validate risk rule
        if (config.riskRule) {
            const err = this.validateRiskRule(config.riskRule);
            if (err)
                return { valid: false, error: err };
        }
        // Validate confidence-score fields
        if (config.confidenceThreshold !== undefined) {
            if (config.confidenceThreshold <= 0 || config.confidenceThreshold > 1) {
                return { valid: false, error: 'confidenceThreshold must be in range (0, 1]' };
            }
        }
        if (config.directionWeight !== undefined && config.directionWeight < 0) {
            return { valid: false, error: 'directionWeight must be >= 0' };
        }
        if (config.timingWeight !== undefined && config.timingWeight < 0) {
            return { valid: false, error: 'timingWeight must be >= 0' };
        }
        if (config.confirmationWeight !== undefined && config.confirmationWeight < 0) {
            return { valid: false, error: 'confirmationWeight must be >= 0' };
        }
        return { valid: true };
    }
    // ============================================================
    // Private helpers
    // ============================================================
    makeSignal(latest, direction) {
        return {
            id: '',
            ticker: latest.ticker,
            direction,
            strategyType: this.type,
            price: latest.price,
            timestamp: latest.timestamp,
        };
    }
    closePosition() {
        this.positionOpen = false;
        this.entryBarIndex = -1;
        this.entryPrice = 0;
        this.stopLossPrice = undefined;
    }
    evaluateExitRules(config, prices, dataPoints, barIndex, currentPrice) {
        // 1. ATR stop-loss check — always active, even during hold period
        if (this.stopLossPrice !== undefined && currentPrice <= this.stopLossPrice) {
            return true;
        }
        // 2. Hold period gate — suppress all other exits while position age < hold_days
        const holdDaysRule = config.exitRules.find((r) => r.type === 'hold_days');
        if (holdDaysRule && (barIndex - this.entryBarIndex) < holdDaysRule.days) {
            return false;
        }
        // 3. Evaluate remaining exit rules (hold_days is a gate, not a trigger — skip it)
        for (const rule of config.exitRules) {
            switch (rule.type) {
                case 'hold_days':
                    // Not a trigger — handled above as a gate
                    break;
                case 'rsi_above': {
                    const rsiVal = (0, indicators_js_1.rsi)(prices, rule.period);
                    if (rsiVal !== undefined && rsiVal > rule.threshold)
                        return true;
                    break;
                }
                case 'rsi_below': {
                    const rsiVal = (0, indicators_js_1.rsi)(prices, rule.period);
                    if (rsiVal !== undefined && rsiVal < rule.threshold)
                        return true;
                    break;
                }
                case 'price_below_sma': {
                    const smaVal = (0, indicators_js_1.sma)(prices, rule.period);
                    if (smaVal !== undefined && currentPrice < smaVal)
                        return true;
                    break;
                }
                case 'price_above_sma': {
                    const smaVal = (0, indicators_js_1.sma)(prices, rule.period);
                    if (smaVal !== undefined && currentPrice > smaVal)
                        return true;
                    break;
                }
            }
        }
        return false;
    }
    computeStopLoss(riskRule, entryPrice, dataPoints) {
        if (!riskRule)
            return undefined;
        switch (riskRule.type) {
            case 'atr_multiple': {
                const atrVal = (0, indicators_js_1.atr)(dataPoints, riskRule.atrPeriod);
                if (atrVal === undefined)
                    return undefined; // Req 5.5: skip stop-loss if ATR unavailable
                return entryPrice - atrVal * riskRule.multiple;
            }
            case 'percentage': {
                return entryPrice * (1 - riskRule.percentage / 100);
            }
        }
    }
    periodRequirementForFilter(f) {
        switch (f.type) {
            case 'return_above':
            case 'return_below':
                return f.period + 1; // returnNd needs period + 1
            case 'price_above_sma':
            case 'price_below_sma':
            case 'price_near_sma':
                return f.period;
            case 'sma_above_sma':
                return f.longPeriod;
            case 'rsi_below':
            case 'rsi_above':
                return f.period + 1; // RSI needs period + 1
            case 'price_above_highest':
                return f.period + 1; // +1 because we exclude current price (slice(0, -1))
            case 'volume_above_avg':
            case 'volume_below_avg':
                return f.period;
            case 'outperforms_index':
                return f.period + 1; // uses returnNd which needs period + 1
        }
    }
    periodRequirementForExitRule(rule) {
        switch (rule.type) {
            case 'hold_days':
                return 0; // no data requirement, just bar counting
            case 'rsi_above':
            case 'rsi_below':
                return rule.period + 1;
            case 'price_below_sma':
            case 'price_above_sma':
                return rule.period;
        }
    }
    periodRequirementForRiskRule(rule) {
        switch (rule.type) {
            case 'atr_multiple':
                return rule.atrPeriod + 1; // ATR needs period + 1
            case 'percentage':
                return 0; // no data requirement
        }
    }
    validateFilterCondition(f) {
        switch (f.type) {
            case 'return_above':
            case 'return_below':
                if (f.period < 1)
                    return `${f.type}: period must be >= 1`;
                if (f.threshold <= 0)
                    return `${f.type}: threshold must be > 0`;
                return undefined;
            case 'price_above_sma':
            case 'price_below_sma':
                if (f.period < 1)
                    return `${f.type}: period must be >= 1`;
                return undefined;
            case 'sma_above_sma':
                if (f.shortPeriod < 1)
                    return `sma_above_sma: shortPeriod must be >= 1`;
                if (f.longPeriod < 1)
                    return `sma_above_sma: longPeriod must be >= 1`;
                return undefined;
            case 'rsi_below':
            case 'rsi_above':
                if (f.period < 1)
                    return `${f.type}: period must be >= 1`;
                if (f.threshold <= 0)
                    return `${f.type}: threshold must be > 0`;
                return undefined;
            case 'price_near_sma':
                if (f.period < 1)
                    return `price_near_sma: period must be >= 1`;
                if (f.tolerance <= 0)
                    return `price_near_sma: tolerance must be > 0`;
                return undefined;
            case 'price_above_highest':
                if (f.period < 1)
                    return `price_above_highest: period must be >= 1`;
                return undefined;
            case 'volume_above_avg':
                if (f.period < 1)
                    return `volume_above_avg: period must be >= 1`;
                if (f.multiplier <= 0)
                    return `volume_above_avg: multiplier must be > 0`;
                return undefined;
            case 'volume_below_avg':
                if (f.period < 1)
                    return `volume_below_avg: period must be >= 1`;
                return undefined;
            case 'outperforms_index':
                if (f.period < 1)
                    return `outperforms_index: period must be >= 1`;
                return undefined;
        }
    }
    validateExitRule(rule) {
        switch (rule.type) {
            case 'hold_days':
                if (rule.days < 1)
                    return `hold_days: days must be >= 1`;
                return undefined;
            case 'rsi_above':
            case 'rsi_below':
                if (rule.period < 1)
                    return `${rule.type}: period must be >= 1`;
                if (rule.threshold <= 0)
                    return `${rule.type}: threshold must be > 0`;
                return undefined;
            case 'price_below_sma':
            case 'price_above_sma':
                if (rule.period < 1)
                    return `${rule.type}: period must be >= 1`;
                return undefined;
        }
    }
    validateRiskRule(rule) {
        switch (rule.type) {
            case 'atr_multiple':
                if (rule.atrPeriod < 1)
                    return `atr_multiple: atrPeriod must be >= 1`;
                if (rule.multiple <= 0)
                    return `atr_multiple: multiple must be > 0`;
                return undefined;
            case 'percentage':
                if (rule.percentage <= 0)
                    return `percentage: percentage must be > 0`;
                if (rule.percentage >= 100)
                    return `percentage: stop-loss percentage must be less than 100`;
                return undefined;
        }
    }
}
exports.CompositeStrategyEngine = CompositeStrategyEngine;
//# sourceMappingURL=composite-engine.js.map