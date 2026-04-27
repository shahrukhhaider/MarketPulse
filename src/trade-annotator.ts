import type { BacktestResult, StrategyParams, Trade } from './types.js';
import type { StrategyConfiguration, ExitRule, RiskRule, PhasedStrategyConfiguration } from './strategies/strategy-configs.js';
import { isV2Config } from './strategies/strategy-configs.js';
import type { FilterCondition } from './strategies/filter-evaluator.js';

// ============================================================
// Interfaces
// ============================================================

export interface TradeReasoning {
  tradeIndex: number;
  strategyType: string;
  entryDate: string;
  entryPrice: number;
  exitDate: string;
  exitPrice: number;
  profitLossPercent: number;
  entryReasoning: string;
  exitReasoning: string;
}

// ============================================================
// Helper: describe a single filter condition
// ============================================================

function describeFilter(f: FilterCondition): string {
  switch (f.type) {
    case 'return_above':
      return `return_above(period=${f.period}, threshold=${f.threshold})`;
    case 'return_below':
      return `return_below(period=${f.period}, threshold=${f.threshold})`;
    case 'price_above_sma':
      return `price_above_sma(period=${f.period})`;
    case 'price_below_sma':
      return `price_below_sma(period=${f.period})`;
    case 'sma_above_sma':
      return `sma_above_sma(short=${f.shortPeriod}, long=${f.longPeriod})`;
    case 'rsi_below':
      return `rsi_below(period=${f.period}, threshold=${f.threshold})`;
    case 'rsi_above':
      return `rsi_above(period=${f.period}, threshold=${f.threshold})`;
    case 'price_near_sma':
      return `price_near_sma(period=${f.period}, tolerance=${f.tolerance})`;
    case 'price_above_highest':
      return `price_above_highest(period=${f.period})`;
    case 'volume_above_avg':
      return `volume_above_avg(period=${f.period}, multiplier=${f.multiplier})`;
    case 'volume_below_avg':
      return `volume_below_avg(period=${f.period})`;
    case 'outperforms_index':
      return `outperforms_index(period=${f.period}, index=${f.indexTicker})`;
  }
}

// ============================================================
// Helper: describe a single exit rule
// ============================================================

function describeExitRule(rule: ExitRule): string {
  switch (rule.type) {
    case 'hold_days':
      return `hold_days(days=${rule.days})`;
    case 'rsi_above':
      return `rsi_above(period=${rule.period}, threshold=${rule.threshold})`;
    case 'rsi_below':
      return `rsi_below(period=${rule.period}, threshold=${rule.threshold})`;
    case 'price_below_sma':
      return `price_below_sma(period=${rule.period})`;
    case 'price_above_sma':
      return `price_above_sma(period=${rule.period})`;
  }
}

// ============================================================
// Helper: describe a risk rule
// ============================================================

function describeRiskRule(rule: RiskRule): string {
  switch (rule.type) {
    case 'atr_multiple':
      return `atr_multiple(atrPeriod=${rule.atrPeriod}, multiple=${rule.multiple})`;
    case 'percentage':
      return `percentage(${rule.percentage})`;
  }
}

// ============================================================
// Composite Entry Reasoning
// ============================================================

/**
 * Generate entry reasoning text for a composite strategy.
 * Lists direction filters, timing filters, and confirmation filters.
 */
export function formatCompositeEntryReasoning(config: StrategyConfiguration): string {
  const lines: string[] = [];

  lines.push(`Strategy: ${config.name}`);

  if (config.directionFilters.length > 0) {
    lines.push('Direction filters:');
    for (const f of config.directionFilters) {
      lines.push(`  - ${describeFilter(f)}`);
    }
  }

  if (config.timingFilters.length > 0) {
    lines.push('Timing filters:');
    for (const f of config.timingFilters) {
      lines.push(`  - ${describeFilter(f)}`);
    }
  }

  if (config.confirmationFilters.length > 0) {
    lines.push('Confirmation filters:');
    for (const f of config.confirmationFilters) {
      lines.push(`  - ${describeFilter(f)}`);
    }
  }

  return lines.join('\n');
}

// ============================================================
// Composite Exit Reasoning
// ============================================================

/**
 * Generate exit reasoning text for a composite strategy.
 * Lists exit rules and risk rules.
 */
export function formatCompositeExitReasoning(config: StrategyConfiguration): string {
  const lines: string[] = [];

  if (config.exitRules.length > 0) {
    lines.push('Exit rules:');
    for (const rule of config.exitRules) {
      lines.push(`  - ${describeExitRule(rule)}`);
    }
  }

  if (config.riskRule) {
    lines.push('Risk rule:');
    lines.push(`  - ${describeRiskRule(config.riskRule)}`);
  }

  return lines.join('\n');
}

// ============================================================
// Simple (Non-Composite) Reasoning
// ============================================================

/**
 * Generate reasoning text for a non-composite strategy.
 * Displays strategy type and parameter values.
 */
export function formatSimpleReasoning(strategyType: string, params: StrategyParams): string {
  const lines: string[] = [];
  lines.push(`Strategy: ${strategyType}`);
  lines.push('Parameters:');

  for (const [key, value] of Object.entries(params)) {
    lines.push(`  - ${key}: ${value}`);
  }

  return lines.join('\n');
}

// ============================================================
// V2 Phased Strategy Reasoning
// ============================================================

export function formatV2EntryReasoning(config: PhasedStrategyConfiguration): string {
  const lines: string[] = [];
  lines.push(`Strategy: ${config.name} (V2 Phased)`);

  lines.push('Direction phase (ALL-of):');
  for (const f of config.phases.direction.conditions) {
    lines.push(`  - ${describeFilter(f)}`);
  }

  lines.push('Setup phase (ANY-of):');
  for (const f of config.phases.setup.conditions) {
    lines.push(`  - ${describeFilter(f)}`);
  }

  lines.push('Trigger phase (ALL-of):');
  for (const f of config.phases.trigger.conditions) {
    lines.push(`  - ${describeFilter(f)}`);
  }

  return lines.join('\n');
}

export function formatV2ExitReasoning(config: PhasedStrategyConfiguration, trade: Trade): string {
  const lines: string[] = [];
  const v2Trade = trade as any;

  lines.push('Exit rules (priority order):');
  lines.push(`  1. Stop-loss: ATR(${config.stopLoss.atr_period}) × ${config.stopLoss.atr_multiple}`);
  lines.push(`  2. Profit target: ${config.profitTarget.target_r_multiple}R multiple`);
  lines.push(`  3. Trend failsafe: close < SMA(${config.trendExit.trend_exit_sma_period})`);
  lines.push(`Max risk: ${config.maxRisk.max_risk_pct}%`);
  lines.push(`Min hold days: ${config.min_hold_days}`);

  if (v2Trade.exitReason) {
    lines.push(`Exit reason: ${v2Trade.exitReason}`);
  }

  return lines.join('\n');
}

// ============================================================
// Main: Annotate Trades With Reasoning
// ============================================================

/**
 * Produce a reasoning summary for each trade in the BacktestResult.
 * For composite strategies (params has a `config` property), extracts
 * filter group and exit rule descriptions.
 * For non-composite strategies, displays strategy type and parameters.
 */
export function annotateTradesWithReasoning(
  backtestResult: BacktestResult,
  strategyParams: StrategyParams
): TradeReasoning[] {
  const trades = backtestResult.performanceSummary.trades;
  const isComposite = 'config' in strategyParams && strategyParams.config != null;

  return trades.map((trade: Trade, index: number): TradeReasoning => {
    let entryReasoning: string;
    let exitReasoning: string;

    if (isComposite) {
      const config = (strategyParams as { config: any }).config;
      if (isV2Config(config)) {
        entryReasoning = formatV2EntryReasoning(config);
        exitReasoning = formatV2ExitReasoning(config, trade);
      } else {
        entryReasoning = formatCompositeEntryReasoning(config);
        exitReasoning = formatCompositeExitReasoning(config);
      }
    } else {
      const reasoning = formatSimpleReasoning(backtestResult.strategyType, strategyParams);
      entryReasoning = reasoning;
      exitReasoning = reasoning;
    }

    return {
      tradeIndex: index,
      strategyType: backtestResult.strategyType,
      entryDate: trade.buySignal.timestamp,
      entryPrice: trade.buySignal.price,
      exitDate: trade.sellSignal.timestamp,
      exitPrice: trade.sellSignal.price,
      profitLossPercent: trade.profitLossPercent,
      entryReasoning,
      exitReasoning,
    };
  });
}
