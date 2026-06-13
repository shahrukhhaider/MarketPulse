// ============================================================
// Configure Strategy Command — Enable/disable or set params for a strategy
// ============================================================

import { successResult, errorResult } from '../command-router.js';
import type { CommandHandler } from '../command-router.js';
import type { AppDependencies } from '../di/container.js';
import { ErrorCodes } from '../types.js';
import type { StrategyType, StrategyParams } from '../types.js';
import { getDefaultParams } from '../strategies/strategy-factory.js';

// ============================================================
// createConfigureStrategyHandler
// ============================================================

export function createConfigureStrategyHandler(deps: AppDependencies): CommandHandler {
  const { strategyManager } = deps;

  return (opts: Record<string, string>) => {
    const ticker = opts['ticker'].toUpperCase();
    const strategyType = opts['strategy'] as StrategyType;

    // Handle --enabled toggle (without params means just toggle)
    if (opts['enabled'] !== undefined && !opts['params']) {
      const enabled = opts['enabled'].toLowerCase() === 'true';
      const toggleResult = enabled
        ? strategyManager.enableStrategy(ticker, strategyType)
        : strategyManager.disableStrategy(ticker, strategyType);

      if (!toggleResult.success) {
        const code = toggleResult.error.includes(ErrorCodes.STOCK_NOT_FOUND)
          ? ErrorCodes.STOCK_NOT_FOUND : ErrorCodes.INVALID_PARAM_RANGE;
        return errorResult('configure-strategy', code, toggleResult.error);
      }

      return successResult('configure-strategy', {
        ticker,
        strategy: strategyType,
        enabled,
        message: `Strategy '${strategyType}' ${enabled ? 'enabled' : 'disabled'} for '${ticker}'`,
      });
    }

    // Parse params JSON (default to empty object if not provided)
    let params: StrategyParams;
    if (opts['params']) {
      params = JSON.parse(opts['params']) as StrategyParams;
    } else {
      // Use default params based on strategy type
      params = getDefaultParams(strategyType);
    }

    // Configure strategy via StrategyManager
    const result = strategyManager.configureStrategy(ticker, strategyType, params);
    if (!result.success) {
      const code = result.error.includes(ErrorCodes.STOCK_NOT_FOUND)
        ? ErrorCodes.STOCK_NOT_FOUND
        : result.error.includes(ErrorCodes.INVALID_PARAM_RANGE)
          ? ErrorCodes.INVALID_PARAM_RANGE
          : 'CONFIGURE_FAILED';
      return errorResult('configure-strategy', code, result.error);
    }

    // Handle --enabled toggle after configuration
    if (opts['enabled'] !== undefined) {
      const enabled = opts['enabled'].toLowerCase() === 'true';
      if (!enabled) {
        strategyManager.disableStrategy(ticker, strategyType);
      }
    }

    return successResult('configure-strategy', {
      ticker,
      strategy: strategyType,
      params,
      message: `Strategy '${strategyType}' configured for '${ticker}'`,
    });
  };
}
