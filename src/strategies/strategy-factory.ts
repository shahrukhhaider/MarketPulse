import type { StrategyType, StrategyParams } from '../types.js';
import { MovingAverageCrossoverStrategy } from './moving-average.js';
import { RSIThresholdStrategy } from './rsi-threshold.js';
import { PriceBreakoutStrategy } from './price-breakout.js';
import { CompositeStrategyEngine } from './composite-engine.js';
import { getDefaultCompositeConfig, DEFAULT_PEAD_CONFIG, DEFAULT_KMR_CONFIG, type CompositeStrategyParams } from './strategy-configs.js';

export function getStrategyInstance(strategyType: StrategyType) {
  switch (strategyType) {
    case 'moving_average_crossover':
      return new MovingAverageCrossoverStrategy();
    case 'rsi_threshold':
      return new RSIThresholdStrategy();
    case 'price_breakout':
      return new PriceBreakoutStrategy();
    case 'momentum_continuation':
    case 'trend_pullback':
    case 'breakout_volume':
      return new CompositeStrategyEngine(strategyType);
    case 'consolidation_breakout':
    case 'bear_breakdown':
    case 'post_earnings_drift':
      // V3 engines are instantiated in the backtest handler's V3 path
      return undefined;
  }
}

export function getDefaultParams(strategyType: StrategyType): StrategyParams {
  switch (strategyType) {
    case 'moving_average_crossover':
      return { shortWindow: 10, longWindow: 50 };
    case 'rsi_threshold':
      return { period: 14, overbought: 70, oversold: 30 };
    case 'price_breakout':
      return { upperLevel: 100, lowerLevel: 50 };
    case 'momentum_continuation':
    case 'trend_pullback':
    case 'breakout_volume':
      return { config: getDefaultCompositeConfig(strategyType) } as CompositeStrategyParams;
    case 'consolidation_breakout':
      // Default params for V3 will be added in task 9.1
      return { config: {} } as StrategyParams;
    case 'bear_breakdown':
      return { config: {} } as StrategyParams;
    case 'post_earnings_drift':
      return { config: DEFAULT_PEAD_CONFIG, earningsDates: [] } as StrategyParams;
    case 'keltner_mean_reversion':
      return { config: DEFAULT_KMR_CONFIG } as StrategyParams;
    case 'volume_dry_up':
      return { config: {} } as StrategyParams;
  }
}
