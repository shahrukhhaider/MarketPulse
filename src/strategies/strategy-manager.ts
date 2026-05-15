import type {
  Config,
  StrategyType,
  StrategyParams,
  StrategyConfig,
  MovingAverageCrossoverParams,
  RSIThresholdParams,
  PriceBreakoutParams,
} from '../types.js';
import { ErrorCodes } from '../types.js';
import { save, type Result } from '../data/config-store.js';

export class StrategyManager {
  private config: Config;
  private configFilePath: string;

  constructor(config: Config, configFilePath: string) {
    this.config = config;
    this.configFilePath = configFilePath;
  }

  validateParams(
    strategyType: StrategyType,
    params: StrategyParams
  ): Result<void> {
    switch (strategyType) {
      case 'moving_average_crossover': {
        const p = params as MovingAverageCrossoverParams;
        if (p.shortWindow <= 0) {
          return {
            success: false,
            error: `${ErrorCodes.INVALID_PARAM_RANGE}: shortWindow must be greater than 0`,
          };
        }
        if (p.longWindow <= p.shortWindow) {
          return {
            success: false,
            error: `${ErrorCodes.INVALID_PARAM_RANGE}: longWindow must be greater than shortWindow (${p.shortWindow})`,
          };
        }
        return { success: true, data: undefined };
      }
      case 'rsi_threshold': {
        const p = params as RSIThresholdParams;
        if (p.period <= 0) {
          return {
            success: false,
            error: `${ErrorCodes.INVALID_PARAM_RANGE}: period must be greater than 0`,
          };
        }
        if (p.oversold <= 0 || p.oversold >= 100) {
          return {
            success: false,
            error: `${ErrorCodes.INVALID_PARAM_RANGE}: oversold must be between 0 and 100 (exclusive)`,
          };
        }
        if (p.overbought <= 0 || p.overbought >= 100) {
          return {
            success: false,
            error: `${ErrorCodes.INVALID_PARAM_RANGE}: overbought must be between 0 and 100 (exclusive)`,
          };
        }
        if (p.oversold >= p.overbought) {
          return {
            success: false,
            error: `${ErrorCodes.INVALID_PARAM_RANGE}: oversold (${p.oversold}) must be less than overbought (${p.overbought})`,
          };
        }
        return { success: true, data: undefined };
      }
      case 'price_breakout': {
        const p = params as PriceBreakoutParams;
        if (p.lowerLevel <= 0) {
          return {
            success: false,
            error: `${ErrorCodes.INVALID_PARAM_RANGE}: lowerLevel must be greater than 0`,
          };
        }
        if (p.upperLevel <= p.lowerLevel) {
          return {
            success: false,
            error: `${ErrorCodes.INVALID_PARAM_RANGE}: upperLevel must be greater than lowerLevel (${p.lowerLevel})`,
          };
        }
        return { success: true, data: undefined };
      }
      default:
        return {
          success: false,
          error: `${ErrorCodes.INVALID_PARAM_RANGE}: Unknown strategy type '${strategyType}'`,
        };
    }
  }

  configureStrategy(
    ticker: string,
    strategyType: StrategyType,
    params: StrategyParams
  ): Result<void> {
    const entry = this.findEntry(ticker);
    if (!entry) {
      return {
        success: false,
        error: `${ErrorCodes.STOCK_NOT_FOUND}: Stock '${ticker.toUpperCase()}' is not in the watchlist`,
      };
    }

    const validation = this.validateParams(strategyType, params);
    if (!validation.success) {
      return validation;
    }

    const existingIndex = entry.strategies.findIndex(
      (s) => s.type === strategyType
    );

    if (existingIndex !== -1) {
      const previous = { ...entry.strategies[existingIndex] };
      entry.strategies[existingIndex] = {
        type: strategyType,
        params,
        enabled: entry.strategies[existingIndex].enabled,
      };

      const saveResult = save(this.config, this.configFilePath);
      if (!saveResult.success) {
        entry.strategies[existingIndex] = previous;
        return { success: false, error: saveResult.error };
      }
    } else {
      const newConfig: StrategyConfig = {
        type: strategyType,
        params,
        enabled: true,
      };
      entry.strategies.push(newConfig);

      const saveResult = save(this.config, this.configFilePath);
      if (!saveResult.success) {
        entry.strategies.pop();
        return { success: false, error: saveResult.error };
      }
    }

    return { success: true, data: undefined };
  }

  enableStrategy(ticker: string, strategyType: StrategyType): Result<void> {
    return this.toggleStrategy(ticker, strategyType, true);
  }

  disableStrategy(ticker: string, strategyType: StrategyType): Result<void> {
    return this.toggleStrategy(ticker, strategyType, false);
  }

  getStrategies(ticker: string): StrategyConfig[] {
    const entry = this.findEntry(ticker);
    if (!entry) {
      return [];
    }
    return entry.strategies;
  }

  private toggleStrategy(
    ticker: string,
    strategyType: StrategyType,
    enabled: boolean
  ): Result<void> {
    const entry = this.findEntry(ticker);
    if (!entry) {
      return {
        success: false,
        error: `${ErrorCodes.STOCK_NOT_FOUND}: Stock '${ticker.toUpperCase()}' is not in the watchlist`,
      };
    }

    const strategy = entry.strategies.find((s) => s.type === strategyType);
    if (!strategy) {
      return {
        success: false,
        error: `${ErrorCodes.STOCK_NOT_FOUND}: Strategy '${strategyType}' is not configured for '${ticker.toUpperCase()}'`,
      };
    }

    const previousEnabled = strategy.enabled;
    strategy.enabled = enabled;

    const saveResult = save(this.config, this.configFilePath);
    if (!saveResult.success) {
      strategy.enabled = previousEnabled;
      return { success: false, error: saveResult.error };
    }

    return { success: true, data: undefined };
  }

  private findEntry(ticker: string) {
    const normalized = ticker.toUpperCase();
    return this.config.watchlist.find(
      (e) => e.ticker.toUpperCase() === normalized
    );
  }
}
