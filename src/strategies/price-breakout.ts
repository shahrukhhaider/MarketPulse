import type {
  Strategy,
  StrategyType,
  StrategyParams,
  PricePoint,
  Signal,
  PriceBreakoutParams,
} from '../types.js';

/**
 * Price Breakout strategy.
 *
 * BUY when the current price breaks above the upper level.
 * SELL when the current price breaks below the lower level.
 * HOLD when the price is between the two levels (inclusive).
 */
export class PriceBreakoutStrategy implements Strategy {
  type: StrategyType = 'price_breakout';

  evaluate(priceHistory: PricePoint[], params: StrategyParams): Signal {
    const { upperLevel, lowerLevel } = params as PriceBreakoutParams;
    const latest = priceHistory[priceHistory.length - 1];

    let direction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    if (latest.price > upperLevel) {
      direction = 'BUY';
    } else if (latest.price < lowerLevel) {
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

  validateParams(params: StrategyParams): { valid: boolean; error?: string } {
    const p = params as PriceBreakoutParams;
    if (p.lowerLevel <= 0) {
      return { valid: false, error: 'lowerLevel must be greater than 0' };
    }
    if (p.upperLevel <= p.lowerLevel) {
      return { valid: false, error: `upperLevel must be greater than lowerLevel (${p.lowerLevel})` };
    }
    return { valid: true };
  }

  minimumDataPoints(): number {
    return 1;
  }

  private holdSignal(latest: PricePoint): Signal {
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
