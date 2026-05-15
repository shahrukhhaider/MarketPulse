import type { TunableStrategyInterface, SignalOutput } from './strategy-registry.js';
import type { HistoricalDataPoint, BacktestResult } from '../types.js';
import type { ParameterSpace } from './parameter-grid.js';
import { getConsolidationBreakoutParameterSpace } from './parameter-grid.js';
import { runBacktest } from '../pipeline/pipeline-functions.js';
import { detectSignal } from './signal-detector.js';

export class ConsolidationBreakoutStrategy implements TunableStrategyInterface {
  readonly name = 'consolidation_breakout';

  paramSpace(): ParameterSpace {
    return getConsolidationBreakoutParameterSpace();
  }

  runBacktest(data: HistoricalDataPoint[], params: Record<string, number>): BacktestResult {
    return runBacktest(data, this.name, params);
  }

  detectSignal(data: HistoricalDataPoint[], params: Record<string, number>): SignalOutput {
    return detectSignal(data, params, this.name);
  }
}
