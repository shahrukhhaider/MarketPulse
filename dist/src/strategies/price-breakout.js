"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PriceBreakoutStrategy = void 0;
/**
 * Price Breakout strategy.
 *
 * BUY when the current price breaks above the upper level.
 * SELL when the current price breaks below the lower level.
 * HOLD when the price is between the two levels (inclusive).
 */
class PriceBreakoutStrategy {
    type = 'price_breakout';
    evaluate(priceHistory, params) {
        const { upperLevel, lowerLevel } = params;
        const latest = priceHistory[priceHistory.length - 1];
        let direction = 'HOLD';
        if (latest.price > upperLevel) {
            direction = 'BUY';
        }
        else if (latest.price < lowerLevel) {
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
        if (p.lowerLevel <= 0) {
            return { valid: false, error: 'lowerLevel must be greater than 0' };
        }
        if (p.upperLevel <= p.lowerLevel) {
            return { valid: false, error: `upperLevel must be greater than lowerLevel (${p.lowerLevel})` };
        }
        return { valid: true };
    }
    minimumDataPoints() {
        return 1;
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
exports.PriceBreakoutStrategy = PriceBreakoutStrategy;
//# sourceMappingURL=price-breakout.js.map