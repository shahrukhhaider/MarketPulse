import type {
  Strategy,
  StrategyType,
  StrategyParams,
  PricePoint,
  Signal,
  MovingAverageCrossoverParams,
} from '../types.js';

/**
 * Moving Average Crossover strategy.
 *
 * BUY when the short-window moving average crosses above the long-window MA.
 * SELL when the short-window MA crosses below the long-window MA.
 * HOLD otherwise.
 */
export class MovingAverageCrossoverStrategy implements Strategy {
  type: StrategyType = 'moving_average_crossover';

  evaluate(priceHistory: PricePoint[], params: StrategyParams): Signal {
    const { shortWindow, longWindow } = params as MovingAverageCrossoverParams;
    const latest = priceHistory[priceHistory.length - 1];

    // We need at least longWindow + 1 points to compute two consecutive long MAs
    // for crossover detection
    if (priceHistory.length < longWindow + 1) {
      return this.holdSignal(latest);
    }

    const prices = priceHistory.map((p) => p.price);

    // Current MAs (using the last N prices)
    const currentShortMA = this.average(prices, prices.length - shortWindow, prices.length);
    const currentLongMA = this.average(prices, prices.length - longWindow, prices.length);

    // Previous MAs (shifted back by one)
    const prevShortMA = this.average(prices, prices.length - 1 - shortWindow, prices.length - 1);
    const prevLongMA = this.average(prices, prices.length - 1 - longWindow, prices.length - 1);

    let direction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';

    // Short MA crossed above long MA → BUY
    if (prevShortMA <= prevLongMA && currentShortMA > currentLongMA) {
      direction = 'BUY';
    }
    // Short MA crossed below long MA → SELL
    else if (prevShortMA >= prevLongMA && currentShortMA < currentLongMA) {
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
    const p = params as MovingAverageCrossoverParams;
    if (p.shortWindow <= 0) {
      return { valid: false, error: 'shortWindow must be greater than 0' };
    }
    if (p.longWindow <= p.shortWindow) {
      return { valid: false, error: `longWindow must be greater than shortWindow (${p.shortWindow})` };
    }
    return { valid: true };
  }

  minimumDataPoints(): number {
    // The design specifies longWindow + 1, but the actual minimum depends on params.
    // We return a default; callers should use minimumDataPointsForParams when they have params.
    return 51; // default longWindow (50) + 1
  }

  /**
   * Returns the minimum data points needed for the given params.
   */
  minimumDataPointsForParams(params: MovingAverageCrossoverParams): number {
    return params.longWindow + 1;
  }

  private average(prices: number[], from: number, to: number): number {
    let sum = 0;
    for (let i = from; i < to; i++) {
      sum += prices[i];
    }
    return sum / (to - from);
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
