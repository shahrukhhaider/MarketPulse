"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RSIThresholdStrategy = void 0;
/**
 * RSI (Relative Strength Index) Threshold strategy.
 *
 * BUY when RSI drops below the oversold threshold.
 * SELL when RSI rises above the overbought threshold.
 * HOLD otherwise.
 */
class RSIThresholdStrategy {
    type = 'rsi_threshold';
    evaluate(priceHistory, params) {
        const { period, overbought, oversold } = params;
        const latest = priceHistory[priceHistory.length - 1];
        if (priceHistory.length < period + 1) {
            return this.holdSignal(latest);
        }
        const rsi = this.calculateRSI(priceHistory, period);
        let direction = 'HOLD';
        if (rsi < oversold) {
            direction = 'BUY';
        }
        else if (rsi > overbought) {
            direction = 'SELL';
        }
        return {
            id: '',
            ticker: latest.ticker,
            direction,
            strategyType: this.type,
            price: latest.price,
            timestamp: latest.timestamp,
        };
    }
    validateParams(params) {
        const p = params;
        if (p.period <= 0) {
            return { valid: false, error: 'period must be greater than 0' };
        }
        if (p.oversold <= 0 || p.oversold >= 100) {
            return { valid: false, error: 'oversold must be between 0 and 100 (exclusive)' };
        }
        if (p.overbought <= 0 || p.overbought >= 100) {
            return { valid: false, error: 'overbought must be between 0 and 100 (exclusive)' };
        }
        if (p.oversold >= p.overbought) {
            return { valid: false, error: `oversold (${p.oversold}) must be less than overbought (${p.overbought})` };
        }
        return { valid: true };
    }
    minimumDataPoints() {
        return 15; // default period (14) + 1
    }
    /**
     * Returns the minimum data points needed for the given params.
     */
    minimumDataPointsForParams(params) {
        return params.period + 1;
    }
    /**
     * Calculate RSI using the standard Wilder's smoothing method.
     *
     * RSI = 100 - (100 / (1 + RS))
     * RS = Average Gain / Average Loss over the period
     */
    calculateRSI(priceHistory, period) {
        const prices = priceHistory.map((p) => p.price);
        const len = prices.length;
        // Calculate price changes for the most recent `period` intervals
        let avgGain = 0;
        let avgLoss = 0;
        // Use the last (period) price changes
        const start = len - period;
        for (let i = start; i < len; i++) {
            const change = prices[i] - prices[i - 1];
            if (change > 0) {
                avgGain += change;
            }
            else {
                avgLoss += Math.abs(change);
            }
        }
        avgGain /= period;
        avgLoss /= period;
        if (avgLoss === 0) {
            return 100; // No losses → RSI is 100
        }
        const rs = avgGain / avgLoss;
        return 100 - 100 / (1 + rs);
    }
    holdSignal(latest) {
        return {
            id: '',
            ticker: latest.ticker,
            direction: 'HOLD',
            strategyType: this.type,
            price: latest.price,
            timestamp: latest.timestamp,
        };
    }
}
exports.RSIThresholdStrategy = RSIThresholdStrategy;
//# sourceMappingURL=rsi-threshold.js.map